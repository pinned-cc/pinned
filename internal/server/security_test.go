package server

import (
	"bytes"
	"strings"
	"sync"
	"testing"
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
		if _, ok := e.st.SessionExpiry(hashOf(e, old)); ok {
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
