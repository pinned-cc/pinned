package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/pinned-cc/pinned/internal/auth"
)

// legacy drops the version marker, giving the value an older version set.
func legacy(c *http.Cookie) *http.Cookie {
	old := *c
	old.Value = strings.TrimPrefix(c.Value, "v1.")
	return &old
}

func TestSignedCookiesCarryAVersion(t *testing.T) {
	e := newEnv(t, Config{})
	dev := cookieNamed(loginOver(t, e, false), deviceCookie)
	if dev == nil || !strings.HasPrefix(dev.Value, "v1.") {
		t.Fatalf("device cookie %v", dev)
	}
	for _, c := range []*http.Cookie{dev, legacy(dev)} {
		r := httptest.NewRequest("GET", "/", nil)
		r.AddCookie(c)
		if _, ok := e.server.deviceID(r); !ok {
			t.Errorf("device cookie %q not accepted", c.Value)
		}
	}

	// Folder unlock cookies.
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	unlock := cookieOf(e, unlockCookieName(f.ID))
	if !strings.HasPrefix(unlock, "v1.") {
		t.Fatalf("unlock cookie %q", unlock)
	}
	folder, _ := e.st.Folder(f.ID)
	for _, v := range []string{unlock, strings.TrimPrefix(unlock, "v1.")} {
		r := httptest.NewRequest("GET", "/", nil)
		r.AddCookie(&http.Cookie{Name: unlockCookieName(f.ID), Value: v})
		if !e.server.cookieOpens(r, folder) {
			t.Errorf("unlock cookie %q does not open", v)
		}
	}

	// Share unlock cookies.
	g := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Shared"}, 201))
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{"password": "share pass"}, 201))
	v := e.visitor()
	if v.unlock(sh.Token, "share pass") != 204 {
		t.Fatal("share unlock")
	}
	share, _ := e.st.ActiveShare(sh.Token)
	var shareC string
	for _, c := range v.client.Jar.Cookies(mustURL(e.srv.URL + sharePath)) {
		if c.Name == shareCookieName(share, false, false) {
			shareC = c.Value
		}
	}
	if !strings.HasPrefix(shareC, "v1.") {
		t.Fatalf("share cookie %q", shareC)
	}
	for _, val := range []string{shareC, strings.TrimPrefix(shareC, "v1.")} {
		r := httptest.NewRequest("GET", "/", nil)
		r.AddCookie(&http.Cookie{Name: shareCookieName(share, false, false), Value: val})
		if !e.server.shareUnlocked(r, share) {
			t.Errorf("share cookie %q does not open", val)
		}
	}
}

func TestWeakHashesAreReplacedAtTheNextCheck(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	weak := func(pw string) string {
		h, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.MinCost)
		return string(h)
	}
	costOf := func(h *string) int {
		if h == nil {
			return 0
		}
		c, _ := bcrypt.Cost([]byte(*h))
		return c
	}

	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Board", "url": "https://example.com/b", "folder_id": f.ID}, 201))
	if err := e.st.SetLock(f.ID, weak("s3cret")); err != nil {
		t.Fatal(err)
	}
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "wrong"}, 403)
	if got, _ := e.st.Folder(f.ID); costOf(got.LockHash) != bcrypt.MinCost {
		t.Error("a wrong password replaced the hash")
	}
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	if got, _ := e.st.Folder(f.ID); costOf(got.LockHash) != auth.BcryptCost {
		t.Errorf("lock hash cost %d after unlock, want %d", costOf(got.LockHash), auth.BcryptCost)
	}
	if e.state().find(b.ID) == nil {
		t.Error("the unlock cookie does not match the new hash")
	}

	g := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Shared"}, 201))
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{}, 201))
	w := weak("share pass")
	if _, err := e.st.UpdateShare(sh.Token, true, &w, false, nil); err != nil {
		t.Fatal(err)
	}
	v := e.visitor()
	if v.unlock(sh.Token, "share pass") != 204 {
		t.Fatal("share unlock")
	}
	if got, _ := e.st.ActiveShare(sh.Token); costOf(got.PasswordHash) != auth.BcryptCost {
		t.Errorf("share hash cost %d after unlock", costOf(got.PasswordHash))
	}
	if code, _ := v.get("/s/" + sh.Token + "/data"); code != 200 {
		t.Errorf("share data after the rehash: %d", code)
	}
}

// New share hashes use auth.BcryptCost, and a stronger hash of the same
// password leaves the unlock cookies of other browsers working: they sign
// the password's stamp, not its hash.
func TestRehashKeepsOtherUnlockCookies(t *testing.T) {
	old := auth.BcryptCost
	t.Cleanup(func() { auth.BcryptCost = old })
	auth.BcryptCost = bcrypt.MinCost
	e := newEnv(t, Config{})
	e.login()
	cost := func(h *string) int { c, _ := bcrypt.Cost([]byte(*h)); return c }

	g := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Shared"}, 201))
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{"password": "share pass"}, 201))
	if got, _ := e.st.ActiveShare(sh.Token); cost(got.PasswordHash) != bcrypt.MinCost {
		t.Errorf("new share hash cost %d, want auth.BcryptCost %d", cost(got.PasswordHash), bcrypt.MinCost)
	}
	first := e.visitor()
	if first.unlock(sh.Token, "share pass") != 204 {
		t.Fatal("first unlock")
	}
	auth.BcryptCost = bcrypt.MinCost + 1
	if e.visitor().unlock(sh.Token, "share pass") != 204 {
		t.Fatal("second unlock")
	}
	if got, _ := e.st.ActiveShare(sh.Token); cost(got.PasswordHash) != bcrypt.MinCost+1 {
		t.Fatalf("share hash not replaced: cost %d", cost(got.PasswordHash))
	}
	if code, body := first.get("/s/" + sh.Token + "/data"); code != 200 || strings.Contains(body, `"locked":true`) {
		t.Errorf("the first browser lost the share after a rehash: %d %s", code, body)
	}
	// A new password still ends the cookie.
	e.expect("PATCH", "/api/shares/"+sh.Token, map[string]any{"password": "another pass"}, 200)
	if _, body := first.get("/s/" + sh.Token + "/data"); !strings.Contains(body, `"locked":true`) {
		t.Errorf("a new password left the old cookie working: %s", body)
	}

	auth.BcryptCost = bcrypt.MinCost
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Board", "url": "https://example.com/b", "folder_id": f.ID}, 201))
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	other := e.browser(uaSafariIOS)
	if other.do("POST", "/api/login", `{"password":"pw"}`) != 204 {
		t.Fatal("second browser login")
	}
	auth.BcryptCost = bcrypt.MinCost + 1
	if code := other.do("POST", "/api/folders/"+itoa(f.ID)+"/unlock", `{"password":"s3cret"}`); code != 204 {
		t.Fatalf("second browser unlock: %d", code)
	}
	if got, _ := e.st.Folder(f.ID); cost(got.LockHash) != bcrypt.MinCost+1 {
		t.Fatalf("lock hash not replaced: cost %d", cost(got.LockHash))
	}
	if e.state().find(b.ID) == nil {
		t.Error("the first browser lost the unlocked folder after a rehash")
	}
}
