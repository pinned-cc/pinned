package store

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// oldDB writes a database at schema version with one folder in it.
func oldDB(t *testing.T, path string, version int) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE schema_version (version INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	for _, m := range migrations[:version] {
		if _, err := db.Exec(m); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (?)`, version); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO folders (name, position, created_at) VALUES ('NAS', 0, 1)`); err != nil {
		t.Fatal(err)
	}
}

func schemaOf(t *testing.T, path string) (version int, hasIconFailures bool, folders int) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.QueryRow(`SELECT version FROM schema_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	var n int
	db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name = 'icon_failures'`).Scan(&n)
	db.QueryRow(`SELECT count(*) FROM folders`).Scan(&folders)
	return version, n == 1, folders
}

func backups(t *testing.T, dir string) []string {
	t.Helper()
	m, err := filepath.Glob(filepath.Join(dir, "bookmarks-schema*-*.db"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(m)
	return m
}

// An upgrade first writes a copy of the database as it was, named with the
// old schema and the date, then migrates.
func TestBackupBeforeMigrate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bookmarks.db")
	old := len(migrations) - 1
	oldDB(t, path, old)
	backupTime = func() time.Time { return time.Date(2026, 10, 30, 15, 42, 10, 0, time.UTC) }
	t.Cleanup(func() { backupTime = time.Now })

	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()

	got := backups(t, dir)
	want := filepath.Join(dir, "bookmarks-schema6-2026-10-30-154210.db")
	if old != 6 {
		t.Fatalf("test assumes schema 6 before the last migration, got %d", old)
	}
	if len(got) != 1 || got[0] != want {
		t.Fatalf("backups %v, want %s", got, want)
	}
	if v, icons, folders := schemaOf(t, want); v != old || icons || folders != 1 {
		t.Errorf("backup holds schema %d, icon_failures %v, %d folders; want the database before the upgrade", v, icons, folders)
	}
	if fi, _ := os.Stat(want); fi.Mode().Perm() != 0o600 {
		t.Errorf("backup mode %v", fi.Mode().Perm())
	}
	if v, icons, folders := schemaOf(t, path); v != len(migrations) || !icons || folders != 1 {
		t.Errorf("database after upgrade: schema %d, icon_failures %v, %d folders", v, icons, folders)
	}

	// Opening again with nothing to migrate writes no new copy.
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	if n := len(backups(t, dir)); n != 1 {
		t.Errorf("%d backups after an open without upgrade", n)
	}
}

// A new database has nothing to keep.
func TestNoBackupForNewDatabase(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "bookmarks.db"))
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	if b := backups(t, dir); len(b) != 0 {
		t.Errorf("backups of a new database: %v", b)
	}
}

// Only the newest KeepBackups copies stay; other files are left alone.
func TestBackupRotationKeepsThree(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bookmarks.db")
	oldDB(t, path, len(migrations)-1)
	backupTime = func() time.Time { return time.Date(2026, 10, 30, 15, 42, 10, 0, time.UTC) }
	t.Cleanup(func() { backupTime = time.Now })
	keep := map[string]bool{
		"bookmarks-schema5-2026-10-01-120000.db": false,
		"bookmarks-schema5-2026-10-12-120000.db": true,
		"bookmarks-schema4-2026-09-01-120000.db": false,
		"bookmarks-schema6-2026-10-20-080000.db": true,
		"bookmarks.db.bak":                       true, // not ours
		"other-schema1-2026-01-01-000000.db":     true, // not ours
	}
	for name := range keep {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		// Rotation goes by modification time; give each the time in its name.
		if len(name) < 20 {
			continue
		}
		if when, err := time.Parse("2006-01-02-150405", strings.TrimSuffix(name[len(name)-20:], ".db")); err == nil {
			os.Chtimes(filepath.Join(dir, name), when, when)
		}
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	for name, kept := range keep {
		if _, err := os.Stat(filepath.Join(dir, name)); (err == nil) != kept {
			t.Errorf("%s: kept %v, want %v", name, err == nil, kept)
		}
	}
	if n := len(backups(t, dir)); n != KeepBackups {
		t.Errorf("%d backups, want %d: %v", n, KeepBackups, backups(t, dir))
	}
}

// When the copy fails, nothing is migrated and Open says why.
func TestBackupFailureBlocksMigration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bookmarks.db")
	old := len(migrations) - 1
	oldDB(t, path, old)
	backupPath = func(string, int, time.Time) string { return filepath.Join(dir, "missing", "copy.db") }
	t.Cleanup(func() { backupPath = defaultBackupPath })

	s, err := Open(path)
	if err == nil {
		s.Close()
		t.Fatal("opened although the backup failed")
	}
	var be *BackupError
	if !errors.As(err, &be) || be.Version != old {
		t.Fatalf("error %v, want a BackupError for schema %d", err, old)
	}
	if v, icons, folders := schemaOf(t, path); v != old || icons || folders != 1 {
		t.Errorf("database changed although the backup failed: schema %d, icon_failures %v, %d folders", v, icons, folders)
	}
	if _, err := os.Stat(filepath.Join(dir, "missing")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("backup folder created: %v", err)
	}
}

// A wrong clock never removes the copy just written: with the clock at
// 1970 it is the oldest by name and by time, and it is still kept.
func TestBackupKeptWhenClockIsBehind(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bookmarks.db")
	oldDB(t, path, len(migrations)-1)
	for _, name := range []string{
		"bookmarks-schema6-2026-10-01-120000.db",
		"bookmarks-schema6-2026-10-02-120000.db",
		"bookmarks-schema6-2026-10-03-120000.db",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		// Older than the database, so none of them stands for it.
		long := time.Now().Add(-24 * time.Hour)
		os.Chtimes(filepath.Join(dir, name), long, long)
	}
	backupTime = func() time.Time { return time.Unix(0, 0).UTC() }
	t.Cleanup(func() { backupTime = time.Now })
	// The file system clock is behind too.
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	fresh := filepath.Join(dir, "bookmarks-schema6-1970-01-01-000000.db")
	os.Chtimes(fresh, time.Unix(0, 0), time.Unix(0, 0))
	pruneBackups(path, filepath.Base(fresh))
	if v, _, folders := schemaOf(t, fresh); v != len(migrations)-1 || folders != 1 {
		t.Errorf("fresh copy: schema %d, %d folders", v, folders)
	}
	if n := len(backups(t, dir)); n != KeepBackups {
		t.Errorf("%d backups, want %d", n, KeepBackups)
	}
}

// When an upgrade fails and Pinned starts again, the database is still as
// in the copy of the first start: that copy is used, no new one is written,
// and older copies are not pushed out by a crash loop.
func TestFailedUpgradeReusesItsCopy(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bookmarks.db")
	old := len(migrations)
	oldDB(t, path, old)
	keepOld := filepath.Join(dir, "bookmarks-schema5-2026-01-01-120000.db")
	if err := os.WriteFile(keepOld, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	when := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	os.Chtimes(keepOld, when, when)
	orig := migrations
	migrations = append(append([]string{}, orig...), `THIS IS NOT SQL`)
	t.Cleanup(func() { migrations = orig })

	for i := 0; i < 5; i++ {
		backupTime = func() time.Time { return time.Date(2026, 10, 30, 15, 0, i, 0, time.UTC) }
		if s, err := Open(path); err == nil {
			s.Close()
			t.Fatal("a broken migration opened")
		}
	}
	backupTime = time.Now
	got := backups(t, dir)
	if len(got) != 2 || got[0] != keepOld {
		t.Errorf("backups after 5 failed starts: %v, want the old one and one new", got)
	}
	if v, _, _ := schemaOf(t, path); v != old {
		t.Errorf("database at schema %d, want %d", v, old)
	}
}
