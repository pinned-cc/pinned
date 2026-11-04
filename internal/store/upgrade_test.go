package store

import (
	"compress/gzip"
	"crypto/hmac"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/urlkey"
)

// The databases in testdata/upgrade were written by the released binaries
// v0.1.0 to v0.1.11, one each, not by this code: each binary was built from
// its tag, started on an empty data folder and filled through its own HTTP
// API (nested folders, a locked folder with a subfolder, a hide from Recent
// folder, a share with and one without a password, two API tokens, one used
// from an extension, pinned, opened, moved, renamed and trashed bookmarks,
// an import, icons, a 600 character title and a 9000 byte address), then
// stopped. The JSON next to each database is what that binary answered for
// GET /api/state (with the locked folder unlocked) and GET /api/tokens, plus
// the passwords and tokens the run used. They are test values only: the
// data folder's secret.key was fixtureSecret, so the hashes in these files
// open nothing anywhere else.
//
// Every release from 0.1.0 to 0.1.10 is at schema 6, but 0.1.0 differs from
// the later ones (titles are not cut at 500 characters), and each one is
// kept so a future migration is tested against every database users have.
//
// 0.1.11 is at schema 12: its run differs where 0.1.11 asks for more (a
// folder password of 8 characters or more, the app password again to make
// a token, an address of 8192 bytes at most, so 8000 there), and it keeps
// what 0.1.11 writes (keyed lock and share hashes with their stamps, the
// extension token bound to its origin, the app password as a hash). It also
// holds addresses with white space before the #fragment, whose key 0.1.11
// kept with that space (spec S23.4.7): "spaced", "nbsp", the pair "pair"
// and "pairspaced" for one page, "trashspaced" in Trash and "lockspaced" in
// the locked folder.
const (
	fixtureSecret = "pinned-upgrade-fixture-secret-32"
	upgradeDir    = "testdata/upgrade"
)

type fixtureManifest struct {
	Tag                string            `json:"tag"`
	Password           string            `json:"password"`
	LockPassword       string            `json:"lock_password"`
	SharePassword      string            `json:"share_password"`
	ExtensionOrigin    string            `json:"extension_origin"`
	Folders            map[string]int64  `json:"folders"`
	Bookmarks          map[string]int64  `json:"bookmarks"`
	ShareOpen          string            `json:"share_open"`
	SharePasswordToken string            `json:"share_password_token"`
	Tokens             map[string]string `json:"tokens"`
	TokenList          []struct {
		ID        int64  `json:"id"`
		Name      string `json:"name"`
		CreatedAt int64  `json:"created_at"`
	} `json:"token_list"`
	State struct {
		Folders []struct {
			ID         int64  `json:"id"`
			ParentID   *int64 `json:"parent_id"`
			Name       string `json:"name"`
			Position   int64  `json:"position"`
			HideRecent bool   `json:"hide_recent"`
			Locked     bool   `json:"locked"`
			Share      *struct {
				Token       string `json:"token"`
				HasPassword bool   `json:"has_password"`
				ExpiresAt   *int64 `json:"expires_at"`
			} `json:"share"`
		} `json:"folders"`
		Bookmarks []struct {
			ID             int64   `json:"id"`
			FolderID       *int64  `json:"folder_id"`
			Title          string  `json:"title"`
			URL            string  `json:"url"`
			Position       int64   `json:"position"`
			Pinned         bool    `json:"pinned"`
			PinnedPosition int64   `json:"pinned_position"`
			Icon           *string `json:"icon"`
			Tile           *string `json:"tile"`
			CreatedAt      int64   `json:"created_at"`
			UpdatedAt      int64   `json:"updated_at"`
			OpenedAt       *int64  `json:"opened_at"`
			DeletedAt      *int64  `json:"deleted_at"`
		} `json:"bookmarks"`
		Settings struct {
			LastFolder    *int64  `json:"last_folder"`
			RecentFolders []int64 `json:"recent_folders"`
		} `json:"settings"`
	} `json:"state"`
}

// releasedFixtures returns the tags in testdata/upgrade.
func releasedFixtures(t *testing.T) []string {
	t.Helper()
	m, err := filepath.Glob(filepath.Join(upgradeDir, "*.db.gz"))
	if err != nil {
		t.Fatal(err)
	}
	var tags []string
	for _, p := range m {
		tags = append(tags, strings.TrimSuffix(filepath.Base(p), ".db.gz"))
	}
	sort.Strings(tags)
	if len(tags) != 12 {
		t.Fatalf("want the 12 databases of v0.1.0 to v0.1.11, found %v", tags)
	}
	return tags
}

// fixtureDB writes the database of tag into a new data folder as
// bookmarks.db and returns its path and the manifest.
func fixtureDB(t *testing.T, tag string) (string, fixtureManifest) {
	t.Helper()
	var m fixtureManifest
	raw, err := os.ReadFile(filepath.Join(upgradeDir, tag+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m.Tag != tag {
		t.Fatalf("%s.json is for %s", tag, m.Tag)
	}
	f, err := os.Open(filepath.Join(upgradeDir, tag+".db.gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "bookmarks.db")
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(out, zr); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
	return path, m
}

func samePtr[T comparable](a, b *T) bool {
	return (a == nil) == (b == nil) && (a == nil || *a == *b)
}

// TestReleasedDatabasesUpgrade opens the database of every released version
// with this store and checks that the upgrade keeps a copy and every row.
func TestReleasedDatabasesUpgrade(t *testing.T) {
	for _, tag := range releasedFixtures(t) {
		t.Run(tag, func(t *testing.T) {
			path, m := fixtureDB(t, tag)
			before, _, _ := schemaOf(t, path)
			s, err := Open(path)
			if err != nil {
				t.Fatalf("open the %s database: %v", tag, err)
			}
			defer s.Close()
			if v, _, _ := schemaOf(t, path); v != len(migrations) {
				t.Errorf("schema %d after the upgrade, want %d", v, len(migrations))
			}

			// The copy from before the upgrade is the old database. A
			// database at this schema is no upgrade; TestReleasedKeysSetAgain
			// checks the copy the key pass makes of it.
			copies, err := listBackups(path)
			upgraded := before < len(migrations)
			if upgraded && (err != nil || len(copies) != 1 || copies[0].schema != before) {
				t.Fatalf("want one schema %d copy, got %v (%v)", before, copies, err)
			}
			if upgraded {
				cp := filepath.Join(filepath.Dir(path), copies[0].name)
				var oldVersion, oldRows int
				err = func() error {
					db, err := sql.Open("sqlite", "file:"+cp+"?mode=ro")
					if err != nil {
						return err
					}
					defer db.Close()
					return db.QueryRow(`SELECT (SELECT version FROM schema_version), (SELECT COUNT(*) FROM bookmarks)`).Scan(&oldVersion, &oldRows)
				}()
				if err != nil || oldVersion != before || oldRows != len(m.State.Bookmarks) {
					t.Errorf("copy holds schema %d with %d bookmarks (%v), want %d and %d", oldVersion, oldRows, err, before, len(m.State.Bookmarks))
				}
				if fi, err := os.Stat(cp); err != nil || fi.Mode().Perm() != 0o600 {
					t.Errorf("copy mode %v (%v), want 0600", fi.Mode().Perm(), err)
				}
			}

			// Folders: ids, tree, names, order, Hide from Recent, the lock.
			folders, err := s.Folders()
			if err != nil {
				t.Fatal(err)
			}
			got := map[int64]Folder{}
			for _, f := range folders {
				got[f.ID] = f
			}
			if len(got) != len(m.State.Folders) {
				t.Errorf("%d folders, want %d", len(got), len(m.State.Folders))
			}
			for _, w := range m.State.Folders {
				f, ok := got[w.ID]
				if !ok {
					t.Errorf("folder %d %q is gone", w.ID, w.Name)
					continue
				}
				if !samePtr(f.ParentID, w.ParentID) || f.Name != w.Name || f.Position != w.Position || f.HideRecent != w.HideRecent {
					t.Errorf("folder %d: got %+v, want %+v", w.ID, f, w)
				}
				// The JSON says locked for a folder under a lock too; only
				// the folder that was locked has a lock of its own.
				own := w.ID == m.Folders["private"]
				if (f.LockHash != nil) != own || (own && !w.Locked) {
					t.Errorf("folder %d %q: own lock %v, want %v", w.ID, w.Name, f.LockHash != nil, own)
				}
				// Stamps came in 0.1.11 (migration 11): a lock set by an
				// earlier version has none, one set by 0.1.11 has one.
				if (f.LockStamp != nil) != (own && !upgraded) {
					t.Errorf("folder %d: stamp %v, want one only for a lock set by 0.1.11", w.ID, f.LockStamp != nil)
				}
			}
			private := got[m.Folders["private"]]
			if private.LockHash == nil {
				t.Fatal("the locked folder lost its lock")
			}
			if ok, _ := auth.CheckKeyedPassword([]byte(fixtureSecret), *private.LockHash, m.LockPassword); !ok {
				t.Error("the old folder password no longer opens the lock")
			}

			// Bookmarks: every field as the old version answered it.
			all, err := s.Bookmarks()
			if err != nil {
				t.Fatal(err)
			}
			byID := map[int64]Bookmark{}
			for _, b := range all {
				byID[b.ID] = b
			}
			if len(byID) != len(m.State.Bookmarks) {
				t.Errorf("%d bookmarks, want %d", len(byID), len(m.State.Bookmarks))
			}
			for _, w := range m.State.Bookmarks {
				b, ok := byID[w.ID]
				if !ok {
					t.Errorf("bookmark %d %q is gone", w.ID, w.Title)
					continue
				}
				var icon *string
				if w.Icon != nil {
					name := strings.TrimPrefix(*w.Icon, "/icons/")
					icon = &name
				}
				if !samePtr(b.FolderID, w.FolderID) || b.Title != w.Title || b.URL != w.URL || b.Position != w.Position ||
					b.Pinned != w.Pinned || b.PinnedPosition != w.PinnedPosition || !samePtr(b.Icon, icon) ||
					!samePtr(b.Tile, w.Tile) || b.CreatedAt != w.CreatedAt || b.UpdatedAt != w.UpdatedAt ||
					!samePtr(b.OpenedAt, w.OpenedAt) || !samePtr(b.DeletedAt, w.DeletedAt) {
					t.Errorf("bookmark %d %.40q changed in the upgrade", w.ID, w.Title)
				}
			}
			if tag == "v0.1.0" {
				long := 0
				for _, b := range all {
					long = max(long, len([]rune(b.Title)))
				}
				if long != 600 {
					t.Errorf("0.1.0 kept a 600 character title, longest now %d", long)
				}
			}

			// Shares, with the password and expiry they had.
			shares, err := s.Shares()
			if err != nil {
				t.Fatal(err)
			}
			byToken := map[string]Share{}
			for _, sh := range shares {
				byToken[sh.Token] = sh
			}
			for _, w := range m.State.Folders {
				if w.Share == nil {
					continue
				}
				sh, ok := byToken[w.Share.Token]
				if !ok || sh.FolderID != w.ID || (sh.PasswordHash != nil) != w.Share.HasPassword || !samePtr(sh.ExpiresAt, w.Share.ExpiresAt) {
					t.Errorf("share of folder %d: got %+v (found %v), want %+v", w.ID, sh, ok, *w.Share)
				}
				if (sh.PasswordStamp != nil) != (w.Share.HasPassword && !upgraded) {
					t.Errorf("share of folder %d: stamp %v, want one only for a password set by 0.1.11", w.ID, sh.PasswordStamp != nil)
				}
			}
			if len(byToken) != 2 {
				t.Errorf("%d shares, want 2", len(byToken))
			}
			if sh, err := s.ActiveShare(m.ShareOpen); err != nil || sh.PasswordHash != nil {
				t.Errorf("the open share: %+v, %v", sh, err)
			}
			sh, err := s.ActiveShare(m.SharePasswordToken)
			if err != nil || sh.PasswordHash == nil {
				t.Fatalf("the share with a password: %+v, %v", sh, err)
			}
			if ok, _ := auth.CheckKeyedPassword([]byte(fixtureSecret), *sh.PasswordHash, m.SharePassword); !ok {
				t.Error("the old share password no longer opens the share")
			}

			// API tokens, each found by the hash of its value. Before 0.1.11
			// none is bound to an origin: 0.1.11 binds at the first use from
			// an extension, which its own run made with "Brave extension".
			tokens, err := s.Tokens()
			if err != nil {
				t.Fatal(err)
			}
			if len(tokens) != len(m.TokenList) {
				t.Errorf("%d tokens, want %d", len(tokens), len(m.TokenList))
			}
			for name, value := range m.Tokens {
				tk, err := s.TokenByHash(auth.HashToken([]byte(fixtureSecret), value))
				bound := !upgraded && name == "Brave extension"
				if err != nil || tk.Name != name || (tk.Origin != nil) != bound || (bound && *tk.Origin != m.ExtensionOrigin) {
					t.Errorf("token %q: %+v, %v", name, tk, err)
				}
			}
			for _, w := range m.TokenList {
				found := false
				for _, tk := range tokens {
					found = found || (tk.ID == w.ID && tk.Name == w.Name && tk.CreatedAt == w.CreatedAt)
				}
				if !found {
					t.Errorf("token %d %q is gone", w.ID, w.Name)
				}
			}

			// Sessions from before count from the upgrade.
			sessions, err := s.Sessions()
			if err != nil {
				t.Fatal(err)
			}
			if len(sessions) == 0 {
				t.Error("the logins of the old version were dropped")
			}
			for _, se := range sessions {
				if se.CreatedAt == 0 || se.UsedAt == 0 {
					t.Errorf("session %d has no start after the upgrade: %+v", se.ID, se)
				}
			}

			st, err := s.Settings()
			if err != nil {
				t.Fatal(err)
			}
			if !samePtr(st.LastFolder, m.State.Settings.LastFolder) || !equalIDs(st.RecentFolders, m.State.Settings.RecentFolders) {
				t.Errorf("settings %+v, want %+v", st, m.State.Settings)
			}

			// A second open is no upgrade and writes no second copy.
			s.Close()
			s, err = Open(path)
			if err != nil {
				t.Fatal(err)
			}
			if again, _ := listBackups(path); len(again) != len(copies) {
				t.Errorf("a second start wrote another copy: %v", again)
			}
		})
	}
}

func equalIDs(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// legacyCheck is the check cmd/pinned passes to SyncPassword: the HMAC
// record of 0.1.10 and before, or the bcrypt hash of 0.1.11.
func legacyCheck(password string) func(stored string, legacy bool) (bool, bool) {
	return func(stored string, legacy bool) (bool, bool) {
		if legacy {
			return hmac.Equal([]byte(stored), []byte(auth.PasswordFingerprint([]byte(fixtureSecret), password))), true
		}
		return auth.CheckAppPassword(stored, password)
	}
}

// TestReleasedDatabasesKeepThePassword checks the app password record each
// released version wrote: the same password moves it to a hash and keeps
// every token and login, another password ends them all.
func TestReleasedDatabasesKeepThePassword(t *testing.T) {
	cheap := func() (string, error) { return "hash-of-the-test-password", nil }
	for _, tag := range releasedFixtures(t) {
		t.Run(tag, func(t *testing.T) {
			for _, tc := range []struct {
				name    string
				same    bool
				changed bool
			}{{"same password", true, false}, {"new password", false, true}} {
				path, m := fixtureDB(t, tag)
				s, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				pw := m.Password
				if !tc.same {
					pw = "another-password-Zt5q"
				}
				// 0.1.0 to 0.1.10 kept an HMAC record, 0.1.11 the hash.
				var legacy, stored string
				hasLegacy := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, legacyPasswordSetting).Scan(&legacy) == nil
				s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, passwordSetting).Scan(&stored)
				if hasLegacy == (tag == "v0.1.11") || (!hasLegacy && !strings.HasPrefix(stored, "$2")) {
					t.Fatalf("%s: legacy record %v, hash %.4q; want the record of %s", tc.name, hasLegacy, stored, tag)
				}
				changed, err := s.SyncPassword(legacyCheck(pw), cheap)
				if err != nil || changed != tc.changed {
					t.Fatalf("%s: changed=%v err=%v, want changed=%v", tc.name, changed, err, tc.changed)
				}
				var n int
				s.db.QueryRow(`SELECT COUNT(*) FROM settings WHERE key = ?`, legacyPasswordSetting).Scan(&n)
				var h string
				s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, passwordSetting).Scan(&h)
				want := "hash-of-the-test-password"
				if !hasLegacy && tc.same {
					want = stored // the same password keeps 0.1.11's hash
				}
				if n != 0 || h != want {
					t.Errorf("%s: legacy rows %d, hash %.12q; want %.12q", tc.name, n, h, want)
				}
				tokens, _ := s.Tokens()
				sessions, _ := s.Sessions()
				if tc.same && (len(tokens) != len(m.TokenList) || len(sessions) == 0) {
					t.Errorf("%s: %d tokens and %d sessions left, want all kept", tc.name, len(tokens), len(sessions))
				}
				if !tc.same && (len(tokens) != 0 || len(sessions) != 0) {
					t.Errorf("%s: %d tokens and %d sessions left, want none", tc.name, len(tokens), len(sessions))
				}
				s.Close()
			}
		})
	}
}

// TestReleasedKeysSetAgain opens the 0.1.11 database, whose rows with white
// space before the #fragment carry the key 0.1.11 made, and checks that the
// first start sets every key again (spec S23.4.7), after a copy, without
// losing or merging a bookmark, and that the next start changes nothing.
func TestReleasedKeysSetAgain(t *testing.T) {
	path, m := fixtureDB(t, "v0.1.11")
	id := func(name string) int64 {
		t.Helper()
		v, ok := m.Bookmarks[name]
		if !ok {
			t.Fatalf("the manifest names no bookmark %q", name)
		}
		return v
	}
	stale := map[int64]string{}
	func() {
		db, err := sql.Open("sqlite", "file:"+path)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		for _, name := range []string{"spaced", "nbsp", "pairspaced", "trashspaced", "lockspaced"} {
			var key string
			if err := db.QueryRow(`SELECT url_key FROM bookmarks WHERE id = ?`, id(name)).Scan(&key); err != nil {
				t.Fatal(err)
			}
			if k, _ := urlkey.Key(key); k == key {
				t.Fatalf("%s: 0.1.11 stored the key %q, which is the key of today", name, key)
			}
			stale[id(name)] = key
		}
		// A given up icon fetch on the spaced row keeps its count.
		if _, err := db.Exec(`INSERT INTO icon_failures (bookmark_id, url_key, count) VALUES (?, ?, ?)`, id("spaced"), stale[id("spaced")], IconGiveUp); err != nil {
			t.Fatal(err)
		}
	}()

	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if v, _, _ := schemaOf(t, path); v != 12 {
		t.Errorf("schema %d, want 12: 0.1.11 must still open it", v)
	}
	copies, err := listBackups(path)
	if err != nil || len(copies) != 1 || copies[0].schema != 12 {
		t.Fatalf("want one schema 12 copy before the keys changed, got %v (%v)", copies, err)
	}
	func() {
		db, err := sql.Open("sqlite", "file:"+filepath.Join(filepath.Dir(path), copies[0].name)+"?mode=ro")
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		for bid, key := range stale {
			var got string
			if err := db.QueryRow(`SELECT url_key FROM bookmarks WHERE id = ?`, bid).Scan(&got); err != nil || got != key {
				t.Errorf("copy: bookmark %d key %q (%v), want the old %q", bid, got, err, key)
			}
		}
	}()

	all, err := s.Bookmarks()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != len(m.State.Bookmarks) {
		t.Errorf("%d bookmarks, want %d: none is merged or deleted", len(all), len(m.State.Bookmarks))
	}
	for _, b := range all {
		if k, err := urlkey.Key(b.URL); err != nil || k != b.URLKey {
			t.Errorf("bookmark %d %q: key %q, want %q (%v)", b.ID, b.URL, b.URLKey, k, err)
		}
	}
	given, err := s.IconsGivenUp()
	if err != nil || given[id("spaced")] != "http://127.0.0.1:13/a" {
		t.Errorf("icon failure of the spaced row: %q (%v), want it moved to the new key", given[id("spaced")], err)
	}

	locked := Hidden{m.Folders["private"]: true, m.Folders["inner"]: true}
	// One page, one bookmark: either spelling finds the row 0.1.11 saved.
	for _, raw := range []string{"http://127.0.0.1:13/a", "http://127.0.0.1:13/a #top", "http://127.0.0.1:13/a#other"} {
		if b, err := s.FindLive(raw, locked); err != nil || b.ID != id("spaced") {
			t.Errorf("check %q: %d, %v; want bookmark %d", raw, b.ID, err, id("spaced"))
		}
		var dup *DuplicateError
		if _, _, err := s.Create(NewBookmark{URL: raw, Hidden: locked}); !errors.As(err, &dup) || dup.Existing.ID != id("spaced") {
			t.Errorf("save %q: %v, want Already saved with bookmark %d", raw, err, id("spaced"))
		}
	}
	if b, err := s.FindLive("http://127.0.0.1:13/n", locked); err != nil || b.ID != id("nbsp") {
		t.Errorf("no break space row: %d, %v", b.ID, err)
	}
	// The pair 0.1.11 kept as two bookmarks: both kept, the older answers,
	// a Force save updates the older, an edit of the newer keeps its address.
	if b, err := s.FindLive("http://127.0.0.1:14/b #y", locked); err != nil || b.ID != id("pair") {
		t.Errorf("pair: found %d, %v; want the older %d", b.ID, err, id("pair"))
	}
	if b, created, err := s.Create(NewBookmark{URL: "http://127.0.0.1:14/b", Title: "Forced", Force: true, Hidden: locked}); err != nil || created || b.ID != id("pair") {
		t.Errorf("Force save of the pair: %d created=%v %v", b.ID, created, err)
	}
	same := "http://127.0.0.1:14/b #x"
	title := "Pair, edited"
	if b, changed, err := s.Update(id("pairspaced"), Patch{Title: &title, URL: &same, Hidden: locked}); err != nil || changed || b.Title != title {
		t.Errorf("edit of the newer of the pair: %+v changed=%v %v", b, changed, err)
	}
	for _, name := range []string{"pair", "pairspaced"} {
		if b, err := s.Bookmark(id(name)); err != nil || b.DeletedAt != nil {
			t.Errorf("%s: %+v, %v; want it kept and live", name, b, err)
		}
	}
	// In Trash: re-keyed and restorable; in the locked folder: hidden while
	// locked, found when unlocked.
	if err := s.Restore(id("trashspaced"), locked); err != nil {
		t.Errorf("restore: %v", err)
	}
	if _, err := s.FindLive("http://127.0.0.1:16/l", locked); !errors.Is(err, ErrNotFound) {
		t.Errorf("locked row found while locked: %v", err)
	}
	if b, err := s.FindLive("http://127.0.0.1:16/l", nil); err != nil || b.ID != id("lockspaced") {
		t.Errorf("locked row when unlocked: %d, %v", b.ID, err)
	}

	// The next start finds nothing to change and writes no copy.
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if again, _ := listBackups(path); len(again) != 1 {
		t.Errorf("a second start wrote another copy: %v", again)
	}
}
