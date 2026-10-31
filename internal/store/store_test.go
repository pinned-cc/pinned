package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pinned-cc/pinned/internal/netscape"
	"github.com/pinned-cc/pinned/internal/urlkey"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func mustCreate(t *testing.T, s *Store, title, url string, folder *int64) Bookmark {
	t.Helper()
	b, created, err := s.Create(NewBookmark{Title: title, URL: url, FolderID: folder})
	if err != nil || !created {
		t.Fatalf("create %s: %v", url, err)
	}
	return b
}

func TestReopenKeepsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	mustCreate(t, s, "A", "https://example.com", nil)
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if n, _ := s.CountLive(); n != 1 {
		t.Errorf("want 1 bookmark after reopen, got %d", n)
	}
}

func TestPortsAreDifferentBookmarks(t *testing.T) {
	s := open(t)
	mustCreate(t, s, "Dashboard", "http://homelab:8080", nil)
	mustCreate(t, s, "Status", "http://homelab:8081", nil)
	_, _, err := s.Create(NewBookmark{Title: "Again", URL: "http://HOMELAB:8080/#x"})
	var dup *DuplicateError
	if !errors.As(err, &dup) || dup.Existing.Title != "Dashboard" {
		t.Fatalf("want duplicate of Dashboard, got %v", err)
	}
	if n, _ := s.CountLive(); n != 2 {
		t.Errorf("want 2, got %d", n)
	}
}

func TestForceMovesExisting(t *testing.T) {
	s := open(t)
	f, _ := s.CreateFolder("Work", nil)
	b := mustCreate(t, s, "Old", "https://example.com/a", nil)
	got, created, err := s.Create(NewBookmark{Title: "New", URL: "https://example.com/a", FolderID: &f.ID, Force: true})
	if err != nil || created {
		t.Fatalf("force: created=%v err=%v", created, err)
	}
	if got.ID != b.ID || got.Title != "New" || got.FolderID == nil || *got.FolderID != f.ID {
		t.Errorf("unexpected %+v", got)
	}
}

func TestRecentFolders(t *testing.T) {
	s := open(t)
	var ids []int64
	for _, n := range []string{"A", "B", "C", "D"} {
		f, _ := s.CreateFolder(n, nil)
		ids = append(ids, f.ID)
		mustCreate(t, s, n, "https://example.com/"+n, &f.ID)
	}
	mustCreate(t, s, "B2", "https://example.com/B2", &ids[1])
	st, _ := s.Settings()
	if *st.LastFolder != ids[1] {
		t.Errorf("last folder %d", *st.LastFolder)
	}
	want := []int64{ids[1], ids[3], ids[2]}
	for i := range want {
		if st.RecentFolders[i] != want[i] {
			t.Fatalf("recent %v want %v", st.RecentFolders, want)
		}
	}
}

func TestTrashRestoreAndRestoreConflict(t *testing.T) {
	s := open(t)
	b := mustCreate(t, s, "A", "https://example.com", nil)
	if err := s.Trash(b.ID); err != nil {
		t.Fatal(err)
	}
	// The same URL can be saved again while the old one is in Trash.
	mustCreate(t, s, "A again", "https://example.com/", nil)
	var dup *DuplicateError
	if err := s.Restore(b.ID, nil); !errors.As(err, &dup) {
		t.Errorf("want duplicate on restore, got %v", err)
	}
	if err := s.Trash(999); !errors.Is(err, ErrNotFound) {
		t.Errorf("want not found, got %v", err)
	}
}

func TestDeleteFolderTrashesEverythingInside(t *testing.T) {
	s := open(t)
	top, _ := s.CreateFolder("Home lab", nil)
	sub, _ := s.CreateFolder("Media", &top.ID)
	deep, _ := s.CreateFolder("Deep", &sub.ID)
	mustCreate(t, s, "1", "http://10.0.0.5:1", &top.ID)
	mustCreate(t, s, "2", "http://10.0.0.5:2", &sub.ID)
	mustCreate(t, s, "3", "http://10.0.0.5:3", &deep.ID)
	keep := mustCreate(t, s, "4", "http://10.0.0.5:4", nil)

	n, err := s.DeleteFolder(top.ID)
	if err != nil || n != 3 {
		t.Fatalf("trashed %d, err %v", n, err)
	}
	folders, _ := s.Folders()
	if len(folders) != 0 {
		t.Errorf("subfolders left: %+v", folders)
	}
	all, _ := s.Bookmarks()
	for _, b := range all {
		if b.ID == keep.ID {
			if b.DeletedAt != nil {
				t.Error("unrelated bookmark trashed")
			}
			continue
		}
		if b.DeletedAt == nil || b.FolderID != nil {
			t.Errorf("bookmark %s should be in Trash without folder: %+v", b.Title, b)
		}
	}
}

func TestFolderCycle(t *testing.T) {
	s := open(t)
	a, _ := s.CreateFolder("A", nil)
	b, _ := s.CreateFolder("B", &a.ID)
	if _, err := s.UpdateFolder(a.ID, nil, true, &b.ID); !errors.Is(err, ErrCycle) {
		t.Errorf("want cycle error, got %v", err)
	}
	if _, err := s.UpdateFolder(a.ID, nil, true, &a.ID); !errors.Is(err, ErrCycle) {
		t.Errorf("want cycle error for self, got %v", err)
	}
	f, err := s.UpdateFolder(b.ID, nil, true, nil)
	if err != nil || f.ParentID != nil {
		t.Errorf("move to top: %+v %v", f, err)
	}
}

func TestPurge(t *testing.T) {
	s := open(t)
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }

	old := mustCreate(t, s, "Old", "https://example.com/old", nil)
	recent := mustCreate(t, s, "Recent", "https://example.com/recent", nil)
	live := mustCreate(t, s, "Live", "https://example.com/live", nil)

	// Old and Live share one icon file; Recent has its own.
	s.SetIcon(old.ID, old.URLKey, "shared.png", nil)
	s.SetIcon(live.ID, live.URLKey, "shared.png", nil)
	s.SetIcon(recent.ID, recent.URLKey, "own.png", nil)

	s.Now = func() time.Time { return now.Add(-31 * 24 * time.Hour) }
	s.Trash(old.ID)
	s.Now = func() time.Time { return now.Add(-29 * 24 * time.Hour) }
	s.Trash(recent.ID)
	s.Now = func() time.Time { return now }

	n, orphans, err := s.Purge(30)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("purged %d, want 1", n)
	}
	if len(orphans) != 0 {
		t.Errorf("shared icon must stay while Live uses it, orphans %v", orphans)
	}
	if _, err := s.Bookmark(old.ID); !errors.Is(err, ErrNotFound) {
		t.Error("old bookmark still there")
	}
	if _, err := s.Bookmark(recent.ID); err != nil {
		t.Error("recent bookmark purged too early")
	}

	// 2 days later Recent is past 30 days and its icon is orphaned.
	s.Now = func() time.Time { return now.Add(2 * 24 * time.Hour) }
	n, orphans, _ = s.Purge(30)
	if n != 1 || len(orphans) != 1 || orphans[0] != "own.png" {
		t.Errorf("second purge n=%d orphans=%v", n, orphans)
	}
}

func TestImportFixturesAndReimport(t *testing.T) {
	s := open(t)
	for _, name := range []string{"flat.html", "brave.html"} {
		f, err := os.Open(filepath.Join("..", "netscape", "testdata", name))
		if err != nil {
			t.Fatal(err)
		}
		root, err := netscape.Parse(f)
		f.Close()
		if err != nil {
			t.Fatal(err)
		}
		res, err := s.Import(root, nil)
		if err != nil {
			t.Fatal(err)
		}
		again, err := s.Import(root, nil)
		if err != nil {
			t.Fatal(err)
		}
		switch name {
		case "flat.html":
			if res.Added != 8 || res.Skipped != 0 || res.Folders != 0 {
				t.Errorf("flat: %+v", res)
			}
			if again.Added != 0 || again.Skipped != 8 || again.Folders != 0 {
				t.Errorf("flat again: %+v", again)
			}
		case "brave.html":
			// 8 links: javascript: is skipped, and http://homelab:3000/ is
			// the same bookmark as http://homelab:3000 from flat.html.
			if res.Added != 6 || res.Skipped != 2 || res.Folders != 5 {
				t.Errorf("brave: %+v", res)
			}
			if again.Added != 0 || again.Skipped != 8 || again.Folders != 0 {
				t.Errorf("brave again: %+v", again)
			}
		}
	}

	// The tree comes back out the same way.
	tree, err := s.ExportTree()
	if err != nil {
		t.Fatal(err)
	}
	links, folders := tree.Count()
	if links != 14 || folders != 5 || len(tree.Links) != 8 {
		t.Errorf("export: %d links, %d folders, %d at root", links, folders, len(tree.Links))
	}
	reading := tree.Folders[0].Folders[0].Folders[0]
	if reading.Name != "Reading" || reading.Links[0].AddDate != 1759400700 {
		t.Errorf("nested folder or ADD_DATE lost: %+v", reading)
	}
}

func TestBulkAndOrder(t *testing.T) {
	s := open(t)
	f, _ := s.CreateFolder("Reading", nil)
	a := mustCreate(t, s, "A", "https://example.com/a", nil)
	b := mustCreate(t, s, "B", "https://example.com/b", nil)
	c := mustCreate(t, s, "C", "https://example.com/c", nil)

	if _, err := s.Bulk([]int64{a.ID, b.ID}, "move", &f.ID, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.OrderBookmarks(&f.ID, []int64{b.ID, a.ID}); err != nil {
		t.Fatal(err)
	}
	ga, _ := s.Bookmark(a.ID)
	gb, _ := s.Bookmark(b.ID)
	if *ga.FolderID != f.ID || gb.Position != 0 || ga.Position != 1 {
		t.Errorf("move or order failed: %+v %+v", ga, gb)
	}
	s.Bulk([]int64{a.ID, b.ID, c.ID}, "pin", nil, nil)
	s.OrderPinned([]int64{c.ID, a.ID, b.ID})
	gc, _ := s.Bookmark(c.ID)
	if !gc.Pinned || gc.PinnedPosition != 0 {
		t.Errorf("pin order: %+v", gc)
	}
	s.Bulk([]int64{c.ID}, "trash", nil, nil)
	s.Bulk([]int64{c.ID}, "restore", nil, nil)
	if gc, _ = s.Bookmark(c.ID); gc.DeletedAt != nil {
		t.Error("restore failed")
	}
	// Delete skips bookmarks that are not in Trash.
	if _, err := s.Bulk([]int64{a.ID, c.ID}, "delete", nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Bookmark(c.ID); err != nil {
		t.Errorf("live bookmark deleted without Trash: %v", err)
	}
	s.Bulk([]int64{c.ID}, "trash", nil, nil)
	if _, err := s.Bulk([]int64{a.ID, c.ID}, "delete", nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Bookmark(c.ID); !errors.Is(err, ErrNotFound) {
		t.Error("delete from Trash failed")
	}
	if ga, err := s.Bookmark(a.ID); err != nil || ga.DeletedAt != nil {
		t.Errorf("live bookmark touched by delete: %+v %v", ga, err)
	}
	if _, err := s.Bulk([]int64{a.ID}, "explode", nil, nil); err == nil {
		t.Error("unknown action accepted")
	}
}

// valid reports whether the hashed token names a session that has not expired.
func valid(s *Store, hash string) bool {
	x, ok := s.Session(hash)
	return ok && x.ExpiresAt > s.Now().Unix()
}

func TestSessions(t *testing.T) {
	s := open(t)
	s.CreateSession("h1", "", time.Now().Add(time.Hour))
	s.CreateSession("h2", "", time.Now().Add(-time.Hour))
	if !valid(s, "h1") || valid(s, "h2") || valid(s, "nope") {
		t.Error("session validity wrong")
	}
	s.DeleteSession("h1")
	if valid(s, "h1") {
		t.Error("deleted session still valid")
	}
}

func TestSyncPasswordSignsOutSessions(t *testing.T) {
	s := open(t)
	// The check stands in for bcrypt: a record matches when it equals
	// "hash:" plus the password, and a legacy record "hmac:" plus it.
	sync := func(pw string) (bool, error) {
		return s.SyncPassword(func(stored string, legacy bool) (bool, bool) {
			if legacy {
				return stored == "hmac:"+pw, true
			}
			return stored == "hash:"+pw, false
		}, func() (string, error) { return "hash:" + pw, nil })
	}
	stored := func() map[string]string {
		out := map[string]string{}
		rows, _ := s.db.Query(`SELECT key, value FROM settings WHERE key LIKE 'password%'`)
		defer rows.Close()
		for rows.Next() {
			var k, v string
			rows.Scan(&k, &v)
			out[k] = v
		}
		return out
	}
	s.CreateSession("old", "", time.Now().Add(time.Hour))
	s.CreateToken("phone", "tokenhash")
	if changed, err := sync("pw1"); err != nil || changed {
		t.Fatalf("first start: changed=%v err=%v", changed, err)
	}
	if !valid(s, "old") || stored()["password_hash"] != "hash:pw1" {
		t.Errorf("first start must keep sessions and store the hash: %v", stored())
	}
	if changed, _ := sync("pw1"); changed || !valid(s, "old") {
		t.Error("same password signed out")
	}
	if _, err := s.TokenByHash("tokenhash"); err != nil {
		t.Error("the same password must keep API tokens")
	}
	if changed, _ := sync("pw2"); !changed || valid(s, "old") {
		t.Error("a new password must sign out every session")
	}
	if _, err := s.TokenByHash("tokenhash"); !errors.Is(err, ErrNotFound) {
		t.Error("a new password must revoke every API token")
	}
	if stored()["password_hash"] != "hash:pw2" {
		t.Errorf("new hash not stored: %v", stored())
	}
}

func TestSyncPasswordMovesTheOldHMAC(t *testing.T) {
	for _, tc := range []struct {
		pw      string
		changed bool
	}{{"pw1", false}, {"pw2", true}} {
		s := open(t)
		s.db.Exec(`INSERT INTO settings (key, value) VALUES ('password_hmac', 'hmac:pw1')`)
		s.CreateSession("old", "", time.Now().Add(time.Hour))
		changed, err := s.SyncPassword(func(stored string, legacy bool) (bool, bool) {
			return legacy && stored == "hmac:"+tc.pw, true
		}, func() (string, error) { return "hash:" + tc.pw, nil })
		if err != nil || changed != tc.changed || valid(s, "old") == tc.changed {
			t.Errorf("%s: changed=%v err=%v", tc.pw, changed, err)
		}
		var n int
		s.db.QueryRow(`SELECT COUNT(*) FROM settings WHERE key = 'password_hmac'`).Scan(&n)
		var h string
		s.db.QueryRow(`SELECT value FROM settings WHERE key = 'password_hash'`).Scan(&h)
		if n != 0 || h != "hash:"+tc.pw {
			t.Errorf("%s: the HMAC record stays (%d) or no hash (%q)", tc.pw, n, h)
		}
	}
}

func TestExtendSession(t *testing.T) {
	s := open(t)
	s.CreateSession("h", "", time.Now().Add(time.Hour))
	later := time.Now().Add(48 * time.Hour).Truncate(time.Second)
	if err := s.ExtendSession("h", later); err != nil {
		t.Fatal(err)
	}
	if x, ok := s.Session("h"); !ok || x.ExpiresAt != later.Unix() {
		t.Errorf("expiry %v %v", x.ExpiresAt, ok)
	}
	if err := s.ExtendSession("nope", later); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown session: %v", err)
	}
	if err := s.PurgeSessions(); err != nil {
		t.Fatal(err)
	}
}

func TestFolderDepthLimit(t *testing.T) {
	s := open(t)
	var parent *int64
	var ids []int64
	for i := 0; i < MaxDepth; i++ {
		f, err := s.CreateFolder("f", parent)
		if err != nil {
			t.Fatalf("depth %d: %v", i+1, err)
		}
		ids = append(ids, f.ID)
		parent = &f.ID
	}
	if _, err := s.CreateFolder("too deep", parent); !errors.Is(err, ErrTooDeep) {
		t.Errorf("depth 33: %v", err)
	}
	a, _ := s.CreateFolder("a", nil)
	s.CreateFolder("b", &a.ID)
	// a has height 2: under depth 30 it reaches 32, under 31 it would be 33.
	if _, err := s.UpdateFolder(a.ID, nil, true, &ids[29]); err != nil {
		t.Errorf("move to depth 31: %v", err)
	}
	if _, err := s.UpdateFolder(a.ID, nil, true, &ids[30]); !errors.Is(err, ErrTooDeep) {
		t.Errorf("move to depth 32 with a child: %v", err)
	}
}

func TestImportDeepFileExportsSmall(t *testing.T) {
	s := open(t)
	root := &netscape.Folder{}
	f := root
	for i := 0; i < netscape.MaxNesting; i++ { // the deepest file Parse accepts
		sub := &netscape.Folder{Name: "n"}
		f.Folders = append(f.Folders, sub)
		f = sub
	}
	f.Links = []netscape.Link{{Title: "bottom", URL: "https://example.com/bottom"}}
	res, err := s.Import(root, nil)
	if err != nil || res.Folders != MaxDepth || res.Added != 1 {
		t.Fatalf("import: %+v %v", res, err)
	}
	tree, err := s.ExportTree()
	if err != nil {
		t.Fatal(err)
	}
	var buf strings.Builder
	start := time.Now()
	if err := netscape.Write(&buf, tree); err != nil {
		t.Fatal(err)
	}
	if took := time.Since(start); buf.Len() > 20<<20 || took > 2*time.Second {
		t.Errorf("export %d bytes in %v", buf.Len(), took)
	}
}

func TestImportBesideLockedFolder(t *testing.T) {
	s := open(t)
	work, _ := s.CreateFolder("Work", nil)
	s.SetLock(work.ID, "hash")
	root := &netscape.Folder{Folders: []*netscape.Folder{{Name: "Work", Links: []netscape.Link{{Title: "x", URL: "https://example.com/x"}}}}}
	res, err := s.Import(root, nil)
	if err != nil || res.Folders != 1 || res.Added != 1 {
		t.Fatalf("import: %+v %v", res, err)
	}
	b, _ := s.FindLive("https://example.com/x", nil)
	f, _ := s.Folder(*b.FolderID)
	if f.ID == work.ID || f.Name != "Work (imported)" || f.ParentID != nil {
		t.Errorf("landed in %+v", f)
	}
	// "Work (imported)" locked too: the next one gets another suffix.
	s.SetLock(f.ID, "hash")
	root.Folders[0].Links[0].URL = "https://example.com/y"
	s.Import(root, nil)
	b, _ = s.FindLive("https://example.com/y", nil)
	if g, _ := s.Folder(*b.FolderID); g.Name != "Work (imported) (imported)" {
		t.Errorf("second landed in %q", g.Name)
	}
}

func TestIconsForOrigin(t *testing.T) {
	s := open(t)
	f, _ := s.CreateFolder("F", nil)
	a := mustCreate(t, s, "a", "http://homelab:8080/a", &f.ID)
	b := mustCreate(t, s, "b", "http://homelab:8080/b", nil)
	c := mustCreate(t, s, "c", "http://homelab:8081/", nil)
	d := mustCreate(t, s, "d", "http://homelab.example/", nil)
	s.SetIcon(a.ID, a.URLKey, "a.png", nil)
	s.SetIcon(b.ID, b.URLKey, "b.png", nil)
	s.SetIcon(c.ID, c.URLKey, "c.png", nil)
	s.SetIcon(d.ID, d.URLKey, "d.png", nil)
	s.Trash(a.ID)
	list, err := s.IconsForOrigin("http://HOMELAB:8080/other")
	if err != nil || len(list) != 2 || list[0].Icon != "b.png" || list[1].Icon != "a.png" || *list[1].FolderID != f.ID {
		t.Errorf("icons: %+v %v", list, err)
	}
	if list, _ := s.IconsForOrigin("nope"); list != nil {
		t.Error("invalid url gave icons")
	}
}

// A database from before Hide from Recent gains the column on open, and the
// folders already in it start with the setting off.
func TestHideRecentMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE schema_version (version INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	old := 5 // the schema before hide_recent
	for _, m := range migrations[:old] {
		if _, err := db.Exec(m); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (?)`, old); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO folders (name, position, created_at) VALUES ('NAS', 0, 1)`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	fs, err := s.Folders()
	if err != nil || len(fs) != 1 || fs[0].Name != "NAS" || fs[0].HideRecent {
		t.Fatalf("after migration: %+v %v", fs, err)
	}
	var version int
	if err := s.db.QueryRow(`SELECT version FROM schema_version`).Scan(&version); err != nil || version != len(migrations) {
		t.Errorf("version %d, want %d (%v)", version, len(migrations), err)
	}
}

func TestSetHideRecent(t *testing.T) {
	s := open(t)
	a, _ := s.CreateFolder("NAS", nil)
	if a.HideRecent {
		t.Fatal("a new folder starts hidden from Recent")
	}
	f, err := s.SetHideRecent(a.ID, true)
	if err != nil || !f.HideRecent {
		t.Fatalf("on: %+v %v", f, err)
	}
	if g, _ := s.Folder(a.ID); !g.HideRecent {
		t.Error("setting did not persist")
	}
	if f, err = s.SetHideRecent(a.ID, false); err != nil || f.HideRecent {
		t.Errorf("off: %+v %v", f, err)
	}
	if _, err := s.SetHideRecent(999, true); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing folder: %v", err)
	}
}

func TestOpenRefusesNewerSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	newer := len(migrations) + 1
	if _, err := s.db.Exec(`UPDATE schema_version SET version = ?`, newer); err != nil {
		t.Fatal(err)
	}
	s.Close()
	_, err = Open(path)
	var e *NewerSchemaError
	if !errors.As(err, &e) || e.Have != newer || e.Know != len(migrations) {
		t.Fatalf("newer schema opened: %v", err)
	}
	want := fmt.Sprintf("database was written by a newer Pinned (schema %d); this version knows %d. Update the image or restore a backup.", newer, len(migrations))
	if err.Error() != want {
		t.Errorf("message %q", err)
	}
	// With copies in the folder, the message names the newest one of this
	// version's schema, the one to go back to.
	dir := filepath.Dir(path)
	for _, name := range []string{
		fmt.Sprintf("test-schema%d-2026-10-01-100000.db", len(migrations)),
		fmt.Sprintf("test-schema%d-2026-11-02-090000.db", len(migrations)),
		fmt.Sprintf("test-schema%d-2026-12-01-100000.db", len(migrations)-1),
	} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	_, err = Open(path)
	wantFile := fmt.Sprintf("test-schema%d-2026-11-02-090000.db", len(migrations))
	if !errors.As(err, &e) || e.Backup != wantFile || !strings.Contains(err.Error(), "restore "+wantFile+" from the data folder as bookmarks.db") || !strings.Contains(err.Error(), "API tokens revoked and sessions ended since are back") || !strings.Contains(err.Error(), "change APP_PASSWORD") {
		t.Errorf("message with copies: %v", err)
	}
}

func TestIconFailures(t *testing.T) {
	s := open(t)
	b, _, err := s.Create(NewBookmark{Title: "A", URL: "http://a.example/"})
	if err != nil {
		t.Fatal(err)
	}
	given := func() map[int64]string {
		t.Helper()
		g, err := s.IconsGivenUp()
		if err != nil {
			t.Fatal(err)
		}
		return g
	}
	for i := 1; i < IconGiveUp; i++ {
		s.IconFailed(b.ID, b.URLKey, false)
	}
	if len(given()) != 0 {
		t.Fatal("given up too early")
	}
	// A failure for another address starts again.
	s.IconFailed(b.ID, "http://b.example/", false)
	if len(given()) != 0 {
		t.Fatal("a new address kept the old count")
	}
	s.IconFailed(b.ID, b.URLKey, true)
	if given()[b.ID] != b.URLKey {
		t.Fatal("final failure not given up at once")
	}
	// The same version keeps the failures, a new one forgets them.
	if err := s.ResetIconFailures("v1"); err != nil {
		t.Fatal(err)
	}
	s.IconFailed(b.ID, b.URLKey, true)
	if err := s.ResetIconFailures("v1"); err != nil || len(given()) != 1 {
		t.Fatalf("same version forgot: %v", err)
	}
	if err := s.ResetIconFailures("v2"); err != nil || len(given()) != 0 {
		t.Fatalf("new version kept: %v", err)
	}
	// A stored icon clears the failures.
	s.IconFailed(b.ID, b.URLKey, true)
	if _, err := s.SetIcon(b.ID, b.URLKey, "1-x.png", nil); err != nil {
		t.Fatal(err)
	}
	if len(given()) != 0 {
		t.Fatal("icon stored but still given up")
	}
	if err := s.IconFailed(999, "http://x/", false); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing bookmark: %v", err)
	}
}

func TestImportRefusesTreeTooDeep(t *testing.T) {
	s := open(t)
	root := &netscape.Folder{}
	f := root
	for range 1_000_000 {
		sub := &netscape.Folder{Name: "f"}
		f.Folders = []*netscape.Folder{sub}
		f = sub
	}
	f.Links = []netscape.Link{{Title: "x", URL: "https://example.com/"}}
	if _, err := s.Import(root, nil); !errors.Is(err, netscape.ErrTooDeep) {
		t.Fatalf("a million levels: %v", err)
	}
	if fs, _ := s.Folders(); len(fs) != 0 {
		t.Errorf("%d folders written", len(fs))
	}
}

// manyLinks is a file of n links at its root, so they all land in Inbox.
func manyLinks(n int) *netscape.Folder {
	root := &netscape.Folder{}
	for i := 0; i < n; i++ {
		root.Links = append(root.Links, netscape.Link{Title: fmt.Sprint(i), URL: fmt.Sprintf("https://example.com/%d", i)})
	}
	return root
}

// Each link used to read the end of its folder with a scan, so an import
// took time with the square of the folder size: 20000 links took over 40 s.
// Importing into a full Inbox must cost about the same as into an empty one.
func TestImportTimeIsLinear(t *testing.T) {
	timeImport := func(s *Store) time.Duration {
		root := manyLinks(500)
		start := time.Now()
		res, err := s.Import(root, nil)
		if err != nil || res.Added != 500 {
			t.Fatalf("import: %+v %v", res, err)
		}
		return time.Since(start)
	}
	empty := timeImport(open(t))
	s := open(t)
	if _, err := s.db.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000)
		INSERT INTO bookmarks (folder_id, title, url, url_key, position, created_at, updated_at)
		SELECT NULL, 'x', 'https://full.example/' || i, 'https://full.example/' || i, i, 1, 1 FROM n`); err != nil {
		t.Fatal(err)
	}
	full := timeImport(s)
	if full > 3*empty+200*time.Millisecond {
		t.Errorf("500 links into a full Inbox took %v, into an empty one %v", full, empty)
	}
}

// Positions count on from the end of the folder, the same however the work
// is cut into batches.
func TestImportPositionsAcrossBatches(t *testing.T) {
	for _, batch := range []time.Duration{time.Hour, 0} {
		old := importBatch
		importBatch = batch
		s := open(t)
		f, _ := s.CreateFolder("Work", nil)
		mustCreate(t, s, "a", "https://example.com/a", &f.ID)
		mustCreate(t, s, "b", "https://example.com/b", &f.ID)
		mustCreate(t, s, "i", "https://example.com/i", nil)
		root := manyLinks(5)
		root.Folders = []*netscape.Folder{{Name: "Work", Links: manyLinks(3).Links}, {Name: "New", Links: manyLinks(2).Links}}
		root.Folders[0].Links = append(root.Folders[0].Links, netscape.Link{URL: "https://example.com/x"})
		res, err := s.Import(root, nil)
		importBatch = old
		if err != nil || res.Added != 6 || res.Skipped != 5 || res.Folders != 1 || len(res.AddedIDs) != 6 {
			t.Fatalf("batch %v: %+v %v", batch, res, err)
		}
		all, _ := s.Bookmarks()
		got := map[string]int64{}
		for _, b := range all {
			got[b.URL] = b.Position
		}
		want := map[string]int64{"https://example.com/a": 0, "https://example.com/b": 1, "https://example.com/i": 0,
			"https://example.com/0": 1, "https://example.com/4": 5, "https://example.com/x": 2}
		for u, p := range want {
			if got[u] != p {
				t.Errorf("batch %v: %s at %d, want %d", batch, u, got[u], p)
			}
		}
		folders, _ := s.Folders()
		if len(folders) != 2 || folders[1].Name != "New" || folders[1].Position != 1 {
			t.Errorf("batch %v: folders %+v", batch, folders)
		}
	}
}

// A save and a sign in made during a long import go in between two batches,
// before the import ends, and do not fail with "database is locked".
func TestWritesDuringImport(t *testing.T) {
	s := open(t)
	done := make(chan error, 1)
	go func() {
		_, err := s.Import(manyLinks(10000), nil)
		done <- err
	}()
	time.Sleep(20 * time.Millisecond)
	if _, _, err := s.Create(NewBookmark{Title: "x", URL: "https://side.example/"}); err != nil {
		t.Errorf("save during import: %v", err)
	}
	if err := s.CreateSession("hash", "", time.Now().Add(time.Hour)); err != nil {
		t.Errorf("sign in during import: %v", err)
	}
	select {
	case <-done:
		t.Error("the writes waited for the whole import")
	default:
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if n, _ := s.CountLive(); n != 10001 {
		t.Errorf("want 10001 bookmarks, got %d", n)
	}
}

// A re-import of links that are all saved already ends its batches by time
// as well, so a write gets in before it ends. Found by the release
// verification of 2026-10-31, where such a re-import held the lock to the
// end.
func TestWritesDuringSkippedImport(t *testing.T) {
	s := open(t)
	file := manyLinks(20000)
	if _, err := s.Import(file, nil); err != nil {
		t.Fatal(err)
	}
	old := importBatch
	importBatch = time.Millisecond
	defer func() { importBatch = old }()
	batches := 0
	var wrote error
	betweenBatches = func() {
		batches++
		if batches == 1 {
			_, _, wrote = s.Create(NewBookmark{Title: "x", URL: "https://side.example/"})
		}
	}
	defer func() { betweenBatches = nil }()
	res, err := s.Import(file, nil)
	if err != nil || res.Added != 0 || res.Skipped != 20000 {
		t.Fatalf("re-import: %+v %v", res, err)
	}
	if batches == 0 || wrote != nil {
		t.Errorf("no write got in during the re-import: %d batches, %v", batches, wrote)
	}
}

// A folder locked between two batches is not written into: the import stops
// and keeps what came in before.
func TestImportStopsWhenFolderLockedMidway(t *testing.T) {
	s := open(t)
	f, _ := s.CreateFolder("Work", nil)
	old := importBatch
	importBatch = 0
	betweenBatches = func() { s.SetLock(f.ID, "hash") }
	defer func() { importBatch, betweenBatches = old, nil }()
	root := &netscape.Folder{Folders: []*netscape.Folder{{Name: "Work", Links: manyLinks(3).Links}}}
	res, err := s.Import(root, nil)
	if !errors.Is(err, ErrImportChanged) || res.Added != 1 || len(res.AddedIDs) != 1 {
		t.Fatalf("import: %+v %v", res, err)
	}
	if n, _ := s.CountLive(); n != 1 {
		t.Errorf("want 1 bookmark, got %d", n)
	}
}

// An address longer than urlkey.MaxLen is refused on save and edit, and
// skipped on import.
func TestLongURLRefused(t *testing.T) {
	s := open(t)
	long := "https://example.com/" + strings.Repeat("a", urlkey.MaxLen)
	if _, _, err := s.Create(NewBookmark{URL: long}); !errors.Is(err, urlkey.ErrTooLong) {
		t.Errorf("create: %v", err)
	}
	b := mustCreate(t, s, "a", "https://example.com/a", nil)
	if _, _, err := s.Update(b.ID, Patch{URL: &long}); !errors.Is(err, urlkey.ErrTooLong) {
		t.Errorf("update: %v", err)
	}
	root := &netscape.Folder{Links: []netscape.Link{{URL: long}, {URL: "https://example.com/b"}}}
	res, err := s.Import(root, nil)
	if err != nil || res.Added != 1 || res.Skipped != 1 {
		t.Errorf("import: %+v %v", res, err)
	}
}

// Sessions from before the session columns keep working and count their
// absolute lifetime from the upgrade.
func TestSessionColumnsMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	oldDB(t, path, 7)
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	exp := time.Now().Add(time.Hour).Unix()
	if _, err := db.Exec(`INSERT INTO sessions (token_hash, expires_at) VALUES ('old', ?)`, exp); err != nil {
		t.Fatal(err)
	}
	db.Close()
	before := time.Now().Unix()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	x, ok := s.Session("old")
	if !ok || x.ExpiresAt != exp || x.CreatedAt < before || x.UsedAt < before || x.Agent != "" || x.ID == 0 {
		t.Errorf("old session after the upgrade: %+v %v", x, ok)
	}
	s.CreateSession("new", "Firefox on macOS", time.Now().Add(time.Hour))
	list, err := s.Sessions()
	if err != nil || len(list) != 2 {
		t.Fatalf("sessions %+v %v", list, err)
	}
	if n, err := s.DeleteOtherSessions("new"); err != nil || n != 1 {
		t.Errorf("delete others: %d %v", n, err)
	}
	cur, _ := s.Session("new")
	if err := s.DeleteSessionByID(cur.ID); err != nil {
		t.Error(err)
	}
	if err := s.DeleteSessionByID(cur.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete: %v", err)
	}
}
