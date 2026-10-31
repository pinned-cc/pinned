package favicon

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/pinned-cc/pinned/internal/store"
)

// A failed fetch writes one icon.fail line with the host and the kind of
// failure, never the path or query of the address.
func TestPoolRunLogsFailedFetches(t *testing.T) {
	selfSigned := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer selfSigned.Close()
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no", 500) }))
	defer down.Close()
	// Every address answers 200 with a page, so no icon decodes.
	noIconSite := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<title>x</title>"))
	}))
	defer noIconSite.Close()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closed := "http://" + l.Addr().String()
	l.Close()
	gone := &http.Client{Transport: failingTransport{&url.Error{Op: "Get", URL: "http://gone.example/", Err: &net.OpError{Op: "dial", Net: "tcp", Err: &net.DNSError{Err: "no such host", Name: "gone.example", IsNotFound: true}}}}}

	for _, c := range []struct {
		name, url, kind string
		client          *http.Client
	}{
		{"self signed", selfSigned.URL + "/secret/path?key=abc", "certificate", &http.Client{Transport: &http.Transport{}}},
		{"http error", down.URL + "/secret/path?key=abc", "http", nil},
		{"no icon", noIconSite.URL + "/deep/page?key=abc", "no_icon", nil},
		{"refused", closed + "/secret/path?key=abc", "unreachable", nil},
		{"no such host", "http://gone.example/secret/path?key=abc", "no_such_host", gone},
	} {
		t.Run(c.name, func(t *testing.T) {
			st := newTestStore(t)
			b, _, err := st.Create(store.NewBookmark{Title: c.name, URL: c.url})
			if err != nil {
				t.Fatal(err)
			}
			var lines []string
			p := &Pool{dir: t.TempDir(), store: st, client: c.client}
			p.SetLog(func(event string, kv ...any) { lines = append(lines, event+fmt.Sprint(kv...)) })
			p.Run(b.ID)
			if len(lines) != 1 {
				t.Fatalf("lines: %q", lines)
			}
			u, _ := url.Parse(c.url)
			if !strings.HasPrefix(lines[0], "icon.fail") || !strings.Contains(lines[0], "host"+u.Hostname()) ||
				strings.Contains(lines[0], "secret") || strings.Contains(lines[0], "key") || strings.Contains(lines[0], "deep") {
				t.Errorf("line %q", lines[0])
			}
			if c.kind != "" && !strings.HasSuffix(lines[0], "kind"+c.kind) {
				t.Errorf("line %q, want kind %s", lines[0], c.kind)
			}
		})
	}
}

func TestFailKind(t *testing.T) {
	if FailKind(nil) != "" || FailKind(fmt.Errorf("x")) != "other" {
		t.Error("kinds of nil and a plain error")
	}
	if failKind(fmt.Errorf("x: %w", errBlocked)) != "blocked" || failKind(errStatus(404)) != "http" {
		t.Error("blocked or http")
	}
}
