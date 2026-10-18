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
