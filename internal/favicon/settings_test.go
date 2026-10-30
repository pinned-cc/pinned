package favicon

import (
	"context"
	"errors"
	"image/color"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/pinned-cc/pinned/internal/store"
)

// ICONS=off: nothing is queued and nothing is fetched. ICON_HOSTS: only the
// hosts on the list are reached.
func TestPoolSettings(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Write(pngBytes(square(8, color.White, color.RGBA{10, 20, 30, 255})))
	}))
	defer srv.Close()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	b, _, err := st.Create(store.NewBookmark{Title: "Local", URL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}

	p := &Pool{dir: dir, store: st, jobs: make(chan int64, 1)}
	p.Configure(true, nil)
	p.Enqueue(b.ID)
	p.Run(b.ID)
	if len(p.jobs) != 0 || hits.Load() != 0 {
		t.Errorf("ICONS=off: %d queued, %d requests", len(p.jobs), hits.Load())
	}

	hosts, _ := ParseHosts("example.com")
	p.Configure(false, hosts)
	p.Run(b.ID)
	if got, _ := st.Bookmark(b.ID); got.Icon != nil || hits.Load() != 0 {
		t.Errorf("host outside ICON_HOSTS fetched: %d requests", hits.Load())
	}

	hosts, _ = ParseHosts(" Example.com , 127.0.0.1 ")
	p.Configure(false, hosts)
	p.Run(b.ID)
	if got, _ := st.Bookmark(b.ID); got.Icon == nil {
		t.Error("host in ICON_HOSTS not fetched")
	}

	// A page on a listed host that points at another host is refused there.
	c := newClient(context.Background(), srv.URL, hosts)
	other := strings.Replace(srv.URL, "127.0.0.1", "localhost", 1)
	if _, err := c.Get(other); !errors.Is(err, errBlocked) {
		t.Errorf("unlisted host reached: %v", err)
	}
}

func TestParseHosts(t *testing.T) {
	h, err := ParseHosts("example.com, .Sub.Example.org., ,")
	if err != nil || len(h) != 2 {
		t.Fatalf("%v %v", h, err)
	}
	for host, ok := range map[string]bool{"example.com": true, "cdn.example.com": true, "EXAMPLE.COM.": true,
		"example.org": false, "a.sub.example.org": true, "badexample.com": false} {
		if h.Allow(host) != ok {
			t.Errorf("%s: want %v", host, ok)
		}
	}
	if !Hosts(nil).Allow("anything.example") {
		t.Error("an empty list refuses")
	}
	for _, bad := range []string{"https://example.com", "example.com:443", "*.example.com"} {
		if _, err := ParseHosts(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}
