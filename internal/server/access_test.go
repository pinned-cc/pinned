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
