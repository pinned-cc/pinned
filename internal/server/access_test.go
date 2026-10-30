package server

import (
	"net/url"
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

// The export in the app leaves out a locked folder until it is unlocked in
// this browser; the nightly export on disk keeps it.
func TestExportLeavesOutLockedFolders(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	body := string(readAll(e.get("/api/export")))
	if strings.Contains(body, "example.org/portal") || strings.Contains(body, "example.com/board") ||
		strings.Contains(body, ">Work</H3>") || strings.Contains(body, ">Client</H3>") || !strings.Contains(body, "https://example.net/a") {
		t.Errorf("export while locked: %s", body)
	}
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	body = string(readAll(e.get("/api/export")))
	if !strings.Contains(body, "https://example.org/portal") || !strings.Contains(body, ">Client</H3>") {
		t.Errorf("export after unlock lost the links: %s", body)
	}
	tree, err := e.st.ExportTree()
	if err != nil || len(tree.Folders) != 2 {
		t.Errorf("nightly export tree: %v %+v", err, tree)
	}
}

// A URL in a locked folder answers the same everywhere: saved, in a locked
// folder, with nothing about the bookmark itself.
func TestLockedDuplicateAnswersAlike(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	u := "https://example.org/portal"
	chk := decode[map[string]any](t, e.expect("GET", "/api/check?url="+url.QueryEscape(u), nil, 200))
	if chk["locked"] != true || chk["duplicate"] != nil || chk["icon"] != nil {
		t.Errorf("check: %v", chk)
	}
	for _, force := range []bool{false, true} {
		out := decode[map[string]any](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": u, "force": force}, 409))
		if out["locked"] != true || out["duplicate"] != nil {
			t.Errorf("save (force %v): %v", force, out)
		}
	}
	// A URL that is not saved anywhere carries no locked flag.
	chk = decode[map[string]any](t, e.expect("GET", "/api/check?url="+url.QueryEscape("https://example.org/new"), nil, 200))
	if _, ok := chk["locked"]; ok {
		t.Errorf("check of a new URL: %v", chk)
	}
}

// /health gives no bookmark count, which would count locked folders too.
func TestHealthHasNoCount(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	h := decode[map[string]any](t, readAll(e.get("/health")))
	if _, ok := h["bookmarks"]; ok || h["ok"] != true {
		t.Errorf("health: %v", h)
	}
}

// /icons serves an icon only when a bookmark the session can see uses it.
func TestIconsOnlyOfVisibleBookmarks(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.iconFor(f.inClient.ID, "https://example.org/portal", "locked.png")
	e.iconFor(f.plain.ID, "https://example.net/a", "open.png")
	inbox := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com/inbox"}, 201))
	e.iconFor(inbox.ID, "https://example.com/inbox", "inbox.png")
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	status := func(name string) int {
		resp := e.get("/icons/" + name)
		resp.Body.Close()
		return resp.StatusCode
	}
	if status("open.png") != 200 || status("inbox.png") != 200 {
		t.Error("icon of a visible bookmark refused")
	}
	if code := status("locked.png"); code != 404 {
		t.Errorf("icon of a locked bookmark: %d", code)
	}
	if code := status("nothing.png"); code != 404 {
		t.Errorf("icon nobody uses: %d", code)
	}
	// The same icon on a visible bookmark makes it visible.
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	if code := status("locked.png"); code != 200 {
		t.Errorf("icon after unlock: %d", code)
	}
}
