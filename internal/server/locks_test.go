package server

import (
	"io"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
)

// lockFixture: Work (locked) / Client (subfolder), Reading (open).
type lockFixture struct {
	e                       *env
	work, client, reading   folderJSON
	inWork, inClient, plain bookmarkJSON
}

func newLockFixture(t *testing.T) lockFixture {
	e := newEnv(t, Config{})
	e.login()
	var f lockFixture
	f.e = e
	f.work = decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Work"}, 201))
	f.client = decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Client", "parent_id": f.work.ID}, 201))
	f.reading = decode[folderJSON](t, e.expect("POST", "/api/folders", map[string]any{"name": "Reading"}, 201))
	f.inWork = decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Board", "url": "https://example.com/board", "folder_id": f.work.ID}, 201))
	f.inClient = decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Client portal", "url": "https://example.org/portal", "folder_id": f.client.ID}, 201))
	f.plain = decode[bookmarkJSON](t, e.expect("POST", "/api/bookmarks", map[string]any{"title": "Article", "url": "https://example.net/a", "folder_id": f.reading.ID}, 201))
	e.expect("PATCH", "/api/bookmarks/"+itoa(f.inClient.ID), map[string]any{"pinned": true}, 200)
	return f
}

func (f lockFixture) folder(st stateJSON, id int64) *folderJSON {
	for i := range st.Folders {
		if st.Folders[i].ID == id {
			return &st.Folders[i]
		}
	}
	return nil
}

func TestLockHidesEverythingInside(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "abc"}, 400)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)

	st := e.state()
	work := f.folder(st, f.work.ID)
	if work == nil || !work.Locked || work.Unlocked || work.Name != "Work" {
		t.Fatalf("locked folder entry: %+v", work)
	}
	if f.folder(st, f.client.ID) != nil {
		t.Error("subfolder of a locked folder is listed")
	}
	if r := f.folder(st, f.reading.ID); r == nil || r.Locked || r.Unlocked {
		t.Errorf("open folder: %+v", r)
	}
	if st.find(f.inWork.ID) != nil || st.find(f.inClient.ID) != nil || st.find(f.plain.ID) == nil {
		t.Error("bookmark filter wrong (the pinned one inside must be gone too)")
	}

	// Direct access is a 404.
	id := itoa(f.inClient.ID)
	e.expect("PATCH", "/api/bookmarks/"+id, map[string]any{"title": "x"}, 404)
	e.expect("POST", "/api/bookmarks/"+id+"/open", nil, 404)
	e.expect("POST", "/api/bookmarks/"+id+"/refetch-icon", nil, 404)
	e.expect("DELETE", "/api/bookmarks/"+id, nil, 404)
	e.expect("DELETE", "/api/bookmarks/"+id+"?permanent=1", nil, 404)
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": []int64{f.inClient.ID}, "action": "trash"}, 404)
	// Writing into it is a 404 too.
	e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com/new", "folder_id": f.work.ID}, 404)
	e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com/new", "folder_id": f.client.ID}, 404)
	e.expect("PATCH", "/api/bookmarks/"+itoa(f.plain.ID), map[string]any{"folder_id": f.work.ID}, 404)
	e.expect("POST", "/api/bookmarks/bulk", map[string]any{"ids": []int64{f.plain.ID}, "action": "move", "folder_id": f.client.ID}, 404)
	e.expect("PUT", "/api/bookmarks/order", map[string]any{"folder_id": f.work.ID, "ids": []int64{}}, 404)
	e.expect("POST", "/api/folders", map[string]any{"name": "New", "parent_id": f.work.ID}, 404)
	e.expect("PATCH", "/api/folders/"+itoa(f.work.ID), map[string]any{"name": "Renamed"}, 404)
	e.expect("PATCH", "/api/folders/"+itoa(f.client.ID), map[string]any{"name": "Renamed"}, 404)
	e.expect("PATCH", "/api/folders/"+itoa(f.reading.ID), map[string]any{"parent_id": f.work.ID}, 404)
	e.expect("DELETE", "/api/folders/"+itoa(f.work.ID), nil, 404)

	// The save page learns nothing: the link answers as not saved.
	chk := e.expect("GET", "/api/check?url="+url.QueryEscape("https://example.org/portal"), nil, 200)
	if strings.TrimSpace(string(chk)) != `{"duplicate":null,"icon":null}` {
		t.Errorf("check: %s", chk)
	}
	// The remembered folders never name a hidden folder, even when the
	// last save went into one.
	if _, _, err := e.st.Create(store.NewBookmark{URL: "https://example.org/later", FolderID: &f.client.ID}); err != nil {
		t.Fatal(err)
	}
	if s := e.state().Settings; s.LastFolder != nil || len(s.RecentFolders) != 1 || s.RecentFolders[0] != f.reading.ID {
		t.Errorf("settings leak hidden folders: last %v recent %v", s.LastFolder, s.RecentFolders)
	}
	out := e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.org/portal", "force": true}, 409)
	if strings.Contains(string(out), "portal") || !strings.Contains(string(out), `"locked":true`) {
		t.Errorf("save anyway leaks or moves: %s", out)
	}

	// Export still holds everything.
	body := string(readAll(e.get("/api/export")))
	if !strings.Contains(body, "https://example.org/portal") || !strings.Contains(body, ">Client</H3>") {
		t.Error("export lost the locked links")
	}
}

func TestUnlockRelockAndExpiry(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "wrong"}, 403)
	e.expect("POST", "/api/folders/"+itoa(f.reading.ID)+"/unlock", map[string]any{"password": "x"}, 400)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)

	st := e.state()
	if w := f.folder(st, f.work.ID); !w.Locked || !w.Unlocked {
		t.Errorf("after unlock: %+v", w)
	}
	c := f.folder(st, f.client.ID)
	if c == nil || !c.Locked || !c.Unlocked {
		t.Errorf("subfolder inherits the lock: %+v", c)
	}
	if st.find(f.inClient.ID) == nil {
		t.Error("unlocked contents missing")
	}
	e.expect("PATCH", "/api/bookmarks/"+itoa(f.inClient.ID), map[string]any{"title": "Portal"}, 200)

	// The cookie is signed and short lived.
	resp := e.get("/api/state")
	resp.Body.Close()
	cookies := e.client.Jar.Cookies(mustURL(e.srv.URL + "/"))
	var found bool
	for _, ck := range cookies {
		if ck.Name == "pinned_unlock_"+itoa(f.work.ID) {
			found = true
		}
	}
	if !found {
		t.Fatal("no unlock cookie")
	}
	e.st.Now = func() time.Time { return time.Now().Add(11 * time.Minute) }
	if e.state().find(f.inClient.ID) != nil {
		t.Error("unlock outlived 10 minutes")
	}
	e.st.Now = time.Now

	// Relock hides it again at once.
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/relock", nil, 204)
	if e.state().find(f.inWork.ID) != nil {
		t.Error("relock did not hide")
	}

	// A new password makes the old cookie worthless.
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "n3w pass"}, 204)
	if e.state().find(f.inWork.ID) != nil {
		t.Error("old cookie still opens after a password change")
	}

	// Locking again needs the folder unlocked.
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "other"}, 404)
}

func TestUnlockRateLimitAndRemoveLock(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	for i := 0; i < 4; i++ {
		e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "no"}, 403)
	}
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "no"}, 429)
	// During the wait the password is not checked, so even the right one
	// is refused; once the wait is over it opens.
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 429)
	later := time.Now().Add(auth.Wait + time.Second)
	e.server.folderLimiter.Now = func() time.Time { return later }
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)

	// Per folder: another locked folder still accepts tries.
	e.expect("POST", "/api/folders/"+itoa(f.reading.ID)+"/lock", map[string]any{"password": "read"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.reading.ID)+"/unlock", map[string]any{"password": "read"}, 204)

	e.expect("DELETE", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"app_password": "nope"}, 403)
	e.expect("DELETE", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"app_password": "pw"}, 204)
	st := e.state()
	if w := f.folder(st, f.work.ID); w.Locked || st.find(f.inClient.ID) == nil {
		t.Errorf("lock not removed: %+v", w)
	}
}

func TestLockAndShares(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	parent := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/share", map[string]any{}, 201))
	child := decode[shareJSON](t, e.expect("POST", "/api/folders/"+itoa(f.client.ID)+"/share", map[string]any{}, 201))

	// Locking the client folder removes its share; the parent's share no
	// longer shows the client folder or its bookmarks or icons.
	e.st.SetIcon(f.inClient.ID, "https://example.org/portal", "c.png", nil)
	e.expect("POST", "/api/folders/"+itoa(f.client.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	v := e.visitor()
	if code, _ := v.get("/s/" + child.Token + "/data"); code != 404 {
		t.Errorf("share of the locked folder survived: %d", code)
	}
	code, body := v.get("/s/" + parent.Token + "/data")
	if code != 200 || strings.Contains(body, "portal") || strings.Contains(body, "Client") {
		t.Errorf("parent share leaks the locked subfolder: %d %s", code, body)
	}
	if code, _ := v.get("/s/" + parent.Token + "/icons/c.png"); code != 404 {
		t.Errorf("locked icon served through the parent share: %d", code)
	}

	// Locking the parent removes the parent share, and shares are refused.
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)
	if code, _ := v.get("/s/" + parent.Token + "/data"); code != 404 {
		t.Errorf("parent share survived the lock: %d", code)
	}
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/share", map[string]any{}, 409)
	e.expect("POST", "/api/folders/"+itoa(f.work.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	e.expect("POST", "/api/folders/"+itoa(f.client.ID)+"/share", map[string]any{}, 409)
	if w := f.folder(e.state(), f.work.ID); w.Share != nil {
		t.Error("state still carries the removed share")
	}
}

func TestLockedTrashAndFolderDelete(t *testing.T) {
	f := newLockFixture(t)
	e := f.e
	e.expect("DELETE", "/api/bookmarks/"+itoa(f.inClient.ID), nil, 204)
	e.expect("POST", "/api/folders/"+itoa(f.client.ID)+"/lock", map[string]any{"password": "s3cret"}, 204)

	// Trashed from a locked folder: hidden in Trash, and Empty trash keeps it.
	if e.state().find(f.inClient.ID) != nil {
		t.Error("trashed bookmark of a locked folder is visible")
	}
	e.expect("POST", "/api/bookmarks/"+itoa(f.inClient.ID)+"/restore", nil, 404)
	e.expect("DELETE", "/api/trash", nil, 204)
	if _, err := e.st.Bookmark(f.inClient.ID); err != nil {
		t.Error("empty trash deleted a hidden bookmark")
	}

	// Deleting the open parent would spill the locked child into Trash.
	e.expect("DELETE", "/api/folders/"+itoa(f.work.ID), nil, 409)
	e.expect("POST", "/api/folders/"+itoa(f.client.ID)+"/unlock", map[string]any{"password": "s3cret"}, 204)
	e.expect("DELETE", "/api/folders/"+itoa(f.work.ID), nil, 204)
}

func TestLockRoutesNeedSessionAndHeader(t *testing.T) {
	f := newLockFixture(t)
	resp, _ := f.e.client.Post(f.e.srv.URL+"/api/folders/"+itoa(f.work.ID)+"/lock", "application/json", strings.NewReader(`{"password":"s3cret"}`))
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Errorf("lock without CSRF header: %d", resp.StatusCode)
	}
	if code, _ := f.e.visitor().get("/api/state"); code != 401 {
		t.Errorf("state without session: %d", code)
	}
	f.e.expect("POST", "/api/folders/999/lock", map[string]any{"password": "s3cret"}, 404)
	f.e.expect("POST", "/api/folders/999/unlock", map[string]any{"password": "s3cret"}, 404)
	f.e.expect("POST", "/api/folders/999/relock", nil, 404)
}
