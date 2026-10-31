package server

import (
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"
	"time"

	"github.com/pinned-cc/pinned/internal/auth"
)

// browser is a second browser on e's server, with its own cookies and
// User-Agent.
type browser struct {
	e      *env
	client *http.Client
	ua     string
}

func (e *env) browser(ua string) *browser {
	jar, _ := cookiejar.New(nil)
	return &browser{e: e, client: &http.Client{Jar: jar}, ua: ua}
}

func (b *browser) do(method, path, body string) int {
	b.e.t.Helper()
	req, _ := http.NewRequest(method, b.e.srv.URL+path, strings.NewReader(body))
	req.Header.Set("X-Requested-With", "fetch")
	req.Header.Set("User-Agent", b.ua)
	resp, err := b.client.Do(req)
	if err != nil {
		b.e.t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

const (
	uaFirefoxMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:144.0) Gecko/20100101 Firefox/144.0"
	uaSafariIOS  = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
)

func TestSessionsListAndSignOut(t *testing.T) {
	e := newEnv(t, Config{})
	laptop, phone := e.browser(uaFirefoxMac), e.browser(uaSafariIOS)
	for _, b := range []*browser{laptop, phone} {
		if code := b.do("POST", "/api/login", `{"password":"pw"}`); code != 204 {
			t.Fatalf("login %d", code)
		}
	}
	// The list, seen from the test's own client after its login.
	e.login()
	list := decode[[]sessionJSON](t, e.expect("GET", "/api/sessions", nil, 200))
	if len(list) != 3 {
		t.Fatalf("sessions %+v", list)
	}
	names, current := map[string]int64{}, 0
	for _, x := range list {
		names[x.Browser] = x.ID
		if x.Current {
			current++
		}
		if x.CreatedAt == 0 || x.UsedAt == 0 {
			t.Errorf("no times: %+v", x)
		}
	}
	if current != 1 || names["Firefox on macOS"] == 0 || names["Safari on iPhone"] == 0 {
		t.Fatalf("sessions %+v", list)
	}
	if body := string(e.expect("GET", "/api/sessions", nil, 200)); strings.Contains(body, "hash") {
		t.Errorf("list shows a hash: %s", body)
	}

	// Signing out another browser asks for the app password again.
	phoneID := itoa(names["Safari on iPhone"])
	e.expect("DELETE", "/api/sessions/"+phoneID, nil, 400)
	e.expect("DELETE", "/api/sessions/"+phoneID, map[string]string{"password": "wrong"}, 403)
	e.expect("DELETE", "/api/sessions", map[string]string{"password": "wrong"}, 403)
	e.wantEvent("reauth.fail", 2)
	if l := e.events("reauth.fail"); !strings.Contains(l[0], "for=session.end") || !strings.Contains(l[1], "for=session.end_others") {
		t.Errorf("reauth lines: %v", l)
	}
	if code := phone.do("GET", "/api/state", ""); code != 200 {
		t.Errorf("phone signed out by a wrong password: %d", code)
	}
	e.expect("DELETE", "/api/sessions/"+phoneID, map[string]string{"password": "pw"}, 204)
	if code := phone.do("GET", "/api/state", ""); code != 401 {
		t.Errorf("signed out phone: %d", code)
	}
	if code := laptop.do("GET", "/api/state", ""); code != 200 {
		t.Errorf("laptop: %d", code)
	}
	e.expect("DELETE", "/api/sessions/"+phoneID, map[string]string{"password": "pw"}, 404)
	e.wantEvent("session.end", 1)

	// Sign out every other browser.
	phone.do("POST", "/api/login", `{"password":"pw"}`)
	out := decode[map[string]int](t, e.expect("DELETE", "/api/sessions", map[string]string{"password": "pw"}, 200))
	if out["ended"] != 2 || laptop.do("GET", "/api/state", "") != 401 || phone.do("GET", "/api/state", "") != 401 {
		t.Errorf("sign out others: %v", out)
	}
	e.expect("GET", "/api/state", nil, 200)
	e.wantEvent("session.end_others", 1)

	// A token cannot see or end sessions.
	tok := e.newToken("script")
	for _, m := range []string{"GET", "DELETE"} {
		resp := e.bearer(m, "/api/sessions", tok, nil)
		resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Errorf("%s /api/sessions with a token: %d", m, resp.StatusCode)
		}
	}

	// Wrong passwords here count in the login limiter: after 5 the client
	// waits, as for creating a token.
	for i := 0; i < 4; i++ {
		e.expect("DELETE", "/api/sessions", map[string]string{"password": "wrong"}, 403)
	}
	e.expect("DELETE", "/api/sessions", map[string]string{"password": "wrong"}, 429)
	e.expect("DELETE", "/api/sessions", map[string]string{"password": "pw"}, 429)
	e.server.loginLimiter = auth.NewLimiter()

	// Ending this browser's own session is a logout, no password needed.
	list = decode[[]sessionJSON](t, e.expect("GET", "/api/sessions", nil, 200))
	e.expect("DELETE", "/api/sessions/"+itoa(list[0].ID), nil, 204)
	if code, _ := e.do("GET", "/api/state", nil); code != 401 {
		t.Errorf("after ending its own session: %d", code)
	}
}

func TestSessionAbsoluteLifetime(t *testing.T) {
	e := newEnv(t, Config{SessionDays: 90, SessionMaxDays: 100})
	start := time.Now()
	e.login()
	// Used often, it is renewed for 90 days but never past 100 days from
	// the login.
	at := func(days int) int {
		e.st.Now = func() time.Time { return start.Add(time.Duration(days) * 24 * time.Hour) }
		resp := e.get("/api/state")
		resp.Body.Close()
		if days == 40 {
			if c := resp.Cookies(); len(c) != 1 || c[0].MaxAge > 60*86400 || c[0].MaxAge < 60*86400-60 {
				t.Errorf("renewed past the absolute lifetime: %v", c)
			}
		}
		return resp.StatusCode
	}
	for _, d := range []int{40, 80, 99} {
		if code := at(d); code != 200 {
			t.Fatalf("day %d: %d", d, code)
		}
	}
	if code := at(101); code != 401 {
		t.Errorf("day 101, used two days ago: %d", code)
	}
}

func TestSessionLastUseRecordedHourly(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	start := time.Now()
	used := func() int64 { return decode[[]sessionJSON](t, e.expect("GET", "/api/sessions", nil, 200))[0].UsedAt }
	first := used()
	e.st.Now = func() time.Time { return start.Add(30 * time.Minute) }
	if used() != first {
		t.Error("last use written within the hour")
	}
	e.st.Now = func() time.Time { return start.Add(2 * time.Hour) }
	used()
	if got := used(); got != start.Add(2*time.Hour).Unix() {
		t.Errorf("last use %d, want %d", got, start.Add(2*time.Hour).Unix())
	}
}

func TestBrowserName(t *testing.T) {
	for ua, want := range map[string]string{
		uaFirefoxMac: "Firefox on macOS",
		uaSafariIOS:  "Safari on iPhone",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0": "Edge on Windows",
		"Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36":                  "Chrome on Android",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15":         "Safari on macOS",
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36":                         "Chrome on Linux",
		"curl/8.7.1": "",
		"":           "",
	} {
		if got := browserName(ua); got != want {
			t.Errorf("browserName(%q) = %q, want %q", ua, got, want)
		}
	}
}
