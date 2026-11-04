// Package store keeps folders, bookmarks, settings and sessions in one
// SQLite file.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/pinned-cc/pinned/internal/urlkey"
	_ "modernc.org/sqlite"
)

var (
	ErrNotFound = errors.New("not found")
	ErrNoFolder = errors.New("folder does not exist")
	ErrCycle    = errors.New("a folder cannot move into itself or one of its subfolders")

	ErrEmptyName     = errors.New("name cannot be empty")
	ErrEmptyTitle    = errors.New("title cannot be empty")
	ErrUnknownAction = errors.New("unknown action")
	ErrShareExists   = errors.New("this folder is already shared")
	ErrTooDeep       = fmt.Errorf("folders can nest at most %d deep", MaxDepth)
)

// MaxDepth is how deep folders can nest. Top level folders are depth 1.
const MaxDepth = 32

// Longer bookmark titles and folder names are cut to these lengths, in
// characters.
const (
	MaxTitle      = 500
	MaxFolderName = 200
)

// clip trims s and cuts it to at most n characters.
func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > n {
		s = strings.TrimSpace(string([]rune(s)[:n]))
	}
	return s
}

// DuplicateError is returned when a live bookmark the caller can see
// already has the same url_key.
type DuplicateError struct{ Existing Bookmark }

func (e *DuplicateError) Error() string { return "already saved" }

// Store wraps the database.
type Store struct {
	db *sql.DB
	// wmu is held by every write. Waiting writers queue on it in turn
	// (Go hands a mutex to a waiter that has waited over a millisecond),
	// so a long import that commits in batches lets them in between
	// batches, where SQLite's busy wait could miss the short gap.
	wmu sync.Mutex
	// writes counts the writes made under wmu other than an import's own,
	// so an import knows whether what it read in the last batch still holds.
	writes uint64
	// Now returns the current time. Tests replace it.
	Now func() time.Time
}

// Open opens (and creates or migrates) the database at path. Before it
// upgrades an existing database to a newer schema, it writes a copy of it
// next to path (see backupPath) and keeps the last KeepBackups of them. If
// that copy fails, the database is left as it was and Open fails.
func Open(path string) (*Store, error) {
	// WAL lets reads run while one write is open. Every transaction takes
	// the write lock when it begins (_txlock=immediate), so two writers wait
	// for each other through busy_timeout instead of failing halfway.
	dsn := "file:" + path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// A small pool: a long import no longer blocks /health and the reads
	// of the app, and SQLite still allows one writer at a time.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	s := &Store{db: db, Now: time.Now}
	copied, err := s.migrate(path)
	if err == nil {
		err = s.rekey(path, copied)
	}
	if err != nil {
		db.Close()
		var newer *NewerSchemaError
		var backup *BackupError
		if errors.As(err, &newer) || errors.As(err, &backup) {
			return nil, err
		}
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) now() int64 { return s.Now().Unix() }

// migrations run in order; each one runs once. Never edit a shipped entry,
// add a new one at the end.
var migrations = []string{
	`CREATE TABLE folders (
		id INTEGER PRIMARY KEY,
		parent_id INTEGER NULL REFERENCES folders(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		position INTEGER NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX folders_parent ON folders(parent_id);
	CREATE TABLE bookmarks (
		id INTEGER PRIMARY KEY,
		folder_id INTEGER NULL REFERENCES folders(id) ON DELETE SET NULL,
		title TEXT NOT NULL,
		url TEXT NOT NULL,
		url_key TEXT NOT NULL,
		position INTEGER NOT NULL,
		pinned INTEGER NOT NULL DEFAULT 0,
		pinned_position INTEGER NOT NULL DEFAULT 0,
		icon TEXT NULL,
		tile TEXT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		opened_at INTEGER NULL,
		deleted_at INTEGER NULL
	);
	CREATE UNIQUE INDEX bookmarks_live_key ON bookmarks(url_key) WHERE deleted_at IS NULL;
	CREATE INDEX bookmarks_folder ON bookmarks(folder_id);
	CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
	CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`,

	`CREATE TABLE shares (
		id INTEGER PRIMARY KEY,
		folder_id INTEGER NOT NULL UNIQUE REFERENCES folders(id) ON DELETE CASCADE,
		token TEXT NOT NULL UNIQUE,
		password_hash TEXT NULL,
		expires_at INTEGER NULL,
		created_at INTEGER NOT NULL,
		opens INTEGER NOT NULL DEFAULT 0,
		last_opened_at INTEGER NULL
	);`,

	`ALTER TABLE folders ADD COLUMN lock_hash TEXT NULL;`,

	`CREATE TABLE tokens (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		hash TEXT NOT NULL UNIQUE,
		created_at INTEGER NOT NULL,
		last_used_at INTEGER NULL
	);`,

	// Indexes for the queries the live partial index does not serve:
	// IconsForOrigin (url_key range, Trash included), iconInUse, the Trash
	// purge, the pinned dock and the session purge.
	`CREATE INDEX bookmarks_url_key ON bookmarks(url_key);
	CREATE INDEX bookmarks_icon ON bookmarks(icon) WHERE icon IS NOT NULL;
	CREATE INDEX bookmarks_deleted ON bookmarks(deleted_at) WHERE deleted_at IS NOT NULL;
	CREATE INDEX bookmarks_pinned ON bookmarks(pinned_position) WHERE pinned = 1;
	CREATE INDEX sessions_expires ON sessions(expires_at);`,

	// Hide from Recent, per folder; subfolders inherit it.
	`ALTER TABLE folders ADD COLUMN hide_recent INTEGER NOT NULL DEFAULT 0;`,

	// Failed icon fetches per bookmark, so a link whose icon never loads is
	// not fetched again at every start. url_key is the address that failed.
	`CREATE TABLE icon_failures (
		bookmark_id INTEGER PRIMARY KEY REFERENCES bookmarks(id) ON DELETE CASCADE,
		url_key TEXT NOT NULL,
		count INTEGER NOT NULL
	);`,

	// The next position in a folder (MAX(position) of its live bookmarks)
	// is read from this index instead of scanning the folder, so saving,
	// moving and importing into a full folder stay quick.
	`CREATE INDEX bookmarks_folder_position ON bookmarks(folder_id, position) WHERE deleted_at IS NULL;`,
	// Sessions remember when they started (for the absolute lifetime),
	// when they were last used and a short browser name, for the list of
	// signed in browsers. Sessions from before count from the upgrade.
	`ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE sessions ADD COLUMN used_at INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE sessions ADD COLUMN agent TEXT NOT NULL DEFAULT '';
	UPDATE sessions SET created_at = CAST(strftime('%s', 'now') AS INTEGER), used_at = CAST(strftime('%s', 'now') AS INTEGER);`,
	// The browser extension origin a token is bound to at its first use
	// from an extension, so another extension cannot use it with CORS.
	`ALTER TABLE tokens ADD COLUMN origin TEXT NULL;`,
	// A random stamp made whenever a folder or share password is set, kept
	// when its hash is only replaced by a stronger hash of the same
	// password. Unlock cookies sign the stamp, so a rehash leaves them
	// working. Rows from before have none and sign the hash as before.
	`ALTER TABLE folders ADD COLUMN lock_stamp TEXT NULL;
	ALTER TABLE shares ADD COLUMN password_stamp TEXT NULL;`,
	// Live bookmarks are unique by url_key only among those one caller can
	// see (see Hidden), so a save cannot tell an address sits in a locked
	// folder. The code checks it inside the write transaction;
	// bookmarks_url_key still serves the lookups.
	`DROP INDEX bookmarks_live_key;`,
}

// NewerSchemaError means the database was written by a later version. That
// version may have changed tables this one would misread, so it does not
// start at all.
// Backup names the newest copy in the data folder taken before an upgrade
// from this version's schema, the one to go back to, or is empty.
type NewerSchemaError struct {
	Have, Know int
	Backup     string
}

func (e *NewerSchemaError) Error() string {
	msg := fmt.Sprintf("database was written by a newer Pinned (schema %d); this version knows %d. Update the image", e.Have, e.Know)
	if e.Backup == "" {
		return msg + " or restore a backup."
	}
	return msg + ", or to stay on this version restore " + e.Backup + " from the data folder as bookmarks.db. That copy is the state before the upgrade: links saved since are missing, and folders locked, passwords changed, share links and API tokens revoked and sessions ended since are back as they were, so lock and revoke them again, or change APP_PASSWORD to end every token and session (README, Going back to an older version)."
}

// newestBackup returns the file name of the newest upgrade copy of schema
// next to the database at dbPath, or "".
func newestBackup(dbPath string, schema int) string {
	all, err := listBackups(dbPath)
	if err != nil {
		return ""
	}
	best := backupFile{}
	for _, b := range all {
		if b.schema == schema && (best.name == "" || b.name > best.name) {
			best = b
		}
	}
	return best.name
}

// BackupError means the copy taken before a schema upgrade failed, so the
// upgrade did not run and the database is unchanged.
type BackupError struct {
	Version int
	Err     error
}

func (e *BackupError) Error() string {
	return fmt.Sprintf("could not back up the database before upgrading it from schema %d, so it was not upgraded and is unchanged: %v. Check free space and that the data folder is writable.", e.Version, e.Err)
}

func (e *BackupError) Unwrap() error { return e.Err }

// migrate runs the migrations the database lacks. copied reports whether
// it wrote a copy of the database first, or the database is new: either way
// nothing from before this start needs another copy.
func (s *Store) migrate(path string) (copied bool, err error) {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return false, err
	}
	var version int
	err = s.db.QueryRow(`SELECT version FROM schema_version`).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := s.db.Exec(`INSERT INTO schema_version (version) VALUES (0)`); err != nil {
			return false, err
		}
	} else if err != nil {
		return false, err
	}
	if version > len(migrations) {
		return false, &NewerSchemaError{Have: version, Know: len(migrations), Backup: newestBackup(path, len(migrations))}
	}
	// A new database (version 0) has nothing to keep.
	if version > 0 && version < len(migrations) {
		dst, err := backupBeforeMigrate(s.db, path, version)
		if err != nil {
			return false, &BackupError{Version: version, Err: err}
		}
		log.Printf("database: upgrading from schema %d to %d; the database as it was is saved at %s", version, len(migrations), dst)
	}
	for i := version; i < len(migrations); i++ {
		tx, err := s.db.Begin()
		if err != nil {
			return false, err
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			tx.Rollback()
			return false, fmt.Errorf("migration %d: %w", i+1, err)
		}
		if _, err := tx.Exec(`UPDATE schema_version SET version = ?`, i+1); err != nil {
			tx.Rollback()
			return false, err
		}
		if err := tx.Commit(); err != nil {
			return false, err
		}
	}
	return version < len(migrations), nil
}

// rekey sets url_key to urlkey.Key(url) on every bookmark, live or in Trash,
// whose stored key differs: keys saved under an older rule, such as the
// white space before a #fragment that 0.1.11 kept (spec S23.4.7). There is
// no unique index on url_key (migration 12), so rows that end up with one
// key are all kept and the oldest answers for the address (liveByKey); no
// bookmark is deleted or merged. Before it writes, it copies the database
// as an upgrade does, unless copied says that is done or not needed. If the
// copy fails, nothing is changed and the start goes on. Only values change,
// so 0.1.11 still opens the database. A pass that fails anywhere is rolled
// back and logged, and the start goes on; it runs again at the next start.
func (s *Store) rekey(path string, copied bool) error {
	if err := s.rekeyPass(path, copied); err != nil {
		log.Printf("database: bookmark keys from an older version were left as they are, to be set at the next start: %v", err)
	}
	return nil
}

func (s *Store) rekeyPass(path string, copied bool) error {
	type change struct {
		id       int64
		old, key string
	}
	var changes []change
	rows, err := s.db.Query(`SELECT id, url, url_key FROM bookmarks`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var c change
		var raw string
		if err := rows.Scan(&c.id, &raw, &c.old); err != nil {
			rows.Close()
			return err
		}
		if key, err := urlkey.Key(raw); err == nil && key != c.old {
			c.key = key
			changes = append(changes, c)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(changes) == 0 {
		return err
	}
	where := "the copy taken before this start's upgrade"
	if !copied {
		dst, err := backupBeforeMigrate(s.db, path, len(migrations))
		if err != nil {
			return fmt.Errorf("the copy of the database before changing %d keys failed: %w", len(changes), err)
		}
		where = dst
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, c := range changes {
		if _, err := tx.Exec(`UPDATE bookmarks SET url_key = ? WHERE id = ? AND url_key = ?`, c.key, c.id, c.old); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE icon_failures SET url_key = ? WHERE bookmark_id = ? AND url_key = ?`, c.key, c.id, c.old); err != nil {
			return err
		}
	}
	var shared int
	for _, c := range changes {
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM bookmarks WHERE url_key = ? AND id != ?`, c.key, c.id).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			shared++
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	log.Printf("database: set the key of %d bookmarks saved under the address rule of an older version (the database as it was is %s); %d of them now have the same address as another bookmark, and all are kept", len(changes), where, shared)
	return nil
}

// querier is satisfied by *sql.DB and *sql.Tx.
type querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

// withTx runs fn in a transaction and commits when it returns nil.
func (s *Store) withTx(fn func(tx *sql.Tx) error) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	s.writes++
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// exec runs one write statement outside a transaction.
func (s *Store) exec(query string, args ...any) (sql.Result, error) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	s.writes++
	return s.db.Exec(query, args...)
}
