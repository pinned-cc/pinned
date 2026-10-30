package favicon

import (
	"context"
	"errors"
	"image/color"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

func TestGuardAllow(t *testing.T) {
	public := guard{owner: "example.com"}
	home := guard{owner: "nas.home", private: true}
	for _, c := range []struct {
		g    guard
		host string
		addr string
		ok   bool
	}{
		{public, "example.com", "93.184.215.14", true},
		{public, "cdn.example.net", "2606:4700::1111", true},
		{public, "example.com", "127.0.0.1", false}, // a public name that turns private
		{public, "example.com", "10.1.2.3", false},
		{public, "example.com", "172.20.0.1", false},
		{public, "example.com", "192.168.1.1", false},
		{public, "example.com", "169.254.169.254", false},
		{public, "example.com", "100.64.0.1", false},
		{public, "example.com", "0.0.0.0", false},
		{public, "example.com", "224.0.0.1", false},
		{public, "example.com", "::1", false},
		{public, "example.com", "::", false},
		{public, "example.com", "fd00::1", false},
		{public, "example.com", "fe80::1", false},
		{public, "example.com", "ff02::1", false},
		{public, "example.com", "::ffff:127.0.0.1", false},
		{home, "nas.home", "192.168.1.20", true},
		{home, "NAS.home.", "192.168.1.20", true},
		{home, "nas.home", "93.184.215.14", true},
		{home, "router.home", "192.168.1.1", false}, // private, but another host
		{home, "nas.home", "0.0.0.0", false},
		{home, "nas.home", "239.1.1.1", false},
	} {
		err := c.g.allow(c.host, netip.MustParseAddr(c.addr))
		if (err == nil) != c.ok {
			t.Errorf("%+v %s %s: %v", c.g, c.host, c.addr, err)
		}
	}
}

func TestClientRefusesPrivateForPublicBookmark(t *testing.T) {
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hit = true }))
	defer srv.Close()
	c := guard{owner: "example.com"}.client()
	_, err := c.Get(srv.URL)
	if err == nil || !errors.Is(err, errBlocked) || hit {
		t.Fatalf("loopback reached for a public bookmark: %v", err)
	}
}

func TestClientAllowsOwnPrivateHostOnly(t *testing.T) {
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(pngBytes(square(8, color.White, color.RGBA{1, 1, 1, 255})))
	}))
	defer other.Close()
	otherURL, _ := url.Parse(other.URL)
	// The same loopback server under another name.
	elsewhere := "http://localhost:" + otherURL.Port()

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<head><link rel="icon" href="` + elsewhere + `/a.png"></head>`))
	})
	mux.HandleFunc("/hop", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere+"/a.png", http.StatusFound)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := NewClient(context.Background(), srv.URL+"/")
	if resp, err := c.Get(srv.URL + "/"); err != nil {
		t.Fatalf("own private host refused: %v", err)
	} else {
		resp.Body.Close()
	}
	// A redirect to another private host is refused at the dial.
	if _, err := c.Get(srv.URL + "/hop"); !errors.Is(err, errBlocked) {
		t.Errorf("redirect to another private host: %v", err)
	}
	// So is an icon the page points at on another private host.
	if _, err := Find(context.Background(), c, srv.URL+"/"); err == nil {
		t.Error("icon fetched from another private host")
	}
}

func TestClientRedirectLimits(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/loop/{n}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/loop/"+r.PathValue("n")+"x", http.StatusFound)
	})
	mux.HandleFunc("/five", func(w http.ResponseWriter, r *http.Request) {
		hops := len(r.URL.Query().Get("h"))
		if hops < maxRedirects {
			http.Redirect(w, r, "/five?h="+strings.Repeat("x", hops+1), http.StatusFound)
		}
	})
	mux.HandleFunc("/file", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "file:///etc/passwd", http.StatusFound)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := NewClient(context.Background(), srv.URL)

	if resp, err := c.Get(srv.URL + "/five"); err != nil {
		t.Errorf("five redirects refused: %v", err)
	} else {
		resp.Body.Close()
	}
	if _, err := c.Get(srv.URL + "/loop/x"); err == nil || !strings.Contains(err.Error(), "too many redirects") {
		t.Errorf("endless redirects: %v", err)
	}
	if _, err := c.Get(srv.URL + "/file"); err == nil || !strings.Contains(err.Error(), "refused") {
		t.Errorf("redirect to file: %v", err)
	}
}

// The IANA special purpose ranges are refused, and an address that carries
// an IPv4 address inside (NAT64, 6to4) is judged by that address.
func TestGuardSpecialRanges(t *testing.T) {
	public := guard{owner: "example.com"}
	home := guard{owner: "nas.home", private: true}
	for _, c := range []struct {
		g    guard
		addr string
		ok   bool
	}{
		{public, "64:ff9b::a9fe:a9fe", false}, // NAT64 of 169.254.169.254
		{public, "64:ff9b::a00:1", false},     // NAT64 of 10.0.0.1
		{public, "64:ff9b::5db8:d70e", true},  // NAT64 of a public address
		{public, "64:ff9b:1::a00:1", false},
		{public, "2002:a9fe:a9fe::1", false}, // 6to4 of 169.254.169.254
		{public, "2002:5db8:d70e::1", true},  // 6to4 of a public address
		{public, "2001:0:4136:e378::1", false},
		{public, "2001:db8::1", false},
		{public, "3fff::1", false},
		{public, "5f00::1", false},
		{public, "100::1", false},
		{public, "::10.0.0.1", false},
		{public, "::93.184.215.14", false},
		{public, "fec0::1", false},
		{public, "192.0.0.1", false},
		{public, "192.0.2.1", false},
		{public, "192.88.99.1", false},
		{public, "198.18.0.1", false},
		{public, "198.19.255.255", false},
		{public, "198.51.100.1", false},
		{public, "203.0.113.1", false},
		{public, "240.0.0.1", false},
		{public, "255.255.255.255", false},
		{public, "198.20.0.1", true},
		{home, "64:ff9b::c0a8:101", false}, // NAT64 of 192.168.1.1 on a name that is not the bookmark's
	} {
		err := c.g.allow("example.com", netip.MustParseAddr(c.addr))
		if (err == nil) != c.ok {
			t.Errorf("%s: %v", c.addr, err)
		}
	}
	if !isPrivate(netip.MustParseAddr("64:ff9b::7f00:1")) || isPrivate(netip.MustParseAddr("64:ff9b::5db8:d70e")) {
		t.Error("isPrivate misjudges NAT64")
	}
}

// Only 80, 443 and the bookmark's own port may be dialled.
func TestGuardPorts(t *testing.T) {
	g := guard{owner: "example.com", port: "8443"}
	for port, ok := range map[string]bool{"80": true, "443": true, "8443": true, "22": false, "6379": false, "": false} {
		if err := g.allowPort("example.com", port); (err == nil) != ok {
			t.Errorf("port %q: %v", port, err)
		}
	}
	if err := (guard{}).allowPort("example.com", "8080"); err == nil {
		t.Error("8080 allowed for a bookmark without a port")
	}
	// A page or redirect pointing at another port is refused at the dial.
	hit := false
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hit = true }))
	defer other.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("/hop", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, strings.Replace(other.URL, "127.0.0.1", "localhost", 1), http.StatusFound)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c := NewClient(context.Background(), strings.Replace(srv.URL, "127.0.0.1", "localhost", 1))
	if _, err := c.Get(strings.Replace(srv.URL, "127.0.0.1", "localhost", 1) + "/hop"); !errors.Is(err, errBlocked) || hit {
		t.Errorf("redirect to another port of the own host: %v", err)
	}
}
