package server

import (
	"fmt"

	"net/http"
	"net/netip"
	"strconv"
	"strings"
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

// fail records a failed check for key in l after the constant delay, and
// returns how long the client has to wait now, zero while under the limit.
func (s *Server) fail(l *auth.Limiter, key string) time.Duration {
	s.sleep(failDelay)
	return l.Fail(key)
}

// attempt runs one password check for key under l. While the client has to
// wait it returns the wait without running check; checks from one client run
// one at a time; a failed check waits failDelay and counts.
func (s *Server) attempt(r *http.Request, l *auth.Limiter, key string, check func() bool) (ok bool, wait time.Duration) {
	done, wait := l.Begin(r.Context(), key)
	if done == nil {
		return false, wait
	}
	defer done()
	if check() {
		l.Success(key)
		return true, 0
	}
	return false, s.fail(l, key)
}

// refuse answers a failed check: 429 when the client is over the limit,
// otherwise status with msg.
func (s *Server) refuse(w http.ResponseWriter, l *auth.Limiter, key string, status int, msg string) {
	if wait := s.fail(l, key); wait > 0 {
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
	writeError(w, http.StatusTooManyRequests, fmt.Sprintf("Too many tries. Wait %d seconds.", secs))
}

// Security headers on every response. /icons and the share pages narrow
// them further in their own handlers.
const contentSecurityPolicy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func securityHeaders(h http.Header) {
	h.Set("Content-Security-Policy", contentSecurityPolicy)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	h.Set("X-Frame-Options", "DENY")
}
