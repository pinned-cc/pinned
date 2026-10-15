// Package store keeps folders, bookmarks, settings and sessions in one
// SQLite file.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

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

// DuplicateError is returned when a live bookmark already has the same url_key.
type DuplicateError struct{ Existing Bookmark }

func (e *DuplicateError) Error() string { return "already saved" }

// Store wraps the database.
type Store struct {
	db *sql.DB
	// Now returns the current time. Tests replace it.
	Now func() time.Time
}

// Open opens (and creates or migrates) the database at path.
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
	if err := s.migrate(); err != nil {
		db.Close()
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
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return err
	}
	var version int
	err := s.db.QueryRow(`SELECT version FROM schema_version`).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := s.db.Exec(`INSERT INTO schema_version (version) VALUES (0)`); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	for i := version; i < len(migrations); i++ {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		if _, err := tx.Exec(`UPDATE schema_version SET version = ?`, i+1); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
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
