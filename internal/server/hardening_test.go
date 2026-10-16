package server

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
)

// upload posts a bookmark file to /api/import with the session.
func (e *env) upload(data []byte) (int, []byte) {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "bookmarks.html")
	fw.Write(data)
	mw.Close()
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/import", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Requested-With", "fetch")
	resp, err := e.client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

func TestTokenScope(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com/a"}, 201))
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.ID)+"/share", map[string]any{}, 201))
	tok := e.newToken("phone")

	call := func(method, path string, body any) (int, string) {
		resp := e.bearer(method, path, tok, body)
		out := readAll(resp)
		return resp.StatusCode, string(out)
	}
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/export", nil},
		{"POST", "/api/import", map[string]any{}},
		{"POST", "/api/folders/" + itoa(f.ID) + "/share", map[string]any{}},
		{"PATCH", "/api/shares/" + sh.Token, map[string]any{"password": nil}},
		{"DELETE", "/api/shares/" + sh.Token, nil},
		{"POST", "/api/folders/" + itoa(f.ID) + "/lock", map[string]any{"password": "s3cret pass"}},
		{"DELETE", "/api/folders/" + itoa(f.ID) + "/lock", map[string]any{"app_password": "pw"}},
		{"POST", "/api/folders/" + itoa(f.ID) + "/unlock", map[string]any{"password": "x"}},
		{"DELETE", "/api/trash", nil},
		{"DELETE", "/api/bookmarks/" + itoa(b.ID), nil},
		{"POST", "/api/bookmarks/bulk", map[string]any{"ids": []int64{b.ID}, "action": "delete"}},
		{"POST", "/api/folders", map[string]any{"name": "New"}},
		{"DELETE", "/api/folders/" + itoa(f.ID), nil},
		{"PATCH", "/api/folders/" + itoa(f.ID), map[string]any{"name": "x"}},
		{"GET", "/api/tokens", nil},
		{"POST", "/api/tokens", map[string]any{"name": "more"}},
		{"DELETE", "/api/tokens/1", nil},
		{"POST", "/api/logout", nil},
		{"GET", "/api/nothing", nil},
	} {
		code, body := call(c.method, c.path, c.body)
		if code != 403 || strings.TrimSpace(body) != `{"error":"not allowed with a token"}` {
			t.Errorf("%s %s with a token: %d %s", c.method, c.path, code, body)
		}
	}
	// Nothing changed.
	st := e.state()
	if st.find(b.ID) == nil || st.find(b.ID).DeletedAt != nil || len(st.Folders) != 1 || st.Folders[0].Share == nil {
		t.Errorf("a refused call changed something: %+v", st)
	}

	// The allowed calls work; PATCH takes only title and folder_id.
	for _, path := range []string{"/api/state", "/api/folders", "/api/check?url=https://example.com/a"} {
		if code, body := call("GET", path, nil); code != 200 {
			t.Errorf("GET %s with a token: %d %s", path, code, body)
		}
	}
	if code, _ := call("PATCH", "/api/bookmarks/"+itoa(b.ID), map[string]any{"title": "Renamed", "folder_id": f.ID}); code != 200 {
		t.Errorf("rename and move with a token: %d", code)
	}
	for _, body := range []map[string]any{{"url": "https://example.com/b"}, {"pinned": true}, {"title": "x", "pinned": true}} {
		if code, out := call("PATCH", "/api/bookmarks/"+itoa(b.ID), body); code != 400 {
			t.Errorf("PATCH %v with a token: %d %s", body, code, out)
		}
	}
	if got := e.state().find(b.ID); got.Title != "Renamed" || got.Pinned || got.URL != "https://example.com/a" {
		t.Errorf("after token patches: %+v", got)
	}
	if code, _ := call("POST", "/api/bookmarks", map[string]any{"url": "https://example.com/new"}); code != 201 {
		t.Errorf("save with a token: %d", code)
	}
}

func TestTokenStateHidesLockedFolders(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	tok := e.newToken("ext")
	// The session is unlocked, the token never is.
	body := string(readAll(e.bearer("GET", "/api/state", tok, nil)))
	if strings.Contains(body, "portal") || strings.Contains(body, "Client") || !strings.Contains(body, "Article") {
		t.Errorf("token state shows the locked folder: %s", body)
	}
}

func TestClientKeyAndTrustedProxies(t *testing.T) {
	proxies, err := ParseProxies(" 10.0.0.0/8, 192.0.2.7 ,2001:db8:ffff::/48")
	if err != nil || len(proxies) != 3 {
		t.Fatalf("parse: %v %v", proxies, err)
	}
	if _, err := ParseProxies("10.0.0.0/8, nope"); err == nil {
		t.Error("bad entry accepted")
	}
	if p, _ := ParseProxies(""); len(p) != 0 {
		t.Error("empty should give none")
	}
	s := &Server{cfg: Config{TrustedProxies: proxies}}
	key := func(remote string, xff ...string) string {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = remote
		for _, v := range xff {
			r.Header.Add("X-Forwarded-For", v)
		}
		return s.clientKey(r)
	}
	for _, c := range []struct {
		remote string
		xff    []string
		want   string
	}{
		{"203.0.113.9:5000", []string{"198.51.100.1"}, "203.0.113.9"},                  // not a proxy: header ignored
		{"10.1.2.3:5000", []string{"198.51.100.1"}, "198.51.100.1"},                    // proxy: header used
		{"10.1.2.3:5000", []string{"6.6.6.6, 198.51.100.1, 10.9.9.9"}, "198.51.100.1"}, // first untrusted from the right
		{"10.1.2.3:5000", []string{"6.6.6.6", "198.51.100.1, 192.0.2.7"}, "198.51.100.1"},
		{"10.1.2.3:5000", []string{"garbage, 10.2.2.2"}, "10.2.2.2"},
		{"10.1.2.3:5000", nil, "10.1.2.3"},
		{"[2001:db8:1:2:3:4:5:6]:5000", nil, "2001:db8:1:2::/64"},
		{"[2001:db8:1:2:aaaa::1]:5000", nil, "2001:db8:1:2::/64"},
		{"[2001:db8:ffff:1::1]:5000", []string{"2001:db8:9:9::7"}, "2001:db8:9:9::/64"},
		{"[::ffff:203.0.113.9]:5000", nil, "203.0.113.9"},
	} {
		if got := key(c.remote, c.xff...); got != c.want {
			t.Errorf("%s %v: got %s want %s", c.remote, c.xff, got, c.want)
		}
	}
	// Without TRUSTED_PROXIES the header is never read.
	plain := &Server{}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.1.2.3:1"
	r.Header.Set("X-Forwarded-For", "198.51.100.1")
	if got := plain.clientKey(r); got != "10.1.2.3" {
		t.Errorf("header trusted without proxies: %s", got)
	}
}

func TestLimitsCountPerAddressBehindProxy(t *testing.T) {
	proxies, _ := ParseProxies("127.0.0.1")
	e := newEnv(t, Config{TrustedProxies: proxies})
	login := func(from, pw string) int {
		req, _ := http.NewRequest("POST", e.srv.URL+"/api/login", strings.NewReader(`{"password":"`+pw+`"}`))
		req.Header.Set("X-Requested-With", "fetch")
		req.Header.Set("X-Forwarded-For", from)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	for i := 0; i < 5; i++ {
		login("198.51.100.1", "wrong")
	}
	if code := login("198.51.100.1", "wrong"); code != 429 {
		t.Errorf("attacker not limited: %d", code)
	}
	if code := login("198.51.100.2", "wrong"); code != 401 {
		t.Errorf("another client behind the same proxy is blocked: %d", code)
	}
}

func TestSafeNext(t *testing.T) {
	for in, want := range map[string]string{
		"":                       "/",
		"/":                      "/",
		"/save?url=x":            "/save?url=x",
		"/bookmarklet#a":         "/bookmarklet#a",
		"//evil.example":         "/",
		"/\\evil.example":        "/",
		"/\t/evil.example":       "/",
		"/\n/evil.example":       "/",
		"/\r\n/evil.example":     "/",
		"/%09/evil.example":      "/%09/evil.example", // stays a path on this site
		"https://evil.example/":  "/",
		"javascript:alert(1)":    "/",
		"evil.example":           "/",
		"/ok\x7f":                "/",
		"\x00/x":                 "/",
		"http:/evil.example":     "/",
		"/a/../b":                "/a/../b",
		"/x?next=//evil.example": "/x?next=//evil.example",
	} {
		if got := safeNext(in); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", in, got, want)
		}
	}
	// End to end: the tab trick from the review lands on /.
	e := newEnv(t, Config{})
	resp, err := e.client.PostForm(e.srv.URL+"/login", url.Values{"password": {"pw"}, "next": {"/\t/evil.example"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.Header.Get("Location") != "/" {
		t.Errorf("tab redirect: %q", resp.Header.Get("Location"))
	}
	resp = e.get("/login?next=" + url.QueryEscape("/\t/evil.example"))
	resp.Body.Close()
	if resp.Header.Get("Location") != "/" {
		t.Errorf("logged in tab redirect: %q", resp.Header.Get("Location"))
	}
}

func TestSessionRenewedOnUse(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	cookie := func() *http.Cookie {
		for _, c := range e.client.Jar.Cookies(mustURL(e.srv.URL + "/")) {
			if c.Name == CookieName {
				return c
			}
		}
		t.Fatal("no session cookie")
		return nil
	}
	hash := func() string { return hashOf(e, cookie().Value) }
	first, _ := e.st.SessionExpiry(hash())

	// Used within a day: unchanged.
	e.st.Now = func() time.Time { return time.Now().Add(12 * time.Hour) }
	resp := e.get("/api/state")
	resp.Body.Close()
	if len(resp.Cookies()) != 0 {
		t.Error("renewed within a day")
	}
	if exp, _ := e.st.SessionExpiry(hash()); !exp.Equal(first) {
		t.Error("expiry moved within a day")
	}

	// Used after two days: renewed for the full 90 days, cookie too.
	later := time.Now().Add(48 * time.Hour)
	e.st.Now = func() time.Time { return later }
	resp = e.get("/api/state")
	resp.Body.Close()
	if resp.StatusCode != 200 || len(resp.Cookies()) != 1 || resp.Cookies()[0].MaxAge != 90*86400 {
		t.Fatalf("renew: %d %v", resp.StatusCode, resp.Cookies())
	}
	if exp, _ := e.st.SessionExpiry(hash()); exp.Unix() != later.Add(90*24*time.Hour).Unix() {
		t.Errorf("expiry %v", exp)
	}

	// Past the lifetime: logged out.
	e.st.Now = func() time.Time { return later.Add(91 * 24 * time.Hour) }
	if code, _ := e.do("GET", "/api/state", nil); code != 401 {
		t.Errorf("expired session: %d", code)
	}
}

func hashOf(e *env, token string) string {
	return authHash(e.server.secret, token)
}

func TestSecurityHeaders(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	check := func(path string) http.Header {
		resp := e.get(path)
		resp.Body.Close()
		return resp.Header
	}
	for _, path := range []string{"/static/save.html", "/static/app.js", "/", "/login", "/save?url=https://example.com", "/bookmarklet", "/health", "/api/state", "/manifest.webmanifest"} {
		h := check(path)
		if !strings.Contains(h.Get("Content-Security-Policy"), "frame-ancestors 'none'") ||
			!strings.Contains(h.Get("Content-Security-Policy"), "script-src 'self'") ||
			h.Get("X-Content-Type-Options") != "nosniff" ||
			h.Get("Referrer-Policy") != "strict-origin-when-cross-origin" ||
			h.Get("Permissions-Policy") != "camera=(), microphone=(), geolocation=()" ||
			h.Get("X-Frame-Options") != "DENY" {
			t.Errorf("%s headers: %v", path, h)
		}
	}
	if csp := check("/static/save.html").Get("Content-Security-Policy"); csp != contentSecurityPolicy {
		t.Errorf("save.html CSP %q", csp)
	}
}

func TestHealthWithSession(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com"}, 201)
	h := decode[map[string]any](t, readAll(e.get("/health")))
	if h["ok"] != true || h["bookmarks"] != 1.0 || h["version"] != "test" {
		t.Errorf("health with a session: %v", h)
	}
	if code, body := e.visitor().get("/health"); code != 200 || strings.TrimSpace(body) != `{"ok":true}` {
		t.Errorf("health without: %d %s", code, body)
	}
}

func TestImportNeverWritesIntoLockedFolder(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	file := `<DL><p>
<DT><H3>Work</H3>
<DL><p>
<DT><A HREF="https://example.com/board">known</A>
<DT><A HREF="https://example.com/new-one">new</A>
<DT><H3>Client</H3>
<DL><p><DT><A HREF="https://example.com/deeper">deeper</A></DL><p>
</DL><p>
</DL><p>`
	code, out := e.upload([]byte(file))
	if code != 200 {
		t.Fatalf("import: %d %s", code, out)
	}
	// The locked folder kept its two bookmarks and gained nothing.
	n := 0
	all, _ := e.st.Bookmarks()
	for _, b := range all {
		if b.FolderID != nil && (*b.FolderID == f.work.ID || *b.FolderID == f.client.ID) {
			n++
		}
	}
	if n != 2 {
		t.Errorf("locked folders now hold %d bookmarks", n)
	}
	folders, _ := e.st.Folders()
	var imported *store.Folder
	for i := range folders {
		if folders[i].Name == "Work (imported)" && folders[i].ParentID == nil {
			imported = &folders[i]
		}
	}
	if imported == nil {
		t.Fatalf("no Work (imported) folder: %+v", folders)
	}
	st := e.state()
	var inImported int
	for _, b := range st.Bookmarks {
		if b.FolderID != nil && *b.FolderID == imported.ID {
			inImported++
		}
	}
	if inImported != 1 { // known is skipped: the same URL is saved already
		t.Errorf("bookmarks in Work (imported): %d", inImported)
	}
	// A second import reuses the (imported) folder.
	e.upload([]byte(file))
	again, _ := e.st.Folders()
	if len(again) != len(folders) {
		t.Errorf("second import made new folders: %d to %d", len(folders), len(again))
	}
}

func TestImportLimits(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()

	// 40 nested folders: everything below depth 32 lands at depth 32.
	var b strings.Builder
	b.WriteString("<DL><p>\n")
	for i := 1; i <= 40; i++ {
		fmt.Fprintf(&b, "<DT><H3>L%d</H3>\n<DL><p>\n<DT><A HREF=\"https://example.com/%d\">%d</A>\n", i, i, i)
	}
	for i := 0; i <= 40; i++ {
		b.WriteString("</DL><p>\n")
	}
	code, out := e.upload([]byte(b.String()))
	res := decode[map[string]int](t, out)
	if code != 200 || res["added"] != 40 || res["folders"] != 32 {
		t.Fatalf("deep import: %d %s", code, out)
	}
	folders, _ := e.st.Folders()
	var deepest int64
	for _, f := range folders {
		if f.Name == "L32" {
			deepest = f.ID
		}
	}
	all, _ := e.st.Bookmarks()
	at32 := 0
	for _, bm := range all {
		if bm.FolderID != nil && *bm.FolderID == deepest {
			at32++
		}
	}
	if at32 != 9 { // links 32 to 40
		t.Errorf("links at depth 32: %d", at32)
	}

	// A folder cannot go below depth 32 by hand either.
	e.expect("POST", "/api/folders", map[string]any{"name": "too deep", "parent_id": deepest}, 400)
	top := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Top"}, 201))
	decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Child", "parent_id": top.ID}, 201))
	var l31 int64
	for _, f := range folders {
		if f.Name == "L31" {
			l31 = f.ID
		}
	}
	out = e.expect("PATCH", "/api/folders/"+itoa(top.ID), map[string]any{"parent_id": l31}, 400)
	if !strings.Contains(string(out), "at most 32 deep") {
		t.Errorf("deep move message: %s", out)
	}
	e.expect("PATCH", "/api/folders/"+itoa(top.ID), map[string]any{"parent_id": folders[0].ID}, 200)

	// Long folder names are cut at 200 characters.
	long := strings.Repeat("é", 300)
	e.upload([]byte(`<DL><p><DT><H3>` + long + `</H3><DL><p><DT><A HREF="https://example.org/x">x</A></DL><p></DL><p>`))
	folders, _ = e.st.Folders()
	found := false
	for _, f := range folders {
		if strings.HasPrefix(f.Name, "éé") {
			found = true
			if n := len([]rune(f.Name)); n != 200 {
				t.Errorf("name has %d characters", n)
			}
		}
	}
	if !found {
		t.Error("long folder not imported")
	}

	// Bodies over 20 MB are refused.
	big := bytes.Repeat([]byte("x"), maxImport+1)
	if code, out := e.upload(big); code != 413 {
		t.Errorf("21 MB import: %d %s", code, out)
	}
}

func TestPinnedOrderAndBulkRespectLocks(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("PATCH", "/api/bookmarks/"+itoa(f.plain.ID), map[string]any{"pinned": true}, 200)
	e.expect("POST", "/api/folders/"+itoa(f.client.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	e.expect("PUT", "/api/pinned/order", map[string]any{"ids": []int64{f.inClient.ID, f.plain.ID}}, 404)
	e.expect("PUT", "/api/pinned/order", map[string]any{"ids": []int64{f.plain.ID}}, 204)
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": []int64{f.plain.ID, f.inClient.ID}, "action": "move", "folder_id": f.reading.ID}, 404)
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": []int64{f.plain.ID, 9999}, "action": "unpin"}, 204)
	if b, _ := e.st.Bookmark(f.inClient.ID); !b.Pinned || *b.FolderID != f.client.ID {
		t.Errorf("hidden bookmark changed: %+v", b)
	}
}

func TestCheckHidesIconsOfLockedBookmarks(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.st.SetIcon(f.inClient.ID, "https://example.org/portal", "c.png", nil)
	chk := decode[map[string]any](t, e.expect("GET", "/api/check?url="+url.QueryEscape("https://example.org/other"), nil, 200))
	if chk["icon"] == nil {
		t.Fatal("icon not offered while open")
	}
	e.expect("POST", "/api/folders/"+itoa(f.client.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	chk = decode[map[string]any](t, e.expect("GET", "/api/check?url="+url.QueryEscape("https://example.org/other"), nil, 200))
	if chk["icon"] != nil {
		t.Errorf("icon of a hidden bookmark offered: %v", chk)
	}
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.org/other"}, 201))
	if b.Icon != nil || e.queue.count() == 0 {
		t.Errorf("new bookmark took the hidden icon: %+v", b)
	}
}

func authHash(secret []byte, token string) string { return auth.HashToken(secret, token) }
