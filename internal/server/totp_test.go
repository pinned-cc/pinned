package server

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/pinned-cc/pinned/internal/auth"
)

var totpKey = []byte("12345678901234567890")

// codeAt is the authenticator's 6 digit code at t (RFC 6238).
func codeAt(t time.Time) string {
	m := hmac.New(sha1.New, totpKey)
	binary.Write(m, binary.BigEndian, uint64(t.Unix()/30))
	sum := m.Sum(nil)
	off := sum[19] & 0x0f
	return fmt.Sprintf("%06d", (binary.BigEndian.Uint32(sum[off:])&0x7fffffff)%1000000)
}

func newTOTPEnv(t *testing.T) (*env, *time.Time) {
	e := newEnv(t, Config{TOTPKey: totpKey})
	now := time.Unix(1800000000, 0)
	e.server.totp.Now = func() time.Time { return now }
	return e, &now
}

func TestTOTPLogin(t *testing.T) {
	e, now := newTOTPEnv(t)
	login := func(body map[string]string) (int, string) {
		code, out := e.do("POST", "/api/login", body)
		return code, string(out)
	}
	if code, out := login(map[string]string{"password": "pw"}); code != 401 || !strings.Contains(out, "Wrong password or code") {
		t.Fatalf("no code: %d %s", code, out)
	}
	e.wantEvent("totp.fail", 1)
	if code, _ := login(map[string]string{"password": "wrong", "code": codeAt(*now)}); code != 401 {
		t.Fatalf("wrong password, right code: %d", code)
	}
	e.wantEvent("login.fail", 1)
	if code, _ := login(map[string]string{"password": "pw", "code": "000000"}); code != 401 {
		t.Fatalf("wrong code: %d", code)
	}
	// One step of drift is fine.
	if code, out := login(map[string]string{"password": "pw", "code": codeAt(now.Add(-30 * time.Second))}); code != 204 {
		t.Fatalf("right password and code: %d %s", code, out)
	}
	e.wantEvent("login.ok", 1)
	e.expect("GET", "/api/state", nil, 200)

	// The code is used up, and so is any older one.
	e.expect("POST", "/api/logout", nil, 204)
	if code, _ := login(map[string]string{"password": "pw", "code": codeAt(now.Add(-30 * time.Second))}); code != 401 {
		t.Errorf("the same code twice: %d", code)
	}
	// The browser holds a device cookie now: it does not skip the code.
	if code, _ := login(map[string]string{"password": "pw"}); code != 401 {
		t.Errorf("device cookie skipped the code: %d", code)
	}
	if code, _ := login(map[string]string{"password": "pw", "code": codeAt(*now)}); code != 204 {
		t.Errorf("the next code: %d", code)
	}

	// API tokens do not need a code, and making one asks only for the
	// password.
	tok := e.newToken("script")
	resp := e.bearer("GET", "/api/folders", tok, nil)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("token with a second factor on: %d", resp.StatusCode)
	}
}

func TestTOTPWrongCodesCountInTheLimiter(t *testing.T) {
	e, now := newTOTPEnv(t)
	for i := 0; i < 4; i++ {
		e.expect("POST", "/api/login", map[string]string{"password": "pw", "code": "111111"}, 401)
	}
	e.expect("POST", "/api/login", map[string]string{"password": "pw", "code": "111111"}, 429)
	e.expect("POST", "/api/login", map[string]string{"password": "pw", "code": codeAt(*now)}, 429)
	e.wantEvent("totp.wait", 1)
	// A refused login during the wait did not use the code up.
	later := time.Now().Add(61 * time.Second)
	e.server.loginLimiter.Now = func() time.Time { return later }
	e.server.codeBackoff.Now = func() time.Time { return later }
	e.expect("POST", "/api/login", map[string]string{"password": "pw", "code": codeAt(*now)}, 204)
}

// TestTOTPCodeBackoff: wrong codes after the right password count across
// all addresses. After 5 no login is checked for a minute, then two, and
// so on; a right code clears it. A guesser who has the password gets 15
// codes in the first day and one a day after (auth.TestBackoffDailyBudget).
func TestTOTPCodeBackoff(t *testing.T) {
	e, now := newTOTPEnv(t)
	clock := time.Now()
	e.server.codeBackoff.Now = func() time.Time { return clock }
	newAddress := func() { e.server.loginLimiter = auth.NewLimiter() }
	for i := 0; i < 4; i++ {
		newAddress()
		e.expect("POST", "/api/login", map[string]string{"password": "pw", "code": "111111"}, 401)
	}
	newAddress()
	e.expect("POST", "/api/login", map[string]string{"password": "pw", "code": "111111"}, 429)
	e.wantEvent("totp.wait", 1)
	// From another address, the right code waits too, and a wrong password
	// answers the same, so the wait tells nothing about the password.
	newAddress()
	code, out := e.do("POST", "/api/login", map[string]string{"password": "pw", "code": codeAt(*now)})
	if code != 429 || !strings.Contains(string(out), "60 seconds") {
		t.Fatalf("right code during the wait: %d %s", code, out)
	}
	e.expect("POST", "/api/login", map[string]string{"password": "nope", "code": "222222"}, 429)
	// After the wait one more wrong code doubles it.
	clock = clock.Add(time.Minute)
	newAddress()
	code, out = e.do("POST", "/api/login", map[string]string{"password": "pw", "code": "111111"})
	if code != 429 || !strings.Contains(string(out), "120 seconds") {
		t.Fatalf("wrong code after the first wait: %d %s", code, out)
	}
	clock = clock.Add(2 * time.Minute)
	newAddress()
	e.expect("POST", "/api/login", map[string]string{"password": "pw", "code": codeAt(*now)}, 204)
	// The right code cleared it: 4 wrong codes are free again.
	e.expect("POST", "/api/logout", nil, 204)
	for i := 0; i < 4; i++ {
		newAddress()
		e.expect("POST", "/api/login", map[string]string{"password": "pw", "code": "111111"}, 401)
	}
}

func TestTOTPLoginForm(t *testing.T) {
	e, now := newTOTPEnv(t)
	web := fstest.MapFS{}
	for k, v := range testWeb {
		web[k] = v
	}
	web["login.html"] = &fstest.MapFile{Data: []byte(`<label id="login-code"{{CODE_HIDDEN}}><input name="code"></label>`)}
	e.server.web = web
	page := func() string {
		resp := e.get("/login")
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return string(b)
	}
	if got := page(); got != `<label id="login-code"><input name="code"></label>` {
		t.Errorf("login page with a second factor: %s", got)
	}
	post := func(form url.Values) *http.Response {
		resp, err := e.client.PostForm(e.srv.URL+"/login", form)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp
	}
	if r := post(url.Values{"password": {"pw"}}); !strings.Contains(r.Header.Get("Location"), "error=1") {
		t.Errorf("form without code: %s", r.Header.Get("Location"))
	}
	if r := post(url.Values{"password": {"pw"}, "code": {codeAt(*now)}}); r.Header.Get("Location") != "/" {
		t.Errorf("form with code: %s", r.Header.Get("Location"))
	}
	e.expect("GET", "/api/state", nil, 200)

	// Without a second factor the field stays hidden.
	plain := newEnv(t, Config{})
	plain.server.web = web
	resp := plain.get("/login")
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(b) != `<label id="login-code" hidden><input name="code"></label>` {
		t.Errorf("login page without a second factor: %s", b)
	}
}
