package server

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// visitor is a browser without a session.
type visitor struct {
	t      *testing.T
	e      *env
	client *http.Client
}

func (e *env) visitor() *visitor {
	jar, _ := cookiejar.New(nil)
	return &visitor{t: e.t, e: e, client: &http.Client{Jar: jar}}
}

func (v *visitor) get(path string) (int, string) {
	v.t.Helper()
	resp, err := v.client.Get(v.e.srv.URL + path)
	if err != nil {
		v.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func (v *visitor) unlock(token, password string) int {
	v.t.Helper()
	resp, err := v.client.Post(v.e.srv.URL+"/s/"+token+"/unlock", "application/json", strings.NewReader(`{"password":"`+password+`"}`))
	if err != nil {
		v.t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

type sharedData struct {
	Folder struct {
		Name string `json:"name"`
	} `json:"folder"`
	Folders   []folderJSON `json:"folders"`
	Bookmarks []struct {
		ID    int64   `json:"id"`
		Title string  `json:"title"`
		Host  string  `json:"host"`
		Icon  *string `json:"icon"`
	} `json:"bookmarks"`
}

func TestShareCreateAndState(t *testing.T) {
	e := newEnv(t, Config{BaseURL: "http://homelab:9095"})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Reading"}, 201))
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.ID)+"/share", map[string]any{}, 201))
	if len(sh.Token) != 32 || sh.URL != "http://homelab:9095/s/"+sh.Token || sh.HasPassword || sh.ExpiresAt != nil || sh.Opens != 0 {
		t.Errorf("share: %+v", sh)
	}
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/share", map[string]any{}, 409)
	e.expect("POST", "/api/folders/999/share", map[string]any{}, 404)
	g := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Other"}, 201))
	e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{"expires_days": 0}, 400)
	e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{"expires_days": "x"}, 400)

	st := e.state()
	for _, fo := range st.Folders {
		switch fo.ID {
		case f.ID:
			if fo.Share == nil || fo.Share.Token != sh.Token {
				t.Errorf("state lacks share: %+v", fo)
			}
		case g.ID:
			if fo.Share != nil {
				t.Errorf("unshared folder has share")
			}
		}
	}

	p := decode[shareJSON](t, e.expect("PATCH", "/api/shares/"+sh.Token, map[string]any{"password": "pw2 long enough", "expires_days": 7}, 200))
	if !p.HasPassword || p.ExpiresAt == nil {
		t.Errorf("patch: %+v", p)
	}
	p = decode[shareJSON](t, e.expect("PATCH", "/api/shares/"+sh.Token, map[string]any{"password": "", "expires_days": nil}, 200))
	if p.HasPassword || p.ExpiresAt != nil {
		t.Errorf("patch remove: %+v", p)
	}
	short := e.expect("PATCH", "/api/shares/"+sh.Token, map[string]any{"password": "short"}, 400)
	if !strings.Contains(string(short), "at least 8 characters") {
		t.Errorf("short share password message: %s", short)
	}
	e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{"password": "1234567"}, 400)
	e.expect("PATCH", "/api/shares/nope", map[string]any{"password": "long enough"}, 404)

	// Session and CSRF guarded.
	if code, _ := e.visitor().get("/api/state"); code != 401 {
		t.Error("state open without session")
	}
	resp, _ := e.client.Post(e.srv.URL+"/api/folders/"+itoa(g.ID)+"/share", "application/json", strings.NewReader("{}"))
	if resp.StatusCode != 403 {
		t.Errorf("share without CSRF header: %d", resp.StatusCode)
	}

	// Deleting the folder deletes the share.
	e.expect("DELETE", "/api/folders/"+itoa(f.ID), nil, 204)
	if code, _ := e.visitor().get("/s/" + sh.Token); code != 404 {
		t.Errorf("share survived folder delete: %d", code)
	}
}

func TestSharePublicData(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	top := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Home lab"}, 201))
	sub := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Media", "parent_id": top.ID}, 201))
	other := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Private"}, 201))
	a := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Dashboard", "url": "http://10.0.0.5:8080", "folder_id": top.ID}, 201))
	decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Music", "url": "http://10.0.0.5:4000", "folder_id": sub.ID}, 201))
	gone := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Old", "url": "http://10.0.0.5:5000", "folder_id": sub.ID}, 201))
	secret := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Secret", "url": "https://example.org/private", "folder_id": other.ID}, 201))
	e.expect("DELETE", "/api/bookmarks/"+itoa(gone.ID), nil, 204)

	icons := filepath.Join(e.dir, "icons")
	os.WriteFile(filepath.Join(icons, "a.png"), []byte("\x89PNG\r\n\x1a\n"), 0o644)
	os.WriteFile(filepath.Join(icons, "s.png"), []byte("\x89PNG\r\n\x1a\n"), 0o644)
	e.st.SetIcon(a.ID, "http://10.0.0.5:8080/", "a.png", nil)
	e.st.SetIcon(secret.ID, "https://example.org/private", "s.png", nil)

	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(top.ID)+"/share", map[string]any{}, 201))
	v := e.visitor()

	code, body := v.get("/s/" + sh.Token)
	if code != 200 || body != "<p>share "+e.srv.URL+"</p>" {
		t.Errorf("share page: %d %s", code, body)
	}
	code, body = v.get("/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	if code != 404 || !strings.Contains(body, "This link is no longer available.") || !strings.Contains(body, "#0a0a0b") {
		t.Errorf("unknown token page: %d %s", code, body)
	}
	if code, _ := v.get("/s/AAAA/data"); code != 404 {
		t.Errorf("unknown token data: %d", code)
	}

	code, body = v.get("/s/" + sh.Token + "/data")
	if code != 200 {
		t.Fatalf("data: %d %s", code, body)
	}
	d := decode[sharedData](t, []byte(body))
	if d.Folder.Name != "Home lab" || len(d.Folders) != 1 || d.Folders[0].Name != "Media" || len(d.Bookmarks) != 2 {
		t.Errorf("data: %+v", d)
	}
	if strings.Contains(body, "Secret") || strings.Contains(body, "Old") || strings.Contains(body, "Private") {
		t.Error("data leaks bookmarks outside the share or in Trash")
	}
	if d.Bookmarks[0].Icon == nil || *d.Bookmarks[0].Icon != "/s/"+sh.Token+"/icons/a.png" || d.Bookmarks[0].Host != "10.0.0.5:8080" {
		t.Errorf("icon not rewritten: %+v", d.Bookmarks[0])
	}

	// Icons are scoped to the share.
	if code, _ := v.get("/s/" + sh.Token + "/icons/a.png"); code != 200 {
		t.Errorf("own icon: %d", code)
	}
	if code, _ := v.get("/s/" + sh.Token + "/icons/s.png"); code != 404 {
		t.Errorf("icon of another folder served: %d", code)
	}
	if _, body := v.get("/icons/a.png"); strings.Contains(body, "PNG") {
		t.Error("private icon path served to a visitor")
	}

	// Opens count once per visitor per hour.
	v.get("/s/" + sh.Token + "/data")
	e.visitor().get("/s/" + sh.Token + "/data")
	st := e.state()
	for _, f := range st.Folders {
		if f.ID == top.ID && (f.Share.Opens != 2 || f.Share.LastOpenedAt == nil) {
			t.Errorf("opens: %+v", f.Share)
		}
	}

	// Expiry.
	e.expect("PATCH", "/api/shares/"+sh.Token, map[string]any{"expires_days": 1}, 200)
	e.st.Now = func() time.Time { return time.Now().Add(25 * time.Hour) }
	if code, _ := v.get("/s/" + sh.Token + "/data"); code != 404 {
		t.Errorf("expired share data: %d", code)
	}
	if code, _ := v.get("/s/" + sh.Token); code != 404 {
		t.Errorf("expired share page: %d", code)
	}
	e.st.Now = time.Now

	// Revoke.
	e.expect("DELETE", "/api/shares/"+sh.Token, nil, 204)
	e.expect("DELETE", "/api/shares/"+sh.Token, nil, 404)
	if code, _ := v.get("/s/" + sh.Token + "/data"); code != 404 {
		t.Errorf("revoked share data: %d", code)
	}
}

func TestSharePassword(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	e.expect("POST", "/api/bookmarks", map[string]any{"title": "Docs", "url": "https://example.com/docs", "folder_id": f.ID}, 201)
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.ID)+"/share", map[string]any{"password": "open sesame", "expires_days": 30}, 201))
	if !sh.HasPassword || sh.ExpiresAt == nil {
		t.Fatalf("share: %+v", sh)
	}
	v := e.visitor()
	code, body := v.get("/s/" + sh.Token + "/data")
	if code != 401 || strings.TrimSpace(body) != `{"folder":{"name":"Work"},"locked":true}` {
		t.Errorf("locked: %d %s", code, body)
	}
	if v.unlock(sh.Token, "wrong") != 401 {
		t.Error("wrong password accepted")
	}
	if v.unlock(sh.Token, "open sesame") != 204 {
		t.Fatal("right password refused")
	}
	if code, _ := v.get("/s/" + sh.Token + "/data"); code != 200 {
		t.Errorf("after unlock: %d", code)
	}
	cookie := v.client.Jar.Cookies(mustURL(e.srv.URL + "/s/" + sh.Token))
	if len(cookie) == 0 {
		t.Fatal("no unlock cookie")
	}

	// Changing the password locks old cookies out.
	e.expect("PATCH", "/api/shares/"+sh.Token, map[string]any{"password": "new one here"}, 200)
	if code, _ := v.get("/s/" + sh.Token + "/data"); code != 401 {
		t.Errorf("old cookie after password change: %d", code)
	}
	v.unlock(sh.Token, "new one here")

	// Revoke and share again: a cookie made for the old share does not open the new one.
	e.expect("DELETE", "/api/shares/"+sh.Token, nil, 204)
	sh2 := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.ID)+"/share", map[string]any{"password": "new one here"}, 201))
	var unlock string
	for _, c := range cookie {
		if c.Name == shareCookie {
			unlock = c.Value
		}
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/s/"+sh2.Token+"/data", nil)
	req.AddCookie(&http.Cookie{Name: shareCookie, Value: unlock})
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Errorf("old cookie opened the new share: %d", resp.StatusCode)
	}
	// A forged cookie with a far expiry fails too.
	req, _ = http.NewRequest("GET", e.srv.URL+"/s/"+sh2.Token+"/data", nil)
	req.AddCookie(&http.Cookie{Name: shareCookie, Value: "9999999999.00"})
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Errorf("forged cookie: %d", resp.StatusCode)
	}

	// Unlock is rate limited like the login.
	w := e.visitor()
	for i := 0; i < 4; i++ {
		w.unlock(sh2.Token, "x")
	}
	if code := w.unlock(sh2.Token, "x"); code != 429 {
		t.Errorf("5th wrong unlock: %d", code)
	}
	// During the wait the password is not checked: the right one waits too.
	if code := w.unlock(sh2.Token, "new one here"); code != 429 {
		t.Errorf("right share password during the wait: %d", code)
	}
	if code := w.unlock("unknown", "x"); code != 404 {
		t.Errorf("unlock unknown: %d", code)
	}
}

func TestExportIgnoresShares(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	e.expect("POST", "/api/bookmarks", map[string]any{"title": "Docs", "url": "https://example.com/docs", "folder_id": f.ID}, 201)
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.ID)+"/share", map[string]any{}, 201))
	body := string(readAll(e.get("/api/export")))
	if strings.Contains(body, sh.Token) || strings.Contains(body, "/s/") {
		t.Error("export mentions the share")
	}
}

func mustURL(s string) *url.URL {
	u, err := url.Parse(s)
	if err != nil {
		panic(err)
	}
	return u
}
