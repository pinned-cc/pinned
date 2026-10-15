package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// bearer sends a request with only the token: no cookie jar, no CSRF header.
func (e *env) bearer(method, path, token string, body any) *http.Response {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, r)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	return resp
}

func (e *env) newToken(name string) string {
	e.t.Helper()
	out := decode[tokenJSON](e.t, e.expect("POST", "/api/tokens", map[string]string{"name": name}, 201))
	if !strings.HasPrefix(out.Token, "tk_") || out.ID == 0 || out.Name != name || out.CreatedAt == 0 {
		e.t.Fatalf("bad token answer: %+v", out)
	}
	return out.Token
}

func TestTokensCreateListDelete(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	e.expect("POST", "/api/tokens", map[string]string{"name": "  "}, 400)
	tok := e.newToken("Shortcut on my phone")
	body := e.expect("GET", "/api/tokens", nil, 200)
	if strings.Contains(string(body), tok) || strings.Contains(string(body), `"token"`) {
		t.Fatalf("token list leaks the value: %s", body)
	}
	list := decode[[]tokenJSON](t, body)
	if len(list) != 1 || list[0].Name != "Shortcut on my phone" || list[0].LastUsedAt != nil {
		t.Fatalf("list: %+v", list)
	}
	// The value is stored hashed.
	if n, _ := e.st.TokenByHash(tok); n.ID != 0 {
		t.Fatal("token stored in plain form")
	}

	resp := e.bearer("GET", "/api/folders", tok, nil)
	resp.Body.Close()
	list = decode[[]tokenJSON](t, e.expect("GET", "/api/tokens", nil, 200))
	if list[0].LastUsedAt == nil {
		t.Error("last_used_at not set after use")
	}
	e.expect("DELETE", "/api/tokens/"+itoa(list[0].ID), nil, 204)
	e.expect("DELETE", "/api/tokens/"+itoa(list[0].ID), nil, 404)
	resp = e.bearer("GET", "/api/folders", tok, nil)
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Errorf("revoked token: %d", resp.StatusCode)
	}
}

func TestBearerFoldersAndSave(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work", "parent_id": nil}, 201))
	tok := e.newToken("script")

	resp := e.bearer("GET", "/api/folders", tok, nil)
	if resp.StatusCode != 200 || len(resp.Cookies()) != 0 {
		t.Fatalf("folders: %d cookies %v", resp.StatusCode, resp.Cookies())
	}
	var folders []map[string]any
	json.NewDecoder(resp.Body).Decode(&folders)
	resp.Body.Close()
	if len(folders) != 1 || folders[0]["name"] != "Work" || folders[0]["position"] == nil {
		t.Fatalf("folders: %v", folders)
	}
	if _, ok := folders[0]["parent_id"]; !ok {
		t.Fatal("parent_id missing")
	}

	// No X-Requested-With header: a bearer request skips the CSRF check.
	resp = e.bearer("POST", "/api/bookmarks", tok, map[string]any{"title": "Ex", "url": "https://example.com/a", "folder_id": f.ID})
	resp.Body.Close()
	if resp.StatusCode != 201 || len(resp.Cookies()) != 0 {
		t.Fatalf("save with bearer: %d cookies %v", resp.StatusCode, resp.Cookies())
	}
	resp = e.bearer("GET", "/api/check?url=https://example.com/a", tok, nil)
	var chk map[string]any
	json.NewDecoder(resp.Body).Decode(&chk)
	resp.Body.Close()
	if resp.StatusCode != 200 || chk["duplicate"] == nil {
		t.Fatalf("check with bearer: %d %v", resp.StatusCode, chk)
	}
	resp = e.bearer("POST", "/api/bookmarks", tok, map[string]any{"title": "Ex", "url": "https://example.com/a", "folder_id": nil})
	resp.Body.Close()
	if resp.StatusCode != 409 {
		t.Fatalf("duplicate with bearer: %d", resp.StatusCode)
	}
	// The cookie session still needs the CSRF header.
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/bookmarks", strings.NewReader(`{"title":"B","url":"https://example.com/b"}`))
	r2, _ := e.client.Do(req)
	r2.Body.Close()
	if r2.StatusCode != 403 {
		t.Errorf("session without CSRF header: %d", r2.StatusCode)
	}
}

func TestBearerCannotManageTokens(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	tok := e.newToken("ext")
	resp := e.bearer("POST", "/api/tokens", tok, map[string]string{"name": "more"})
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Errorf("token minting a token: %d", resp.StatusCode)
	}
	list := decode[[]tokenJSON](t, e.expect("GET", "/api/tokens", nil, 200))
	resp = e.bearer("DELETE", "/api/tokens/"+itoa(list[0].ID), tok, nil)
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Errorf("token revoking a token: %d", resp.StatusCode)
	}
	resp = e.bearer("GET", "/api/tokens", tok, nil)
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Errorf("token listing tokens: %d", resp.StatusCode)
	}
	resp = e.bearer("POST", "/api/logout", tok, nil)
	resp.Body.Close()
	if resp.StatusCode != 403 || len(resp.Cookies()) != 0 {
		t.Errorf("logout with a token: %d %v", resp.StatusCode, resp.Cookies())
	}
	if len(decode[[]tokenJSON](t, e.expect("GET", "/api/tokens", nil, 200))) != 1 {
		t.Error("token count changed")
	}
}

func TestBadTokenRateLimited(t *testing.T) {
	e := newEnv(t, Config{})
	for i := 0; i < 4; i++ {
		resp := e.bearer("GET", "/api/folders", "tk_wrong", nil)
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 401 || !strings.Contains(string(body), `"error"`) {
			t.Fatalf("bad token %d: %d %s", i, resp.StatusCode, body)
		}
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/folders", nil)
	req.Header.Set("Authorization", "Bearer") // an empty token counts too
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 429 {
		t.Fatalf("fifth bad token: %d", resp.StatusCode)
	}
	resp = e.bearer("GET", "/api/folders", "tk_wrong", nil)
	resp.Body.Close()
	if resp.StatusCode != 429 || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("while blocked: %d", resp.StatusCode)
	}
	// Tokens count apart from the login: the owner can still log in.
	if code, _ := e.do("POST", "/api/login", map[string]string{"password": "wrong"}); code != 401 {
		t.Errorf("login counted the bad tokens: %d", code)
	}
	e.login()
	// A valid token is never blocked.
	tok := e.newToken("ext")
	resp = e.bearer("GET", "/api/folders", tok, nil)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("valid token while the address is blocked: %d", resp.StatusCode)
	}
	if n := e.slept.Load(); n != 7 {
		t.Errorf("failed checks that waited: %d, want 7", n)
	}
}

func TestCORSPreflight(t *testing.T) {
	e := newEnv(t, Config{})
	pre := func(origin, path string) *http.Response {
		req, _ := http.NewRequest("OPTIONS", e.srv.URL+path, nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp
	}
	for _, o := range []string{"chrome-extension://abcdef", "moz-extension://1234-5678", "safari-web-extension://x"} {
		for _, p := range []string{"/api/bookmarks", "/api/folders", "/api/tokens/3", "/api/check"} {
			resp := pre(o, p)
			h := resp.Header
			if resp.StatusCode != 204 || h.Get("Access-Control-Allow-Origin") != o ||
				h.Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" ||
				h.Get("Access-Control-Allow-Methods") != "GET, POST, PATCH, DELETE, OPTIONS" ||
				!strings.Contains(h.Get("Vary"), "Origin") || h.Get("Access-Control-Allow-Credentials") != "" {
				t.Errorf("preflight %s %s: %d %v", o, p, resp.StatusCode, h)
			}
		}
	}
	for _, o := range []string{"https://evil.example", "null", "", "chrome-extension://"} {
		resp := pre(o, "/api/bookmarks")
		if resp.StatusCode == 204 || resp.Header.Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("preflight from %q allowed: %d %v", o, resp.StatusCode, resp.Header)
		}
	}

	// Actual bearer responses carry the same Allow-Origin, never "*".
	e.login()
	tok := e.newToken("ext")
	for _, c := range []struct{ origin, want string }{{"chrome-extension://abcdef", "chrome-extension://abcdef"}, {"https://evil.example", ""}} {
		req, _ := http.NewRequest("GET", e.srv.URL+"/api/folders", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Origin", c.origin)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("Access-Control-Allow-Origin") != c.want {
			t.Errorf("bearer GET from %s: %d %q", c.origin, resp.StatusCode, resp.Header.Get("Access-Control-Allow-Origin"))
		}
	}
}

func TestExtras(t *testing.T) {
	e := newEnv(t, Config{})
	resp := e.get("/extras/save-to-pinned.shortcut")
	body := readAll(resp)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/octet-stream" ||
		!strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment") || string(body) != "bplist00" ||
		resp.Header.Get("Cache-Control") != "no-cache" {
		t.Errorf("shortcut: %d %v", resp.StatusCode, resp.Header)
	}
	resp = e.get("/extras/pinned-extension.zip")
	readAll(resp)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/zip" {
		t.Errorf("zip: %d %v", resp.StatusCode, resp.Header)
	}
	for _, p := range []string{"/extras/missing.zip", "/extras/..%2fapp.js", "/extras/"} {
		resp = e.get(p)
		readAll(resp)
		if resp.StatusCode != 404 {
			t.Errorf("%s: %d", p, resp.StatusCode)
		}
	}
}

func TestPatchFolderRemembersFolder(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	a := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "A", "parent_id": nil}, 201))
	b := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "B", "parent_id": nil}, 201))
	tok := e.newToken("shortcut")
	// Save to Inbox, then move, the way the Shortcut does.
	resp := e.bearer("POST", "/api/bookmarks", tok, map[string]any{"title": "X", "url": "https://example.com/x", "folder_id": nil})
	created := decode[bookmarkJSON](t, readAll(resp))
	resp = e.bearer("PATCH", "/api/bookmarks/"+itoa(created.ID), tok, map[string]any{"folder_id": a.ID})
	readAll(resp)
	if resp.StatusCode != 200 {
		t.Fatalf("patch with bearer: %d", resp.StatusCode)
	}
	e.expect("PATCH", "/api/bookmarks/"+itoa(created.ID), map[string]any{"folder_id": b.ID}, 200)
	st, err := e.st.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if st.LastFolder == nil || *st.LastFolder != b.ID || len(st.RecentFolders) != 2 || st.RecentFolders[0] != b.ID || st.RecentFolders[1] != a.ID {
		t.Fatalf("settings after moves: last %v recent %v", st.LastFolder, st.RecentFolders)
	}
	// Back to Inbox leaves the settings alone.
	e.expect("PATCH", "/api/bookmarks/"+itoa(created.ID), map[string]any{"folder_id": nil}, 200)
	if st2, _ := e.st.Settings(); *st2.LastFolder != b.ID || len(st2.RecentFolders) != 2 {
		t.Fatalf("settings after move to Inbox: %v %v", st2.LastFolder, st2.RecentFolders)
	}
}
