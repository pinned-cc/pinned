package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"

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
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/lock", map[string]any{"password": "s3cret-lock"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "s3cret-lock"}, 204)
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
		c, _ := bcrypt.Cost([]byte(strings.TrimPrefix(*h, "k1:")))
		return c
	}

	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Board", "url": "https://example.com/b", "folder_id": f.ID}, 201))
	if err := e.st.SetLock(f.ID, weak("s3cret-lock")); err != nil {
		t.Fatal(err)
	}
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "wrong"}, 403)
	if got, _ := e.st.Folder(f.ID); costOf(got.LockHash) != bcrypt.MinCost {
		t.Error("a wrong password replaced the hash")
	}
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "s3cret-lock"}, 204)
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
	cost := func(h *string) int { c, _ := bcrypt.Cost([]byte(strings.TrimPrefix(*h, "k1:"))); return c }

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
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/lock", map[string]any{"password": "s3cret-lock"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "s3cret-lock"}, 204)
	other := e.browser(uaSafariIOS)
	if other.do("POST", "/api/login", `{"password":"pw"}`) != 204 {
		t.Fatal("second browser login")
	}
	auth.BcryptCost = bcrypt.MinCost + 1
	if code := other.do("POST", "/api/folders/"+itoa(f.ID)+"/unlock", `{"password":"s3cret-lock"}`); code != 204 {
		t.Fatalf("second browser unlock: %d", code)
	}
	if got, _ := e.st.Folder(f.ID); cost(got.LockHash) != bcrypt.MinCost+1 {
		t.Fatalf("lock hash not replaced: cost %d", cost(got.LockHash))
	}
	if e.state().find(b.ID) == nil {
		t.Error("the first browser lost the unlocked folder after a rehash")
	}
}

// A lock or share password from before 0.1.11 is bcrypt over the password
// itself, and one set before schema 11 has no stamp either: its unlock
// cookies sign the hash. It keeps opening, a 4 character lock included,
// and the next right password stores a keyed hash with a stamp. The
// browser that unlocked keeps its folder; others unlock once more.
func TestOldHashesOpenAndUpgrade(t *testing.T) {
	old := auth.BcryptCost
	t.Cleanup(func() { auth.BcryptCost = old })
	auth.BcryptCost = bcrypt.MinCost
	e := newEnv(t, Config{})
	e.login()
	raw := func(pw string) string {
		h, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
		return string(h)
	}
	g := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Shared"}, 201))
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{"password": "share pass"}, 201))
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Board", "url": "https://example.com/b", "folder_id": f.ID}, 201))
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/lock", map[string]any{"password": "s3cret-lock"}, 204)
	db, err := sql.Open("sqlite", filepath.Join(e.dir, "bookmarks.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE shares SET password_hash = ?, password_stamp = NULL`, raw("share pass")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE folders SET lock_hash = ?, lock_stamp = NULL WHERE id = ?`, raw("abcd"), f.ID); err != nil {
		t.Fatal(err)
	}
	db.Close()

	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "abcde"}, 403)
	if got, _ := e.st.Folder(f.ID); auth.KeyedHash(*got.LockHash) || got.LockStamp != nil {
		t.Error("a wrong password changed the old hash")
	}
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "abcd"}, 204)
	got, _ := e.st.Folder(f.ID)
	if !auth.KeyedHash(*got.LockHash) || got.LockStamp == nil {
		t.Errorf("the old lock hash was not upgraded: %q", *got.LockHash)
	}
	if e.state().find(b.ID) == nil {
		t.Error("the browser that unlocked lost the folder")
	}
	// The upgraded lock opens with the same 4 characters.
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/relock", nil, 204)
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "abcd"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": "abcdabcd"}, 403)

	v := e.visitor()
	if v.unlock(sh.Token, "share pass") != 204 {
		t.Fatal("share unlock with the old hash")
	}
	if got, _ := e.st.ActiveShare(sh.Token); !auth.KeyedHash(*got.PasswordHash) || got.PasswordStamp == nil {
		t.Errorf("the old share hash was not upgraded: %q", *got.PasswordHash)
	}
	if code, body := v.get("/s/" + sh.Token + "/data"); code != 200 || strings.Contains(body, `"locked":true`) {
		t.Errorf("the visitor who unlocked lost the share: %d %s", code, body)
	}
	if e.visitor().unlock(sh.Token, "share pass") != 204 {
		t.Error("the upgraded share hash does not open")
	}
}

// An old hash of a password of exactly 72 bytes matched any longer guess
// that began with it: bcrypt reads only 72 bytes. Such a guess is refused.
func TestOldHashRefusesLongerGuess(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	pw := strings.Repeat("x", 72)
	h, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.MinCost)
	if err := e.st.SetLock(f.ID, string(h)); err != nil {
		t.Fatal(err)
	}
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": pw + "xyz"}, 403)
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/unlock", map[string]any{"password": pw}, 204)
}

// Two browsers that unlock the same pre 0.1.11 lock or share at the same
// moment both match the old hash; the first stores the new one. The second
// then reads the row again, so its cookie opens too (F-82).
func TestConcurrentUnlockOfAnOldHash(t *testing.T) {
	old := auth.BcryptCost
	t.Cleanup(func() { auth.BcryptCost = old })
	auth.BcryptCost = bcrypt.MinCost
	e := newEnv(t, Config{})
	e.login()
	raw := func(pw string) string {
		h, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.MinCost)
		return string(h)
	}
	f := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	b := decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Board", "url": "https://example.com/b", "folder_id": f.ID}, 201))
	e.expect("POST", "/api/folders/"+itoa(f.ID)+"/lock", map[string]any{"password": "s3cret-lock"}, 204)
	g := decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Shared"}, 201))
	sh := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(g.ID)+"/share", map[string]any{"password": "share pass"}, 201))
	db, err := sql.Open("sqlite", filepath.Join(e.dir, "bookmarks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	makeOld := func() {
		db.Exec(`UPDATE folders SET lock_hash = ?, lock_stamp = NULL WHERE id = ?`, raw("s3cret-lock"), f.ID)
		db.Exec(`UPDATE shares SET password_hash = ?, password_stamp = NULL WHERE token = ?`, raw("share pass"), sh.Token)
	}

	// The race, step by step: this request read the old row, another
	// request stored the new hash first.
	makeOld()
	stale, _ := e.st.Folder(f.ID)
	first, _ := auth.HashKeyedPassword(e.server.secret, "s3cret-lock")
	if err := e.st.ReplaceLockHash(f.ID, *stale.LockHash, first); err != nil {
		t.Fatal(err)
	}
	second, _ := auth.HashKeyedPassword(e.server.secret, "s3cret-lock")
	if !e.server.rehashLock(&stale, *stale.LockHash, second, "s3cret-lock") {
		t.Fatal("the late rehash refused the right password")
	}
	if stale.LockStamp == nil || *stale.LockHash != first {
		t.Errorf("the late request kept the old row: %+v", stale)
	}
	other, _ := auth.HashKeyedPassword(e.server.secret, "another one")
	e.st.ReplaceLockHash(f.ID, first, other)
	makeOld()
	stale, _ = e.st.Folder(f.ID)
	e.st.ReplaceLockHash(f.ID, *stale.LockHash, other)
	if e.server.rehashLock(&stale, *stale.LockHash, second, "s3cret-lock") {
		t.Error("a password changed meanwhile still counted as right")
	}
	makeOld()
	staleSh, _ := e.st.ActiveShare(sh.Token)
	firstSh, _ := auth.HashKeyedPassword(e.server.secret, "share pass")
	e.st.ReplaceShareHash(sh.Token, *staleSh.PasswordHash, firstSh)
	if !e.server.rehashShare(&staleSh, *staleSh.PasswordHash, second, "share pass") || staleSh.PasswordStamp == nil {
		t.Error("the late share rehash did not take the fresh row")
	}

	// And over HTTP: every unlock that answers 204 opens.
	for round := 0; round < 5; round++ {
		makeOld()
		var browsers [2]*browser
		for i := range browsers {
			browsers[i] = e.browser(uaSafariIOS)
			if browsers[i].do("POST", "/api/login", `{"password":"pw"}`) != 204 {
				t.Fatal("login")
			}
		}
		visitors := [2]*visitor{e.visitor(), e.visitor()}
		codes, shareCodes := [2]int{}, [2]int{}
		start := make(chan struct{})
		var wg sync.WaitGroup
		for i := range browsers {
			wg.Add(2)
			go func(i int) {
				defer wg.Done()
				<-start
				req, _ := http.NewRequest("POST", e.srv.URL+"/api/folders/"+itoa(f.ID)+"/unlock", strings.NewReader(`{"password":"s3cret-lock"}`))
				req.Header.Set("X-Requested-With", "fetch")
				req.Header.Set("User-Agent", uaSafariIOS)
				if resp, err := browsers[i].client.Do(req); err == nil {
					codes[i] = resp.StatusCode
					resp.Body.Close()
				}
			}(i)
			go func(i int) {
				defer wg.Done()
				<-start
				resp, err := visitors[i].client.Post(e.srv.URL+"/s/"+sh.Token+"/unlock", "application/json", strings.NewReader(`{"password":"share pass"}`))
				if err == nil {
					shareCodes[i] = resp.StatusCode
					resp.Body.Close()
				}
			}(i)
		}
		close(start)
		wg.Wait()
		for i := range browsers {
			if codes[i] != 204 || shareCodes[i] != 204 {
				t.Fatalf("round %d browser %d: unlock %d, share unlock %d", round, i, codes[i], shareCodes[i])
			}
			req, _ := http.NewRequest("GET", e.srv.URL+"/api/state", nil)
			req.Header.Set("X-Requested-With", "fetch")
			req.Header.Set("User-Agent", uaSafariIOS)
			resp, err := browsers[i].client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			var st stateJSON
			json.NewDecoder(resp.Body).Decode(&st)
			resp.Body.Close()
			if st.find(b.ID) == nil {
				t.Errorf("round %d browser %d: unlock answered 204 but the folder stays closed", round, i)
			}
			if code, body := visitors[i].get("/s/" + sh.Token + "/data"); code != 200 || strings.Contains(body, `"locked":true`) {
				t.Errorf("round %d visitor %d: share unlock answered 204 but stays closed: %d", round, i, code)
			}
		}
	}
}
