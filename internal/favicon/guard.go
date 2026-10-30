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
	// never are addresses no fetch may reach: the IANA special purpose
	// ranges that are not private networks (this network, IETF protocol
	// assignments, documentation, benchmarking, the 6to4 relay, multicast,
	// reserved, discard, the local use NAT64 prefix, Teredo and the rest of
	// 2001::/23, SRv6).
	never = prefixes("0.0.0.0/8", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24",
		"198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
		"::/128", "100::/64", "64:ff9b:1::/48", "2001::/23", "2001:db8::/32", "3fff::/20",
		"5f00::/16", "ff00::/8")
	// private are addresses a fetch may reach only on the bookmark's own
	// host, and only when that host is itself private: a self hosted
	// service on the home network.
	private = prefixes("127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"169.254.0.0/16", "100.64.0.0/10", "::1/128", "fc00::/7", "fe80::/10", "fec0::/10")

	// Addresses that carry an IPv4 address inside: NAT64 (64:ff9b::/96) and
	// 6to4 (2002::/16) reach that IPv4 address, so it is the one checked.
	nat64   = netip.MustParsePrefix("64:ff9b::/96")
	sixToV4 = netip.MustParsePrefix("2002::/16")
	// IPv4 compatible addresses (::a.b.c.d, deprecated) are refused.
	compat = netip.MustParsePrefix("::/96")
)

// effective returns the address a connection to a really reaches, as far as
// the guard can tell: the IPv4 address inside a mapped, NAT64 or 6to4
// address, or a itself.
func effective(a netip.Addr) (netip.Addr, bool) {
	a = a.Unmap()
	if !a.Is6() {
		return a, true
	}
	b := a.As16()
	switch {
	case nat64.Contains(a):
		return netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]}), true
	case sixToV4.Contains(a):
		return netip.AddrFrom4([4]byte{b[2], b[3], b[4], b[5]}), true
	case compat.Contains(a) && a != netip.IPv6Unspecified() && a != netip.IPv6Loopback():
		return a, false
	}
	return a, true
}

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
	a, ok := effective(a)
	return !ok || inAny(never, a) || inAny(private, a)
}

// guard decides which addresses and ports the fetches for one bookmark may
// connect to.
type guard struct {
	owner   string // the bookmark's host, lower case
	private bool   // the owner resolves to a private address
	port    string // the port of the bookmark's own address; 80 and 443 always pass
}

var errBlocked = errors.New("address not allowed")

// allowPort lets a fetch use 80, 443 and the bookmark's own port.
func (g guard) allowPort(host, port string) error {
	if port == "80" || port == "443" || (port != "" && port == g.port) {
		return nil
	}
	return fmt.Errorf("%s port %s: %w", host, port, errBlocked)
}

func (g guard) allow(host string, orig netip.Addr) error {
	a, ok := effective(orig)
	switch {
	case !ok, inAny(never, a):
	case !inAny(private, a):
		return nil
	case g.private && strings.EqualFold(strings.TrimSuffix(host, "."), g.owner):
		return nil
	}
	return fmt.Errorf("%s (%s): %w", host, orig, errBlocked)
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
		g.port = u.Port()
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
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			if err := g.allowPort(host, port); err != nil {
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
