package server

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"
)

// lockedBuffer collects log lines written from handler goroutines.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// lines returns the security lines logged for event.
func (e *env) events(event string) []string {
	var out []string
	for _, l := range strings.Split(e.logs.String(), "\n") {
		if strings.HasPrefix(l, "security event="+event+" ") {
			out = append(out, l)
		}
	}
	return out
}

func (e *env) wantEvent(event string, n int) {
	e.t.Helper()
	if got := e.events(event); len(got) != n {
		e.t.Errorf("%s logged %d times, want %d; log:\n%s", event, len(got), n, e.logs.String())
	}
}

func TestSecurityEventsAreLogged(t *testing.T) {
	e := newEnv(t, Config{})
	e.expect("POST", "/api/login", map[string]string{"password": "wrong guess"}, 401)
	e.wantEvent("login.fail", 1)
	if l := e.events("login.fail")[0]; !strings.Contains(l, "ip=127.0.0.1") {
		t.Errorf("no client address: %s", l)
	}
	e.login()
	e.wantEvent("login.ok", 1)

	tok := e.newToken("my phone")
	e.wantEvent("token.create", 1)
	resp := e.bearer("GET", "/api/state", "tk_wrong", nil)
	resp.Body.Close()
	e.wantEvent("token.fail", 1)
	resp = e.bearer("GET", "/api/export", tok, nil)
	resp.Body.Close()
	e.wantEvent("token.refused", 1)
	list := decode[[]tokenJSON](t, e.expect("GET", "/api/tokens", nil, 200))
	e.expect("DELETE", "/api/tokens/"+itoa(list[0].ID), nil, 204)
	e.wantEvent("token.delete", 1)

	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	fp := "/api/folders/" + itoa(f.ID)
	e.expect("POST", fp+"/share", map[string]any{"password": "share pass"}, 201)
	e.wantEvent("share.create", 1)
	st := e.state()
	var token string
	for _, x := range st.Folders {
		if x.ID == f.ID && x.Share != nil {
			token = x.Share.Token
		}
	}
	e.expect("PATCH", "/api/shares/"+token, map[string]any{"expires_days": 7}, 200)
	e.wantEvent("share.change", 1)
	if v := e.visitor(); v.unlock(token, "not it") != 401 {
		t.Error("wrong share password accepted")
	}
	e.wantEvent("share.fail", 1)
	e.expect("DELETE", "/api/shares/"+token, nil, 204)
	e.wantEvent("share.delete", 1)

	e.expect("POST", fp+"/lock", map[string]any{"password": "lock pass"}, 204)
	e.wantEvent("lock.set", 1)
	e.expect("POST", fp+"/unlock", map[string]any{"password": "nope"}, 403)
	e.wantEvent("lock.fail", 1)
	e.expect("DELETE", fp+"/lock", map[string]any{"app_password": "nope"}, 403)
	e.wantEvent("reauth.fail", 1)
	e.expect("DELETE", fp+"/lock", map[string]any{"app_password": "pw"}, 204)
	e.wantEvent("lock.remove", 1)

	e.expect("POST", "/api/logout", nil, 204)
	e.wantEvent("logout", 1)

	// No secret ever reaches the log.
	all := e.logs.String()
	for _, secret := range []string{"wrong guess", tok, "share pass", "lock pass", "not it", "tk_wrong"} {
		if strings.Contains(all, secret) {
			t.Errorf("log holds %q:\n%s", secret, all)
		}
	}
	if !strings.Contains(e.events("token.create")[0], `name="my phone"`) {
		t.Errorf("token name not quoted: %s", e.events("token.create")[0])
	}
}

func TestLockoutLoggedOncePerWait(t *testing.T) {
	e := newEnv(t, Config{})
	for i := 0; i < 8; i++ {
		e.do("POST", "/api/login", map[string]string{"password": "wrong"})
	}
	e.wantEvent("login.fail", 4)
	e.wantEvent("login.wait", 1)
}

func TestLogValueQuotes(t *testing.T) {
	for in, want := range map[string]string{
		"plain":            "plain",
		"two words":        `"two words"`,
		"a=b":              `"a=b"`,
		"line\nevent=fake": `"line\nevent=fake"`,
		"":                 `""`,
		`say "hi"`:         `"say \"hi\""`,
		"GET /api/export":  `"GET /api/export"`,
	} {
		if got := logValue(in); got != want {
			t.Errorf("logValue(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestLoginEndsTheSessionTheBrowserHeld(t *testing.T) {
	for _, form := range []bool{false, true} {
		e := newEnv(t, Config{})
		e.login()
		old := cookieOf(e, CookieName)
		if form {
			resp, err := e.client.PostForm(e.srv.URL+"/login", map[string][]string{"password": {"pw"}})
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
		} else {
			e.login()
		}
		if cookieOf(e, CookieName) == old {
			t.Fatal("no new session cookie")
		}
		if _, ok := e.st.Session(hashOf(e, old)); ok {
			t.Errorf("form=%v: the old session still exists after a new login", form)
		}
		e.expect("GET", "/api/state", nil, 200)
	}
}

// cookieOf returns the value of the cookie name in e's jar.
func cookieOf(e *env, name string) string {
	for _, c := range e.client.Jar.Cookies(mustURL(e.srv.URL)) {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}

// Right folder and share passwords are logged too, so a right guess after
// many wrong ones shows. CSRF refusals are logged at most once a minute per
// client.
func TestUnlocksAndCSRFRefusalsAreLogged(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	e.wantEvent("lock.unlock", 1)
	if l := e.events("lock.unlock"); len(l) == 1 && !strings.Contains(l[0], "folder="+itoa(f.work.ID)) {
		t.Errorf("lock.unlock line: %s", l[0])
	}

	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.reading.ID)+"/share", map[string]any{"password": "share password"}, 201))
	v := e.visitor()
	if code := v.unlock(sh.Token, "share password"); code != 204 {
		t.Fatalf("share unlock: %d", code)
	}
	e.wantEvent("share.unlock", 1)
	if l := e.events("share.unlock"); len(l) == 1 && !strings.Contains(l[0], "folder="+itoa(f.reading.ID)) {
		t.Errorf("share.unlock line: %s", l[0])
	}
	if strings.Contains(e.logs.String(), sh.Token) || strings.Contains(e.logs.String(), "s3cret") {
		t.Errorf("a secret in the log:\n%s", e.logs.String())
	}

	for range 3 {
		resp, err := e.client.Post(e.srv.URL+"/api/bookmarks", "application/json", strings.NewReader(`{"url":"https://example.com"}`))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Fatalf("without the header: %d", resp.StatusCode)
		}
	}
	e.wantEvent("csrf.refused", 1)
	if l := e.events("csrf.refused"); len(l) == 1 && !strings.Contains(l[0], "method=POST") {
		t.Errorf("csrf.refused line: %s", l[0])
	}
	later := time.Now().Add(61 * time.Second)
	e.st.Now = func() time.Time { return later }
	resp, _ := e.client.Post(e.srv.URL+"/api/login", "application/json", strings.NewReader(`{"password":"pw"}`))
	resp.Body.Close()
	e.wantEvent("csrf.refused", 2)
}

func TestSecurityLineWithoutRequest(t *testing.T) {
	if got := SecurityLine("icon.fail", "host", "example.com", "kind", "certificate"); got != "security event=icon.fail host=example.com kind=certificate" {
		t.Errorf("line: %s", got)
	}
}
