package store

import (
	"database/sql"
	"errors"
)

// IconGiveUp is how many failed icon fetches a bookmark gets before the
// fetch at start stops trying it. Saving, editing the address or Refetch
// icon still try again.
const IconGiveUp = 3

// IconFailed records a failed icon fetch for bookmark id at address forKey.
// A failure for a new address starts the count again. final counts as
// IconGiveUp failures at once, for a fetch that broke instead of failing.
func (s *Store) IconFailed(id int64, forKey string, final bool) error {
	return s.withTx(func(tx *sql.Tx) error {
		if _, err := getBookmark(tx, id); err != nil {
			return err // gone meanwhile
		}
		var key string
		var count int
		err := tx.QueryRow(`SELECT url_key, count FROM icon_failures WHERE bookmark_id = ?`, id).Scan(&key, &count)
		switch {
		case errors.Is(err, sql.ErrNoRows), err == nil && key != forKey:
			count = 0
		case err != nil:
			return err
		}
		count++
		if final {
			count = max(count, IconGiveUp)
		}
		_, err = tx.Exec(`INSERT INTO icon_failures (bookmark_id, url_key, count) VALUES (?, ?, ?)
			ON CONFLICT (bookmark_id) DO UPDATE SET url_key = excluded.url_key, count = excluded.count`, id, forKey, count)
		return err
	})
}

// IconsGivenUp returns the bookmarks whose icon failed IconGiveUp times,
// with the address that failed. A bookmark whose address changed since
// is not given up: compare the key with the bookmark's own.
func (s *Store) IconsGivenUp() (map[int64]string, error) {
	rows, err := s.db.Query(`SELECT bookmark_id, url_key FROM icon_failures WHERE count >= ?`, IconGiveUp)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]string{}
	for rows.Next() {
		var id int64
		var key string
		if err := rows.Scan(&id, &key); err != nil {
			return nil, err
		}
		out[id] = key
	}
	return out, rows.Err()
}

// ResetIconFailures forgets every failed icon fetch when version differs
// from the version that recorded them, so an improved icon search in a new
// release tries every link without an icon once more.
func (s *Store) ResetIconFailures(version string) error {
	return s.withTx(func(tx *sql.Tx) error {
		var have string
		err := tx.QueryRow(`SELECT value FROM settings WHERE key = 'icon_failures_version'`).Scan(&have)
		if err == nil && have == version {
			return nil
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM icon_failures`); err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO settings (key, value) VALUES ('icon_failures_version', ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`, version)
		return err
	})
}

// IconFolders returns the folders of the bookmarks that use icon, Trash
// included; a nil entry stands for Inbox. The caller decides which of them
// may see the icon.
func (s *Store) IconFolders(icon string) ([]*int64, error) {
	rows, err := s.db.Query(`SELECT DISTINCT folder_id FROM bookmarks WHERE icon = ?`, icon)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*int64
	for rows.Next() {
		var id sql.NullInt64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		if id.Valid {
			out = append(out, &id.Int64)
		} else {
			out = append(out, nil)
		}
	}
	return out, rows.Err()
}
