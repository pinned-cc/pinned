package server

import (
	"fmt"

	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pinned-cc/pinned/internal/auth"
)

// failDelay is how long every failed password, token or share password
// check waits before it answers. It caps guessing on one connection.
const failDelay = time.Second

// ParseProxies reads TRUSTED_PROXIES: comma separated CIDRs or single
// addresses, for example "172.16.0.0/12, 10.0.0.1".
func ParseProxies(s string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if p, err := netip.ParsePrefix(part); err == nil {
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(part)
		if err != nil {
			return nil, fmt.Errorf("TRUSTED_PROXIES: %q is not an address or CIDR", part)
		}
		a = a.Unmap()
		out = append(out, netip.PrefixFrom(a, a.BitLen()))
	}
	return out, nil
}

func (s *Server) trusted(a netip.Addr) bool {
	for _, p := range s.cfg.TrustedProxies {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// clientAddr is the address of the client. It is the connection address,
// unless that address is a trusted proxy: then X-Forwarded-For is read from
// right to left and the first address that is not a trusted proxy wins.
// Without TRUSTED_PROXIES the header is never read, since anyone can set it.
func (s *Server) clientAddr(r *http.Request) netip.Addr {
	ap, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		a, _ := netip.ParseAddr(r.RemoteAddr)
		return a.Unmap()
	}
	addr := ap.Addr().Unmap()
	if !s.trusted(addr) {
		return addr
	}
	var hops []string
	for _, v := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(v, ",")...)
	}
	for i := len(hops) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break // a broken header: stop at the last address we trust
		}
		addr = a.Unmap()
		if !s.trusted(addr) {
			return addr
		}
	}
	return addr
}

// clientKey is what the rate limits count against: the client address, with
// IPv6 bucketed to its /64, because one machine usually holds a whole /64.
func (s *Server) clientKey(r *http.Request) string {
	a := s.clientAddr(r)
	if !a.IsValid() {
		return r.RemoteAddr
	}
	if a.Is6() {
		return netip.PrefixFrom(a, 64).Masked().String()
	}
	return a.String()
}

// limiterSet keeps one limiter per share or per folder, so wrong passwords
// for one, which fill its global cap, never hold the others.
type limiterSet struct {
	mu sync.Mutex
	m  map[int64]*auth.Limiter
}

func (l *limiterSet) get(id int64) *auth.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.m == nil {
		l.m = map[int64]*auth.Limiter{}
	}
	lim := l.m[id]
	if lim == nil {
		lim = auth.NewLimiter()
		l.m[id] = lim
	}
	return lim
}

// limitKey is what a share or folder password try counts against: a
// browser with a valid device cookie on its own, and known, so the global
// cap does not hold it; anyone else by address.
func (s *Server) limitKey(r *http.Request) (key string, known bool) {
	if id, ok := s.deviceID(r); ok {
		return "device:" + id, true
	}
	return s.clientKey(r), false
}

// fail records a failed check for key in l after the constant delay, and
// returns how long the client has to wait now, zero while under the limit.
func (s *Server) fail(l *auth.Limiter, key string) time.Duration {
	s.sleep(failDelay)
	return l.Fail(key)
}

// attempt runs one password check for key under l. While the client has to
// wait it returns the wait without running check; checks from one client run
// one at a time; a failed check waits failDelay and counts. A known client
// (see auth.Limiter) is held only by its own count.
func (s *Server) attempt(r *http.Request, l *auth.Limiter, key string, known bool, check func() bool) (ok bool, wait time.Duration) {
	begin, fail := l.Begin, l.Fail
	if known {
		begin, fail = l.BeginKnown, l.FailKnown
	}
	done, wait := begin(r.Context(), key)
	if done == nil {
		return false, wait
	}
	defer done()
	if check() {
		l.Success(key)
		return true, 0
	}
	s.sleep(failDelay)
	return false, fail(key)
}

// refuse answers a failed check and logs it in area: 429 when the client
// is over the limit, otherwise status with msg.
func (s *Server) refuse(w http.ResponseWriter, r *http.Request, l *auth.Limiter, key, area string, status int, msg string) {
	wait := s.fail(l, key)
	s.failed(r, area, wait)
	if wait > 0 {
		tooMany(w, wait)
		return
	}
	writeError(w, status, msg)
}

// refuseAttempt answers an attempt that did not pass: 429 with the wait, or
// status with msg.
func refuseAttempt(w http.ResponseWriter, wait time.Duration, status int, msg string) {
	if wait > 0 {
		tooMany(w, wait)
		return
	}
	writeError(w, status, msg)
}

func tooMany(w http.ResponseWriter, wait time.Duration) {
	secs := int(wait.Seconds() + 0.999)
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	writeError(w, http.StatusTooManyRequests, "Too many tries. Wait "+waitText(secs)+", then try again.")
}

// waitText says a wait in seconds the way a person would: "30 seconds",
// "2 minutes", "3 hours", rounded up so the wait is never shorter than said.
func waitText(secs int) string {
	unit := func(n int, one string) string {
		if n == 1 {
			return "1 " + one
		}
		return strconv.Itoa(n) + " " + one + "s"
	}
	switch {
	case secs < 120:
		return unit(max(secs, 1), "second")
	case secs < 2*3600:
		return unit((secs+59)/60, "minute")
	default:
		return unit((secs+3599)/3600, "hour")
	}
}

// Security headers on every response. /icons and the share pages narrow
// them further in their own handlers.
const contentSecurityPolicy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

func securityHeaders(h http.Header) {
	h.Set("Content-Security-Policy", contentSecurityPolicy)
	h.Set("X-Content-Type-Options", "nosniff")
	// No referrer at all: a bookmark opened from the app must not tell the
	// site the app's address, which is often an internal host name. Nothing
	// here reads Referer, and the CSRF check reads X-Requested-With.
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	h.Set("X-Frame-Options", "DENY")
}
