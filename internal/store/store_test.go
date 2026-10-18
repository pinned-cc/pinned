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
	if err := s.Restore(b.ID); !errors.As(err, &dup) {
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
		res, err := s.Import(root)
		if err != nil {
			t.Fatal(err)
		}
		again, err := s.Import(root)
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

	if _, err := s.Bulk([]int64{a.ID, b.ID}, "move", &f.ID); err != nil {
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
	s.Bulk([]int64{a.ID, b.ID, c.ID}, "pin", nil)
	s.OrderPinned([]int64{c.ID, a.ID, b.ID})
	gc, _ := s.Bookmark(c.ID)
	if !gc.Pinned || gc.PinnedPosition != 0 {
		t.Errorf("pin order: %+v", gc)
	}
	s.Bulk([]int64{c.ID}, "trash", nil)
	s.Bulk([]int64{c.ID}, "restore", nil)
	if gc, _ = s.Bookmark(c.ID); gc.DeletedAt != nil {
		t.Error("restore failed")
	}
	// Delete skips bookmarks that are not in Trash.
	if _, err := s.Bulk([]int64{a.ID, c.ID}, "delete", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Bookmark(c.ID); err != nil {
		t.Errorf("live bookmark deleted without Trash: %v", err)
	}
	s.Bulk([]int64{c.ID}, "trash", nil)
	if _, err := s.Bulk([]int64{a.ID, c.ID}, "delete", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Bookmark(c.ID); !errors.Is(err, ErrNotFound) {
		t.Error("delete from Trash failed")
	}
	if ga, err := s.Bookmark(a.ID); err != nil || ga.DeletedAt != nil {
		t.Errorf("live bookmark touched by delete: %+v %v", ga, err)
	}
	if _, err := s.Bulk([]int64{a.ID}, "explode", nil); err == nil {
		t.Error("unknown action accepted")
	}
}

func TestSessions(t *testing.T) {
	s := open(t)
	s.CreateSession("h1", time.Now().Add(time.Hour))
	s.CreateSession("h2", time.Now().Add(-time.Hour))
	if !s.SessionValid("h1") || s.SessionValid("h2") || s.SessionValid("nope") {
		t.Error("session validity wrong")
	}
	s.DeleteSession("h1")
	if s.SessionValid("h1") {
		t.Error("deleted session still valid")
	}
}

func TestPasswordFingerprintSignsOutSessions(t *testing.T) {
	s := open(t)
	s.CreateSession("old", time.Now().Add(time.Hour))
	if changed, err := s.SyncPasswordFingerprint("fp1"); err != nil || changed {
		t.Fatalf("first start: changed=%v err=%v", changed, err)
	}
	if !s.SessionValid("old") {
		t.Error("first start must keep sessions")
	}
	tok, _ := s.CreateToken("phone", "tokenhash")
	if changed, _ := s.SyncPasswordFingerprint("fp1"); changed || !s.SessionValid("old") {
		t.Error("same password signed out")
	}
	if changed, _ := s.SyncPasswordFingerprint("fp2"); !changed {
		t.Error("new password not noticed")
	}
	if s.SessionValid("old") {
		t.Error("session survived a password change")
	}
	if got, err := s.TokenByHash("tokenhash"); err != nil || got.ID != tok.ID {
		t.Error("tokens must stay")
	}
	if st, _ := s.Settings(); st.LastFolder != nil {
		t.Error("fingerprint leaked into settings")
	}
}

func TestExtendSession(t *testing.T) {
	s := open(t)
	s.CreateSession("h", time.Now().Add(time.Hour))
	later := time.Now().Add(48 * time.Hour).Truncate(time.Second)
	if err := s.ExtendSession("h", later); err != nil {
		t.Fatal(err)
	}
	if exp, ok := s.SessionExpiry("h"); !ok || !exp.Equal(later) {
		t.Errorf("expiry %v %v", exp, ok)
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
	for i := 0; i < 10000; i++ {
		sub := &netscape.Folder{Name: "n"}
		f.Folders = append(f.Folders, sub)
		f = sub
	}
	f.Links = []netscape.Link{{Title: "bottom", URL: "https://example.com/bottom"}}
	res, err := s.Import(root)
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
	res, err := s.Import(root)
	if err != nil || res.Folders != 1 || res.Added != 1 {
		t.Fatalf("import: %+v %v", res, err)
	}
	b, _ := s.FindLive("https://example.com/x")
	f, _ := s.Folder(*b.FolderID)
	if f.ID == work.ID || f.Name != "Work (imported)" || f.ParentID != nil {
		t.Errorf("landed in %+v", f)
	}
	// "Work (imported)" locked too: the next one gets another suffix.
	s.SetLock(f.ID, "hash")
	root.Folders[0].Links[0].URL = "https://example.com/y"
	s.Import(root)
	b, _ = s.FindLive("https://example.com/y")
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
	old := len(migrations) - 1
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
}
