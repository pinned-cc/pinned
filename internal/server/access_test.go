package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// iconFor gives bookmark id the icon file name in DATA_DIR/icons.
func (e *env) iconFor(id int64, rawURL, name string) {
	e.t.Helper()
	if err := os.WriteFile(filepath.Join(e.dir, "icons", name), []byte("\x89PNG\r\n\x1a\n"), 0o644); err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.st.SetIcon(id, rawURL, name, nil); err != nil {
		e.t.Fatal(err)
	}
}

// A fetched icon has its own policy, which must still refuse framing.
func TestIconPolicy(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com"}, 201))
	e.iconFor(b.ID, "https://example.com/", "e.png")
	resp := e.get("/icons/e.png")
	resp.Body.Close()
	csp := resp.Header.Get("Content-Security-Policy")
	if resp.StatusCode != 200 || !strings.Contains(csp, "frame-ancestors 'none'") || !strings.Contains(csp, "sandbox") || strings.Contains(csp, "script-src") {
		t.Errorf("icon: %d %q", resp.StatusCode, csp)
	}
}

// SVG answers name their charset, the app's icon and fetched icons alike.
func TestSVGCharset(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com"}, 201))
	if err := os.WriteFile(filepath.Join(e.dir, "icons", "e.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0o644); err != nil {
		t.Fatal(err)
	}
	e.st.SetIcon(b.ID, "https://example.com/", "e.svg", nil)
	for _, path := range []string{"/favicon.svg", "/icons/e.svg", "/static/icons/favicon.svg"} {
		resp := e.get(path)
		resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != svgType {
			t.Errorf("%s: %d %q", path, resp.StatusCode, resp.Header.Get("Content-Type"))
		}
	}
}
