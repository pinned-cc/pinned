package server

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/pinned-cc/pinned/internal/store"
)

type fakeQueue struct {
	mu  sync.Mutex
	ids []int64
}

func (q *fakeQueue) Enqueue(id int64) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.ids = append(q.ids, id)
}

func (q *fakeQueue) count() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.ids)
}

var testWeb = fstest.MapFS{
	"index.html":                  {Data: []byte("<p>app</p>")},
	"login.html":                  {Data: []byte("<p>login</p>")},
	"save.html":                   {Data: []byte("<p>save</p>")},
	"bookmarklet.html":            {Data: []byte(`<a href="javascript:open('{{BASE_URL}}/save')">Save</a>`)},
	"share.html":                  {Data: []byte(`<p>share {{BASE_URL}}</p>`)},
	"app.css":                     {Data: []byte("body{}")},
	"app.js":                      {Data: []byte("1")},
	"icons/icon-192.png":          {Data: []byte("\x89PNG")},
	"icons/icon-512.png":          {Data: []byte("\x89PNG")},
	"icons/favicon.svg":           {Data: []byte("<svg/>")},
	"icons/apple-touch-icon.png":  {Data: []byte("\x89PNG")},
	"extras/README.txt":           {Data: []byte("downloads")},
	"extras/pinned-extension.zip": {Data: []byte("PK\x03\x04")},
}

type env struct {
	t      *testing.T
	srv    *httptest.Server
	server *Server
	client *http.Client
	st     *store.Store
	queue  *fakeQueue
	dir    string
	slept  *atomic.Int64 // failed checks that waited failDelay
}

func newEnv(t *testing.T, cfg Config) *env {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "bookmarks.db"))
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, "icons"), 0o755)
	cfg.DataDir = dir
	if cfg.Password == "" {
		cfg.Password = "pw"
	}
	cfg.Version = "test"
	q := &fakeQueue{}
	s := New(cfg, st, testWeb, q, []byte("0123456789abcdef0123456789abcdef"))
	slept := &atomic.Int64{}
	s.sleep = func(d time.Duration) {
		if d != failDelay {
			t.Errorf("failed check waited %v", d)
		}
		slept.Add(1)
	}
	srv := httptest.NewServer(s)
	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	t.Cleanup(func() { srv.Close(); st.Close() })
	return &env{t: t, srv: srv, server: s, client: client, st: st, queue: q, dir: dir, slept: slept}
}

// do sends a request with the CSRF header and returns status and body.
func (e *env) do(method, path string, body any) (int, []byte) {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, r)
	req.Header.Set("X-Requested-With", "fetch")
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

func (e *env) get(path string) *http.Response {
	e.t.Helper()
	resp, err := e.client.Get(e.srv.URL + path)
	if err != nil {
		e.t.Fatal(err)
	}
	return resp
}

func (e *env) login() {
	e.t.Helper()
	if code, body := e.do("POST", "/api/login", map[string]string{"password": "pw"}); code != 204 {
		e.t.Fatalf("login: %d %s", code, body)
	}
}

func (e *env) expect(method, path string, body any, want int) []byte {
	e.t.Helper()
	code, out := e.do(method, path, body)
	if code != want {
		e.t.Fatalf("%s %s: got %d want %d: %s", method, path, code, want, out)
	}
	return out
}

func decode[T any](t *testing.T, data []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("decode %s: %v", data, err)
	}
	return v
}

func TestUnauthenticated(t *testing.T) {
	e := newEnv(t, Config{})
	if code, _ := e.do("GET", "/api/state", nil); code != 401 {
		t.Errorf("api state without session: %d", code)
	}
	if code, _ := e.do("POST", "/api/bookmarks", map[string]string{"url": "https://example.com"}); code != 401 {
		t.Errorf("api create without session: %d", code)
	}
	for path, want := range map[string]string{
		"/":                             "/login?next=%2F",
		"/save?url=https://x.y&title=X": "/login?next=%2Fsave%3Furl%3Dhttps%3A%2F%2Fx.y%26title%3DX",
		"/bookmarklet":                  "/login?next=%2Fbookmarklet",
		"/icons/1.png":                  "/login?next=%2Ficons%2F1.png",
	} {
		resp := e.get(path)
		resp.Body.Close()
		if resp.StatusCode != 303 || resp.Header.Get("Location") != want {
			t.Errorf("%s: %d %s", path, resp.StatusCode, resp.Header.Get("Location"))
		}
	}
}

func TestCSRFHeaderRequired(t *testing.T) {
	e := newEnv(t, Config{})
	resp, _ := e.client.Post(e.srv.URL+"/api/login", "application/json", strings.NewReader(`{"password":"pw"}`))
	if resp.StatusCode != 403 {
		t.Errorf("login without header: %d", resp.StatusCode)
	}
	e.login()
	resp, _ = e.client.Post(e.srv.URL+"/api/bookmarks", "application/json", strings.NewReader(`{"url":"https://example.com"}`))
	if resp.StatusCode != 403 {
		t.Errorf("create without header: %d", resp.StatusCode)
	}
	// GET needs no header.
	if resp := e.get("/api/state"); resp.StatusCode != 200 {
		t.Errorf("state: %d", resp.StatusCode)
	}
}

func TestLoginAPIAndRateLimit(t *testing.T) {
	e := newEnv(t, Config{})
	for i := 0; i < 4; i++ {
		if code, _ := e.do("POST", "/api/login", map[string]string{"password": "wrong"}); code != 401 {
			t.Fatalf("try %d: %d", i+1, code)
		}
	}
	if code, _ := e.do("POST", "/api/login", map[string]string{"password": "wrong"}); code != 429 {
		t.Fatalf("5th failure should start the wait, got %d", code)
	}
	if code, _ := e.do("POST", "/api/login", map[string]string{"password": "wrong"}); code != 429 {
		t.Fatalf("failure during the wait: %d", code)
	}
	// Only checked passwords wait; during the wait none is checked.
	if n := e.slept.Load(); n != 5 {
		t.Errorf("every checked failure should wait, %d did", n)
	}
	// Reset the limiter and log in properly.
	e2 := newEnv(t, Config{})
	req, _ := http.NewRequest("POST", e2.srv.URL+"/api/login", strings.NewReader(`{"password":"pw"}`))
	req.Header.Set("X-Requested-With", "fetch")
	resp, err := e2.client.Do(req)
	if err != nil || resp.StatusCode != 204 {
		t.Fatalf("login: %v %v", resp.StatusCode, err)
	}
	c := resp.Cookies()[0]
	if c.Name != CookieName || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Secure || c.MaxAge != 90*86400 {
		t.Errorf("cookie %+v", c)
	}
	// The database stores a hash, never the token.
	if e2.st.SessionValid(c.Value) {
		t.Error("raw token found in the sessions table")
	}
	e2.expect("POST", "/api/logout", nil, 204)
	if code, _ := e2.do("GET", "/api/state", nil); code != 401 {
		t.Errorf("after logout: %d", code)
	}
}

func TestLoginForm(t *testing.T) {
	e := newEnv(t, Config{})
	post := func(form url.Values) *http.Response {
		resp, err := e.client.PostForm(e.srv.URL+"/login", form)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp
	}
	resp := post(url.Values{"password": {"nope"}, "next": {"/save?url=x"}})
	if resp.StatusCode != 303 || resp.Header.Get("Location") != "/login?error=1&next=%2Fsave%3Furl%3Dx" {
		t.Errorf("wrong password: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	resp = post(url.Values{"password": {"pw"}, "next": {"//evil.example.com"}})
	if resp.StatusCode != 303 || resp.Header.Get("Location") != "/" {
		t.Errorf("open redirect: %s", resp.Header.Get("Location"))
	}
	resp = e.get("/login?next=/bookmarklet")
	if resp.StatusCode != 303 || resp.Header.Get("Location") != "/bookmarklet" {
		t.Errorf("logged in /login should redirect: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	if resp := e.get("/"); resp.StatusCode != 200 {
		t.Errorf("app page: %d", resp.StatusCode)
	}
	// The form logout route is gone; the app logs out through the API.
	if resp, _ = e.client.Post(e.srv.URL+"/logout", "", nil); resp.StatusCode != 405 && resp.StatusCode != 404 {
		t.Errorf("POST /logout: %d", resp.StatusCode)
	}
	e.expect("POST", "/api/logout", nil, 204)
	if resp := e.get("/"); resp.StatusCode != 303 {
		t.Errorf("after logout app page: %d", resp.StatusCode)
	}
	if resp := e.get("/login"); resp.StatusCode != 200 {
		t.Errorf("login page: %d", resp.StatusCode)
	}
}

func TestLoginFormRateLimit(t *testing.T) {
	e := newEnv(t, Config{})
	var loc string
	for i := 0; i < 5; i++ {
		resp, _ := e.client.PostForm(e.srv.URL+"/login", url.Values{"password": {"x"}})
		loc = resp.Header.Get("Location")
	}
	if !strings.HasPrefix(loc, "/login?error=wait") {
		t.Errorf("after 5 failures: %s", loc)
	}
}

func TestBookmarkFlow(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()

	a := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Dashboard", "url": "http://homelab:8080"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Status", "url": "http://homelab:8081"}, 201))
	if a.Host != "homelab:8080" || b.Host != "homelab:8081" || a.Letter != "D" {
		t.Errorf("host or letter wrong: %+v %+v", a, b)
	}
	if e.queue.count() != 2 {
		t.Errorf("icon fetches queued: %d", e.queue.count())
	}

	dup := decode[struct {
		Duplicate bookmarkJSON `json:"duplicate"`
	}](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Again", "url": "http://homelab:8080/#top"}, 409))
	if dup.Duplicate.ID != a.ID {
		t.Errorf("409 should carry the existing bookmark: %+v", dup)
	}
	e.expect("POST", "/api/bookmarks", map[string]any{"url": "ftp://x"}, 400)
	e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com", "folder_id": 999}, 400)
	e.expect("POST", "/api/bookmarks", "not an object", 400)

	// check
	chk := decode[map[string]any](t, e.expect("GET", "/api/check?url="+url.QueryEscape("http://homelab:8081"), nil, 200))
	if chk["duplicate"] == nil {
		t.Error("check should find the duplicate")
	}
	chk = decode[map[string]any](t, e.expect("GET", "/api/check?url="+url.QueryEscape("http://homelab:9999"), nil, 200))
	if chk["duplicate"] != nil || chk["icon"] != nil {
		t.Errorf("check on new port: %v", chk)
	}
	e.expect("GET", "/api/check?url=nope", nil, 400)

	// A new bookmark on a host and port that already has an icon reuses it.
	e.st.SetIcon(a.ID, "http://homelab:8080/", "1-abc.png", nil)
	chk = decode[map[string]any](t, e.expect("GET", "/api/check?url="+url.QueryEscape("http://homelab:8080/other"), nil, 200))
	if icon, _ := chk["icon"].(map[string]any); icon == nil || icon["icon"] != "/icons/1-abc.png" {
		t.Errorf("check icon: %v", chk)
	}
	before := e.queue.count()
	c := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Other", "url": "http://homelab:8080/other"}, 201))
	if c.Icon == nil || *c.Icon != "/icons/1-abc.png" || e.queue.count() != before {
		t.Errorf("icon not reused: %+v", c)
	}

	// force moves the existing one
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Home lab"}, 201))
	forced := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Dash", "url": "http://homelab:8080", "folder_id": f.ID, "force": true}, 200))
	if forced.ID != a.ID || *forced.FolderID != f.ID {
		t.Errorf("force: %+v", forced)
	}

	// patch
	p := decode[bookmarkJSON](t, e.expect("PATCH", "/api/bookmarks/"+itoa(b.ID), map[string]any{"title": "Uptime", "pinned": true, "folder_id": f.ID}, 200))
	if p.Title != "Uptime" || !p.Pinned || *p.FolderID != f.ID {
		t.Errorf("patch: %+v", p)
	}
	p = decode[bookmarkJSON](t, e.expect("PATCH", "/api/bookmarks/"+itoa(b.ID), map[string]any{"folder_id": nil}, 200))
	if p.FolderID != nil {
		t.Error("folder_id null should move to Inbox")
	}
	before = e.queue.count()
	e.expect("PATCH", "/api/bookmarks/"+itoa(b.ID), map[string]any{"url": "http://homelab:8082"}, 200)
	if e.queue.count() != before+1 {
		t.Error("url change should refetch the icon")
	}
	e.expect("PATCH", "/api/bookmarks/"+itoa(b.ID), map[string]any{"url": "http://homelab:8080"}, 409)
	e.expect("PATCH", "/api/bookmarks/"+itoa(b.ID), map[string]any{"title": " "}, 400)
	e.expect("PATCH", "/api/bookmarks/9999", map[string]any{"title": "x"}, 404)

	// open, trash, restore, delete
	e.expect("POST", "/api/bookmarks/"+itoa(b.ID)+"/open", nil, 204)
	e.expect("POST", "/api/bookmarks/9999/open", nil, 404)
	e.expect("POST", "/api/bookmarks/"+itoa(b.ID)+"/refetch-icon", nil, 204)
	e.expect("POST", "/api/bookmarks/9999/refetch-icon", nil, 404)
	e.expect("DELETE", "/api/bookmarks/"+itoa(b.ID), nil, 204)
	st := e.state()
	got := st.find(b.ID)
	if got.DeletedAt == nil || got.OpenedAt == nil {
		t.Errorf("trash or open not recorded: %+v", got)
	}
	e.expect("POST", "/api/bookmarks/"+itoa(b.ID)+"/restore", nil, 204)
	if e.state().find(b.ID).DeletedAt != nil {
		t.Error("restore failed")
	}
	e.expect("DELETE", "/api/bookmarks/"+itoa(b.ID), nil, 204)
	e.expect("DELETE", "/api/trash", nil, 204)
	if e.state().find(b.ID) != nil {
		t.Error("empty trash failed")
	}
	e.expect("DELETE", "/api/bookmarks/"+itoa(c.ID)+"?permanent=1", nil, 204)
	e.expect("DELETE", "/api/bookmarks/"+itoa(c.ID)+"?permanent=1", nil, 404)
	e.expect("DELETE", "/api/bookmarks/abc", nil, 404)
}

func TestBulkAndOrder(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Reading"}, 201))
	var ids []int64
	for _, u := range []string{"https://example.com/1", "https://example.com/2", "https://example.com/3"} {
		ids = append(ids, decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": u, "url": u}, 201)).ID)
	}
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": ids, "action": "move", "folder_id": f.ID}, 204)
	e.expect("PUT", "/api/bookmarks/order", map[string]any{"folder_id": f.ID, "ids": []int64{ids[2], ids[0], ids[1]}}, 204)
	st := e.state()
	if st.find(ids[2]).Position != 0 || st.find(ids[0]).Position != 1 || *st.find(ids[1]).FolderID != f.ID {
		t.Errorf("move or order wrong")
	}
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": ids, "action": "pin"}, 204)
	e.expect("PUT", "/api/pinned/order", map[string]any{"ids": []int64{ids[1], ids[2], ids[0]}}, 204)
	if e.state().find(ids[1]).PinnedPosition != 0 {
		t.Error("pinned order wrong")
	}
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": ids, "action": "unpin"}, 204)
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": ids[:2], "action": "trash"}, 204)
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": ids[:1], "action": "restore"}, 204)
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": ids[1:2], "action": "delete"}, 204)
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": ids, "action": "nope"}, 400)
	st = e.state()
	if st.find(ids[0]).DeletedAt != nil || st.find(ids[1]) != nil || st.find(ids[2]).Pinned {
		t.Error("bulk result wrong")
	}
	if st.Settings.LastFolder != nil {
		t.Error("last folder should only change on create")
	}
}

func TestFolders(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	work := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	sub := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Docs", "parent_id": work.ID}, 201))
	other := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Home lab"}, 201))
	e.expect("POST", "/api/folders", map[string]any{"name": ""}, 400)
	e.expect("POST", "/api/folders", map[string]any{"name": "x", "parent_id": 999}, 400)

	r := decode[folderJSON](t, e.expect("PATCH", "/api/folders/"+itoa(sub.ID), map[string]any{"name": "Notes"}, 200))
	if r.Name != "Notes" || *r.ParentID != work.ID {
		t.Errorf("rename: %+v", r)
	}
	e.expect("PATCH", "/api/folders/"+itoa(work.ID), map[string]any{"parent_id": sub.ID}, 400)
	m := decode[folderJSON](t, e.expect("PATCH", "/api/folders/"+itoa(sub.ID), map[string]any{"parent_id": nil}, 200))
	if m.ParentID != nil {
		t.Error("move to top failed")
	}
	e.expect("PATCH", "/api/folders/"+itoa(sub.ID), map[string]any{"parent_id": other.ID}, 200)
	e.expect("PATCH", "/api/folders/999", map[string]any{"name": "x"}, 404)
	e.expect("PUT", "/api/folders/order", map[string]any{"parent_id": nil, "ids": []int64{other.ID, work.ID}}, 204)

	in1 := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": "http://10.0.0.5:8080", "folder_id": other.ID}, 201))
	in2 := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"url": "http://10.0.0.5:9000", "folder_id": sub.ID}, 201))
	if in1.Title != "10.0.0.5:8080" {
		t.Errorf("empty title should fall back to host and port: %q", in1.Title)
	}
	st := e.state()
	if *st.Settings.LastFolder != sub.ID || len(st.Settings.RecentFolders) != 2 {
		t.Errorf("settings: %+v", st.Settings)
	}
	e.expect("DELETE", "/api/folders/"+itoa(other.ID), nil, 204)
	e.expect("DELETE", "/api/folders/"+itoa(other.ID), nil, 404)
	st = e.state()
	if len(st.Folders) != 1 || st.Folders[0].ID != work.ID {
		t.Errorf("folders left: %+v", st.Folders)
	}
	for _, id := range []int64{in1.ID, in2.ID} {
		b := st.find(id)
		if b.DeletedAt == nil || b.FolderID != nil {
			t.Errorf("bookmark %d should be in Trash without folder", id)
		}
	}
	if st.Settings.LastFolder != nil || len(st.Settings.RecentFolders) != 0 {
		t.Errorf("deleted folders still in settings: %+v", st.Settings)
	}
}

func TestImportExport(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	upload := func(path string) (int, []byte) {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
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
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, out
	}
	code, out := upload("../netscape/testdata/brave.html")
	res := decode[map[string]int](t, out)
	if code != 200 || res["added"] != 7 || res["skipped"] != 1 || res["folders"] != 5 {
		t.Fatalf("import: %d %s", code, out)
	}
	if e.queue.count() != 7 {
		t.Errorf("icon fetches for imported: %d", e.queue.count())
	}

	resp := e.get("/api/export")
	exported, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.Header.Get("Content-Disposition") != `attachment; filename="bookmarks.html"` {
		t.Errorf("disposition %q", resp.Header.Get("Content-Disposition"))
	}
	for _, want := range []string{"<H3 ADD_DATE=\"1759400200\">Work</H3>", `HREF="http://10.0.0.5:8080"`, "Docs &amp; notes"} {
		if !bytes.Contains(exported, []byte(want)) {
			t.Errorf("export missing %q", want)
		}
	}

	// Round trip: import our own export, everything is skipped.
	tmp := filepath.Join(t.TempDir(), "export.html")
	os.WriteFile(tmp, exported, 0o644)
	code, out = upload(tmp)
	res = decode[map[string]int](t, out)
	if code != 200 || res["added"] != 0 || res["skipped"] != 7 || res["folders"] != 0 {
		t.Errorf("re-import: %s", out)
	}

	bad := filepath.Join(t.TempDir(), "bad.html")
	os.WriteFile(bad, []byte("hello"), 0o644)
	if code, _ := upload(bad); code != 400 {
		t.Errorf("bad file: %d", code)
	}
	e.expect("POST", "/api/import", map[string]string{}, 400)
}

func TestPublicPages(t *testing.T) {
	e := newEnv(t, Config{BaseURL: "http://homelab:9095/"})

	// Without a session /health says only that it is up.
	resp := e.get("/health")
	body := readAll(resp)
	if resp.StatusCode != 200 || strings.TrimSpace(string(body)) != `{"ok":true}` {
		t.Errorf("health: %d %s", resp.StatusCode, body)
	}

	resp = e.get("/search?q=" + url.QueryEscape("media 8080"))
	if resp.StatusCode != 303 || resp.Header.Get("Location") != "/#q=media+8080" {
		t.Errorf("search: %s", resp.Header.Get("Location"))
	}

	osd := string(readAll(e.get("/opensearch.xml")))
	if !strings.Contains(osd, `template="http://homelab:9095/search?q={searchTerms}"`) {
		t.Errorf("opensearch: %s", osd)
	}

	m := decode[map[string]any](t, readAll(e.get("/manifest.webmanifest")))
	share, _ := m["share_target"].(map[string]any)
	if m["display"] != "standalone" || m["theme_color"] != "#0a0a0b" || share["action"] != "/save" {
		t.Errorf("manifest: %v", m)
	}

	for path, ctype := range map[string]string{
		"/icon-192.png":         "image/png",
		"/icon-512.png":         "image/png",
		"/apple-touch-icon.png": "image/png",
		"/favicon.svg":          "image/svg+xml",
		"/static/app.css":       "text/css; charset=utf-8",
		"/static/app.js":        "text/javascript; charset=utf-8",
	} {
		resp := e.get(path)
		resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != ctype {
			t.Errorf("%s: %d %s", path, resp.StatusCode, resp.Header.Get("Content-Type"))
		}
	}
	if resp := e.get("/static/"); resp.StatusCode != 404 {
		t.Errorf("directory listing: %d", resp.StatusCode)
	}
	if resp := e.get("/api/nothing"); resp.StatusCode != 401 {
		t.Errorf("unknown api without session: %d", resp.StatusCode)
	}
}

func TestLoggedInPages(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()

	body := string(readAll(e.get("/bookmarklet")))
	if !strings.Contains(body, "open('"+e.srv.URL+"/save')") {
		t.Errorf("bookmarklet base url not filled: %s", body)
	}

	resp := e.get("/save?url=https://example.com&title=Example")
	if resp.StatusCode != 200 || string(readAll(resp)) != "<p>save</p>" {
		t.Errorf("save page: %d", resp.StatusCode)
	}
	resp = e.get("/save?text=" + url.QueryEscape("Look at this https://example.org/a?b=1 nice"))
	if resp.StatusCode != 303 || resp.Header.Get("Location") != "/save?title=Look+at+this++nice&url=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1" {
		t.Errorf("android share: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}

	os.WriteFile(filepath.Join(e.dir, "icons", "5-abcd.png"), []byte("\x89PNG\r\n\x1a\nxx"), 0o644)
	resp = e.get("/icons/5-abcd.png")
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Cache-Control"), "max-age=31536000") {
		t.Errorf("icon: %d %v", resp.StatusCode, resp.Header)
	}
	if resp := e.get("/icons/..%2Fbookmarks.db"); resp.StatusCode != 404 {
		t.Errorf("path escape: %d", resp.StatusCode)
	}
	if resp := e.get("/icons/missing.png"); resp.StatusCode != 404 {
		t.Errorf("missing icon: %d", resp.StatusCode)
	}
	if code, _ := e.do("GET", "/api/nothing", nil); code != 404 {
		t.Errorf("unknown api: %d", code)
	}
}

func TestHealthFailsWhenDatabaseDoes(t *testing.T) {
	e := newEnv(t, Config{})
	e.st.Close()
	if resp := e.get("/health"); resp.StatusCode != 503 {
		t.Errorf("want 503, got %d", resp.StatusCode)
	}
}

// ---- helpers ----

type stateJSON struct {
	Folders   []folderJSON   `json:"folders"`
	Bookmarks []bookmarkJSON `json:"bookmarks"`
	Settings  struct {
		LastFolder    *int64  `json:"last_folder"`
		RecentFolders []int64 `json:"recent_folders"`
	} `json:"settings"`
	Version string `json:"version"`
}

func (s stateJSON) find(id int64) *bookmarkJSON {
	for i := range s.Bookmarks {
		if s.Bookmarks[i].ID == id {
			return &s.Bookmarks[i]
		}
	}
	return nil
}

func (e *env) state() stateJSON {
	e.t.Helper()
	st := decode[stateJSON](e.t, e.expect("GET", "/api/state", nil, 200))
	if st.Version != "test" {
		e.t.Errorf("version %q", st.Version)
	}
	return st
}

func readAll(resp *http.Response) []byte {
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return b
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func TestFolderHideRecent(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	nas := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "NAS"}, 201))
	if nas.HideRecent {
		t.Fatal("a new folder starts hidden from Recent")
	}
	r := decode[folderJSON](t, e.expect("PATCH", "/api/folders/"+itoa(nas.ID), map[string]any{"hide_recent": true}, 200))
	if !r.HideRecent || r.Name != "NAS" {
		t.Errorf("on: %+v", r)
	}
	st := e.state()
	if len(st.Folders) != 1 || !st.Folders[0].HideRecent {
		t.Errorf("state after on: %+v", st.Folders)
	}
	// a rename leaves the setting alone; both in one request apply both
	r = decode[folderJSON](t, e.expect("PATCH", "/api/folders/"+itoa(nas.ID), map[string]any{"name": "Home NAS"}, 200))
	if !r.HideRecent || r.Name != "Home NAS" {
		t.Errorf("rename: %+v", r)
	}
	r = decode[folderJSON](t, e.expect("PATCH", "/api/folders/"+itoa(nas.ID), map[string]any{"name": "NAS", "hide_recent": false}, 200))
	if r.HideRecent || r.Name != "NAS" {
		t.Errorf("off: %+v", r)
	}
	if st = e.state(); st.Folders[0].HideRecent {
		t.Errorf("state after off: %+v", st.Folders)
	}
	e.expect("PATCH", "/api/folders/"+itoa(nas.ID), map[string]any{"hide_recent": "yes"}, 400)
	e.expect("PATCH", "/api/folders/"+itoa(nas.ID), map[string]any{"hide_recent": nil}, 400)
	e.expect("PATCH", "/api/folders/999", map[string]any{"hide_recent": true}, 404)
}
