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

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
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

// An icon file no bookmark names, such as a PNG kept after the re-encode
// of 0.1.11 for a way back with the database copy, is not served, in the
// app or in a share.
func TestUnnamedIconFileNotServed(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	g := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Shared"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com", "folder_id": g.ID}, 201))
	e.iconFor(b.ID, "https://example.com/", "1-bbbbbbbb.png")
	if err := os.WriteFile(filepath.Join(e.dir, "icons", "1-aaaaaaaa.png"), []byte("\x89PNG\r\n\x1a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{}, 201))
	v := e.visitor()
	for path, want := range map[string]int{
		"/icons/1-bbbbbbbb.png": 200,
		"/icons/1-aaaaaaaa.png": 404,
	} {
		resp := e.get(path)
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("%s: %d, want %d", path, resp.StatusCode, want)
		}
	}
	for path, want := range map[string]int{
		"/s/" + sh.Token + "/icons/1-bbbbbbbb.png": 200,
		"/s/" + sh.Token + "/icons/1-aaaaaaaa.png": 404,
	} {
		if code, _ := v.get(path); code != want {
			t.Errorf("%s: %d, want %d", path, code, want)
		}
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

// A URL that sits only in a locked folder answers like a URL not saved at
// all, for a session and for a token: check finds nothing, a save makes a
// new bookmark, an import brings it in, an edit or a restore to it goes
// through. A duplicate the caller can see is still refused, and after
// unlocking both bookmarks show.
func TestLockedDuplicateIsNotTold(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	tok := e.newToken("ext")
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	u := "https://example.org/portal"
	fresh := func(body []byte) {
		t.Helper()
		if s := strings.TrimSpace(string(body)); s != `{"duplicate":null,"icon":null}` {
			t.Errorf("check: %s", s)
		}
	}
	fresh(e.expect("GET", "/api/check?url="+url.QueryEscape(u), nil, 200))
	resp := e.bearer("GET", "/api/check?url="+url.QueryEscape(u), tok, nil)
	fresh(readAll(resp))

	// A token saves it as new.
	resp = e.bearer("POST", "/api/bookmarks", tok, map[string]any{"url": u})
	saved := decode[bookmarkJSON](t, readAll(resp))
	if resp.StatusCode != 201 || saved.ID == f.inClient.ID {
		t.Fatalf("token save: %d %+v", resp.StatusCode, saved)
	}
	// Now it is visible once: a second save is refused with that one.
	out := decode[map[string]any](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": u}, 409))
	if d, _ := out["duplicate"].(map[string]any); d == nil || int64(d["id"].(float64)) != saved.ID {
		t.Errorf("visible duplicate: %v", out)
	}
	chk := decode[map[string]any](t, e.expect("GET", "/api/check?url="+url.QueryEscape(u), nil, 200))
	if d, _ := chk["duplicate"].(map[string]any); d == nil || int64(d["id"].(float64)) != saved.ID {
		t.Errorf("check after the save: %v", chk)
	}

	// An edit of another bookmark to the address of the hidden one in Work.
	board := "https://example.com/board"
	e.expect("PATCH", "/api/bookmarks/"+itoa(f.plain.ID), map[string]any{"url": board}, 200)
	// A restore of a bookmark whose address was saved again, but only in
	// the locked folder.
	temp := "https://example.org/temp"
	tmp := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": temp}, 201))
	e.expect("DELETE", "/api/bookmarks/"+itoa(tmp.ID), nil, 204)
	if _, _, err := e.st.Create(store.NewBookmark{URL: temp, FolderID: &f.client.ID}); err != nil {
		t.Fatal(err)
	}
	e.expect("POST", "/api/bookmarks/"+itoa(tmp.ID)+"/restore", nil, 204)

	// An import brings in an address that is only in the locked folder.
	code, body := e.upload([]byte(`<DL><p><DT><A HREF="https://example.org/portal">p</A><DT><A HREF="https://example.com/fresh-import">f</A></DL><p>`))
	if code != 200 || !strings.Contains(string(body), `"skipped":1`) {
		t.Errorf("import: %d %s", code, body) // the portal is visible now, so it is the one skipped
	}

	// After unlocking, the hidden bookmarks show beside the new ones.
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	st := e.state()
	count := func(addr string) int {
		n := 0
		for _, b := range st.Bookmarks {
			if b.URL == addr {
				n++
			}
		}
		return n
	}
	if count(u) != 2 || count(board) != 2 || count(temp) != 2 {
		t.Errorf("after unlock: portal %d, board %d, temp %d", count(u), count(board), count(temp))
	}
	// Unlocked, the folder's bookmarks count as saved again.
	e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com/board"}, 409)
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

// fillCap records wrong tries from as many addresses as the global
// cap allows, so every browser that is not known has to wait.
func fillCap(l *auth.Limiter) {
	for i := 0; i < auth.GlobalMaxFails; i++ {
		l.Fail("192.0.2." + itoa(int64(i)))
	}
}

// One share link holder filling the global cap holds only that share, and
// a browser that has logged in before is never held by it.
func TestShareLimitIsPerShare(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	a := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "A"}, 201))
	b := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "B"}, 201))
	ta := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(a.ID)+"/share", map[string]any{"password": "password a"}, 201)).Token
	tb := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(b.ID)+"/share", map[string]any{"password": "password b"}, 201)).Token
	sa, _ := e.st.ShareByToken(ta)
	fillCap(e.server.shareLimiters.get(sa.ID))
	if code := e.visitor().unlock(ta, "password a"); code != 429 {
		t.Errorf("share A over its cap: %d", code)
	}
	if code := e.visitor().unlock(tb, "password b"); code != 204 {
		t.Errorf("share B held by share A's cap: %d", code)
	}
	// The owner's browser carries a device cookie and is counted on its own.
	resp, err := e.client.Post(e.srv.URL+"/s/"+ta+"/unlock", "application/json", strings.NewReader(`{"password":"password a"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 204 {
		t.Errorf("known browser held by the cap: %d", resp.StatusCode)
	}
}

// The folder password limit is per folder, and spares known browsers too.
func TestFolderLimitIsPerFolderAndSparesKnownBrowsers(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.reading.ID)+"/lock", map[string]any{"password": "read"}, 204)
	fillCap(e.server.folderLimiters.get(f.work.ID))
	// This browser logged in with the password: not held.
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	// A session without a device cookie is held, for that folder only.
	var session string
	for _, c := range e.client.Jar.Cookies(mustURL(e.srv.URL + "/")) {
		if c.Name == CookieName {
			session = c.Value
		}
	}
	try := func(id int64, pw string) int {
		req, _ := http.NewRequest("POST", e.srv.URL+"/api/folders/"+itoa(id)+"/unlock", strings.NewReader(`{"password":"`+pw+`"}`))
		req.Header.Set("X-Requested-With", "fetch")
		req.Header.Set("Cookie", CookieName+"="+session)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := try(f.work.ID, "s3cret"); code != 429 {
		t.Errorf("unknown browser over the folder's cap: %d", code)
	}
	if code := try(f.reading.ID, "read"); code != 204 {
		t.Errorf("other folder held by the cap: %d", code)
	}
}

// A token is bound to the first extension origin that uses it: requests
// with any other Origin, extension or web, are refused, and requests
// without an Origin, from scripts, keep working.
func TestTokenBoundToFirstExtensionOrigin(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	tok := e.newToken("ext")
	call := func(origin string) *http.Response {
		req, _ := http.NewRequest("GET", e.srv.URL+"/api/folders", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		readAll(resp)
		return resp
	}
	if resp := call(""); resp.StatusCode != 200 {
		t.Fatalf("script without Origin: %d", resp.StatusCode)
	}
	first := "moz-extension://1111-2222"
	if resp := call(first); resp.StatusCode != 200 || resp.Header.Get("Access-Control-Allow-Origin") != first {
		t.Errorf("first extension: %d %v", resp.StatusCode, resp.Header)
	}
	if resp := call(first); resp.StatusCode != 200 {
		t.Errorf("same extension again: %d", resp.StatusCode)
	}
	for _, other := range []string{"chrome-extension://other", "moz-extension://3333-4444"} {
		if resp := call(other); resp.StatusCode != 403 {
			t.Errorf("other extension %s: %d", other, resp.StatusCode)
		}
	}
	for _, other := range []string{"https://evil.example", "null"} {
		if resp := call(other); resp.StatusCode != 403 || resp.Header.Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("origin %s with a bound token: %d %v", other, resp.StatusCode, resp.Header)
		}
	}
	e.wantEvent("token.refused", 4)
	if resp := call(""); resp.StatusCode != 200 {
		t.Errorf("script after binding: %d", resp.StatusCode)
	}
	// A token not bound yet is not bound by a web origin.
	tok = e.newToken("ext 2")
	if resp := call("https://evil.example"); resp.StatusCode != 200 {
		t.Errorf("unbound token from a web origin: %d", resp.StatusCode)
	}
	// A new token is free again.
	if resp := call("chrome-extension://other"); resp.StatusCode != 200 {
		t.Errorf("new token from another extension: %d", resp.StatusCode)
	}
}
