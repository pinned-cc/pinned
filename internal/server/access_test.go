package server

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

// Moving a shared folder into a locked one ends its share, in the same
// step, as locking does.
func TestMoveIntoLockedFolderEndsShare(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.reading.ID)+"/share", map[string]any{}, 201))
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	e.expect("PATCH", "/api/folders/"+itoa(f.reading.ID), map[string]any{"parent_id": f.client.ID}, 200)
	if _, err := e.st.ShareByToken(sh.Token); err == nil {
		t.Error("share survived the move into a locked folder")
	}
	if code, _ := e.visitor().get("/s/" + sh.Token + "/data"); code != 404 {
		t.Errorf("share data after the move: %d", code)
	}
}

// A share left under a lock by an older version is dead while locked, hidden
// from the owner's writes while locked, and removed with the lock.
func TestLeftoverShareUnderLock(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	// What an older version left: a share inside the locked folder.
	sh, err := e.st.CreateShare(f.client.ID, "leftoverleftoverleftoverleftover", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	v := e.visitor()
	for _, p := range []string{"", "/data"} {
		if code, _ := v.get("/s/" + sh.Token + p); code != 404 {
			t.Errorf("leftover share %q: %d", p, code)
		}
	}
	e.expect("PATCH", "/api/shares/"+sh.Token, map[string]any{"expires_days": 1}, 404)
	e.expect("DELETE", "/api/shares/"+sh.Token, nil, 404)
	e.expect("DELETE", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"app_password": "pw"}, 204)
	if _, err := e.st.ShareByToken(sh.Token); err == nil {
		t.Error("leftover share came back with the lock removed")
	}
}

// withToken sends a request from v with the share token in the header, the
// way share.js does for a link of the form /s/#<token>.
func (v *visitor) withToken(method, path, token, body string) (int, string) {
	v.t.Helper()
	req, _ := http.NewRequest(method, v.e.srv.URL+path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("X-Share-Token", token)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := v.client.Do(req)
	if err != nil {
		v.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// New share links carry the token in the fragment; the page sends it in a
// header, so it is never in a path a proxy logs.
func TestShareTokenInFragment(t *testing.T) {
	e := newEnv(t, Config{BaseURL: "http://homelab:9095"})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Docs", "url": "https://example.com/docs", "folder_id": f.ID}, 201))
	e.iconFor(b.ID, "https://example.com/docs", "d.png")
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.ID)+"/share", map[string]any{"password": "open sesame"}, 201))
	if sh.URL != "http://homelab:9095/s/#"+sh.Token {
		t.Fatalf("link: %s", sh.URL)
	}
	v := e.visitor()
	resp, err := v.client.Get(e.srv.URL + "/s/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Security-Policy"), "img-src 'self' data: blob:") ||
		resp.Header.Get("Referrer-Policy") != "no-referrer" {
		t.Errorf("share page: %d %v", resp.StatusCode, resp.Header)
	}
	if code, _ := v.withToken("GET", "/s/-/data", "", ""); code != 404 {
		t.Errorf("data without a token: %d", code)
	}
	if code, _ := v.withToken("GET", "/s/-/data", "nope", ""); code != 404 {
		t.Errorf("data with a wrong token: %d", code)
	}
	if code, body := v.withToken("GET", "/s/-/data", sh.Token, ""); code != 200 || !strings.Contains(body, `"locked":true`) {
		t.Errorf("locked data: %d %s", code, body)
	}
	if code, _ := v.withToken("POST", "/s/-/unlock", sh.Token, `{"password":"wrong"}`); code != 401 {
		t.Errorf("wrong password: %d", code)
	}
	if code, _ := v.withToken("POST", "/s/-/unlock", sh.Token, `{"password":"open sesame"}`); code != 204 {
		t.Fatalf("right password: %d", code)
	}
	code, body := v.withToken("GET", "/s/-/data", sh.Token, "")
	d := decode[sharedData](t, []byte(body))
	if code != 200 || len(d.Bookmarks) != 1 || d.Bookmarks[0].Icon == nil || *d.Bookmarks[0].Icon != "/s/-/icons/d.png" || strings.Contains(body, sh.Token) {
		t.Errorf("data: %d %s", code, body)
	}
	if code, _ := v.withToken("GET", "/s/-/icons/d.png", sh.Token, ""); code != 200 {
		t.Errorf("icon with the token: %d", code)
	}
	if code, _ := v.withToken("GET", "/s/-/icons/d.png", "", ""); code != 404 {
		t.Errorf("icon without the token: %d", code)
	}
	// The unlock cookie is the share's own, for every share route.
	var found bool
	for _, c := range v.client.Jar.Cookies(mustURL(e.srv.URL + "/s/")) {
		if strings.HasPrefix(c.Name, "pinned_share_") && !strings.Contains(c.Name, "seen") {
			found = true
		}
	}
	if !found {
		t.Error("no unlock cookie under /s/")
	}
	// The same browser opens the old form of the link without the password again.
	if code, body := v.get("/s/" + sh.Token + "/data"); code != 200 || strings.Contains(body, `"locked"`) {
		t.Errorf("old link after unlock: %d %s", code, body)
	}
}

// An unlock cookie from before 0.1.11, set on the path of the old link,
// still opens it.
func TestOldShareCookieStillWorks(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	tok := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.ID)+"/share", map[string]any{"password": "open sesame"}, 201)).Token
	sh, err := e.st.ShareByToken(tok)
	if err != nil {
		t.Fatal(err)
	}
	exp := e.st.Now().Add(time.Hour).Unix()
	req, _ := http.NewRequest("GET", e.srv.URL+"/s/"+tok+"/data", nil)
	req.AddCookie(&http.Cookie{Name: "pinned_share", Value: e.server.unlockValue(sh, exp)})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if body := string(readAll(resp)); resp.StatusCode != 200 || strings.Contains(body, `"locked"`) {
		t.Errorf("old cookie: %d %s", resp.StatusCode, body)
	}
}

// overHTTPS sends a request as if through an HTTPS proxy, with the given
// Cookie header, and returns the response with its body read.
func overHTTPS(t *testing.T, e *env, method, path, cookie, body string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Requested-With", "fetch")
	req.Header.Set("Content-Type", "application/json")
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp
}

// Over HTTPS the folder unlock cookie is __Host- and the share cookies are
// __Secure-; the plain names still work during the move.
func TestUnlockAndShareCookiePrefixes(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	login := loginOver(t, e, true)
	session := "__Host-" + CookieName + "=" + cookieNamed(login, "__Host-"+CookieName).Value

	resp := overHTTPS(t, e, "POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", session, `{"password":"s3cret"}`)
	name := "__Host-pinned_unlock_" + itoa(f.work.ID)
	c := cookieNamed(resp, name)
	if resp.StatusCode != 204 || c == nil || !c.Secure || c.Path != "/" || c.Domain != "" || cookieNamed(resp, "pinned_unlock_"+itoa(f.work.ID)) != nil {
		t.Fatalf("unlock over https: %d %v", resp.StatusCode, resp.Cookies())
	}
	for _, ck := range []string{name + "=" + c.Value, "pinned_unlock_" + itoa(f.work.ID) + "=" + c.Value} {
		req, _ := http.NewRequest("GET", e.srv.URL+"/api/state", nil)
		req.Header.Set("X-Forwarded-Proto", "https")
		req.Header.Set("Cookie", session+"; "+ck)
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		st := decode[stateJSON](t, readAll(r))
		if st.find(f.inClient.ID) == nil {
			t.Errorf("cookie %s does not open the folder", ck[:strings.Index(ck, "=")])
		}
	}
	// Locking again clears both names.
	resp = overHTTPS(t, e, "POST", "/api/folders/"+itoa(f.work.ID)+"/relock", session, "")
	if a, b := cookieNamed(resp, name), cookieNamed(resp, "pinned_unlock_"+itoa(f.work.ID)); a == nil || b == nil || a.MaxAge >= 0 || b.MaxAge >= 0 {
		t.Errorf("relock: %v", resp.Cookies())
	}

	tok := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.reading.ID)+"/share", map[string]any{"password": "open sesame"}, 201)).Token
	sh, _ := e.st.ShareByToken(tok)
	resp = overHTTPS(t, e, "POST", "/s/"+tok+"/unlock", "", `{"password":"open sesame"}`)
	u := cookieNamed(resp, "__Secure-pinned_share_"+itoa(sh.ID))
	if resp.StatusCode != 204 || u == nil || !u.Secure || u.Path != "/s/" {
		t.Fatalf("share unlock over https: %d %v", resp.StatusCode, resp.Cookies())
	}
	resp = overHTTPS(t, e, "GET", "/s/"+tok+"/data", "__Secure-pinned_share_"+itoa(sh.ID)+"="+u.Value, "")
	if seen := cookieNamed(resp, "__Secure-pinned_share_seen_"+itoa(sh.ID)); resp.StatusCode != 200 || seen == nil || !seen.Secure {
		t.Errorf("share data over https: %d %v", resp.StatusCode, resp.Cookies())
	}
}

// A device cookie set over plain HTTP, or by an older version, moves to the
// __Host- name when it comes over HTTPS, with the same id.
func TestDeviceCookieUpgradesOverHTTPS(t *testing.T) {
	e := newEnv(t, Config{})
	plain := cookieNamed(loginOver(t, e, false), deviceCookie)
	if plain == nil || plain.Secure {
		t.Fatal("no plain device cookie")
	}
	login := loginOver(t, e, true)
	session := cookieNamed(login, "__Host-"+CookieName)
	if session == nil {
		t.Fatal("no session over https")
	}
	resp := overHTTPS(t, e, "GET", "/api/state", "__Host-"+CookieName+"="+session.Value+"; "+deviceCookie+"="+plain.Value, "")
	up, old := cookieNamed(resp, "__Host-"+deviceCookie), cookieNamed(resp, deviceCookie)
	if resp.StatusCode != 200 || up == nil || up.Value != plain.Value || !up.Secure || old == nil || old.MaxAge >= 0 {
		t.Errorf("device cookie not upgraded: %d %v", resp.StatusCode, resp.Cookies())
	}
	// A login over HTTPS with the plain cookie upgrades it too, and mints no new id.
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/login", strings.NewReader(`{"password":"pw"}`))
	req.Header.Set("X-Requested-With", "fetch")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("Cookie", deviceCookie+"="+plain.Value)
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if up := cookieNamed(r, "__Host-"+deviceCookie); up == nil || up.Value != plain.Value {
		t.Errorf("login did not upgrade the device cookie: %v", r.Cookies())
	}
}
