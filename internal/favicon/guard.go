package favicon

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// maxRedirects is how many redirects one icon request may follow.
const maxRedirects = 5

var (
	// never are addresses no fetch may reach.
	never = prefixes("0.0.0.0/8", "224.0.0.0/4", "::/128", "ff00::/8")
	// private are addresses a fetch may reach only on the bookmark's own
	// host, and only when that host is itself private: a self hosted
	// service on the home network.
	private = prefixes("127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"169.254.0.0/16", "100.64.0.0/10", "::1/128", "fc00::/7", "fe80::/10")
)

func prefixes(ss ...string) []netip.Prefix {
	out := make([]netip.Prefix, len(ss))
	for i, s := range ss {
		out[i] = netip.MustParsePrefix(s)
	}
	return out
}

func inAny(list []netip.Prefix, a netip.Addr) bool {
	for _, p := range list {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func isPrivate(a netip.Addr) bool {
	a = a.Unmap()
	return inAny(never, a) || inAny(private, a)
}

// guard decides which addresses the fetches for one bookmark may connect to.
type guard struct {
	owner   string // the bookmark's host, lower case
	private bool   // the owner resolves to a private address
}

var errBlocked = errors.New("address not allowed")

func (g guard) allow(host string, a netip.Addr) error {
	a = a.Unmap()
	switch {
	case inAny(never, a):
	case !inAny(private, a):
		return nil
	case g.private && strings.EqualFold(strings.TrimSuffix(host, "."), g.owner):
		return nil
	}
	return fmt.Errorf("%s (%s): %w", host, a, errBlocked)
}

// NewClient returns the client that fetches the icon for pageURL. When the
// bookmark's host resolves to a private address, that host may be reached
// at its private address; every other connection, including redirects and
// icons on other hosts, must go to a public address. The check runs on the
// address actually dialled, so a name that changes its answer between the
// lookup and the connection gains nothing.
func NewClient(ctx context.Context, pageURL string) *http.Client {
	g := guard{}
	if u, err := url.Parse(pageURL); err == nil && u.Hostname() != "" {
		g.owner = strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
		g.private = resolvesPrivate(ctx, g.owner)
	}
	return g.client()
}

func resolvesPrivate(ctx context.Context, host string) bool {
	if a, err := netip.ParseAddr(host); err == nil {
		return isPrivate(a)
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return false
	}
	for _, a := range addrs {
		if isPrivate(a) {
			return true
		}
	}
	return false
}

func (g guard) client() *http.Client {
	tr := &http.Transport{
		Proxy:                 nil, // a proxy would hide the address dialled
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: time.Second,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, _, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			d := &net.Dialer{
				Timeout: budget,
				// Control sees each resolved address just before connecting.
				Control: func(_, address string, _ syscall.RawConn) error {
					ap, err := netip.ParseAddrPort(address)
					if err != nil {
						return err
					}
					return g.allow(host, ap.Addr())
				},
			}
			return d.DialContext(ctx, network, addr)
		},
	}
	return &http.Client{
		Timeout:   budget,
		Transport: tr,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("redirect to %s refused", req.URL.Scheme)
			}
			return nil
		},
	}
}
