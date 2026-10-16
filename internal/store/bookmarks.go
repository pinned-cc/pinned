package store

import (
	"database/sql"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/pinned-cc/pinned/internal/urlkey"
)

// Bookmark is one saved link. Icon is the file name under DATA_DIR/icons.
type Bookmark struct {
	ID             int64
	FolderID       *int64
	Title          string
	URL            string
	URLKey         string
	Position       int64
	Pinned         bool
	PinnedPosition int64
	Icon           *string
	Tile           *string
	CreatedAt      int64
	UpdatedAt      int64
	OpenedAt       *int64
	DeletedAt      *int64
}

// Host is the label shown under the title: host plus port.
func (b Bookmark) Host() string { return urlkey.Host(b.URL) }

// Letter is the first letter of the title, uppercase, for the letter mark.
func (b Bookmark) Letter() string {
	for _, r := range b.Title {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return strings.ToUpper(string(r))
		}
	}
	if r, _ := utf8.DecodeRuneInString(b.Host()); r != utf8.RuneError {
		return strings.ToUpper(string(r))
	}
	return "?"
}

const bookmarkCols = `id, folder_id, title, url, url_key, position, pinned, pinned_position, icon, tile, created_at, updated_at, opened_at, deleted_at`

type scanner interface{ Scan(dest ...any) error }

func scanBookmark(sc scanner) (Bookmark, error) {
	var b Bookmark
	var folder, opened, deleted sql.NullInt64
	var icon, tile sql.NullString
	var pinned int64
	err := sc.Scan(&b.ID, &folder, &b.Title, &b.URL, &b.URLKey, &b.Position, &pinned, &b.PinnedPosition,
		&icon, &tile, &b.CreatedAt, &b.UpdatedAt, &opened, &deleted)
	if err != nil {
		return b, err
	}
	b.Pinned = pinned != 0
	if folder.Valid {
		b.FolderID = &folder.Int64
	}
	if opened.Valid {
		b.OpenedAt = &opened.Int64
	}
	if deleted.Valid {
		b.DeletedAt = &deleted.Int64
	}
	if icon.Valid {
		b.Icon = &icon.String
	}
	if tile.Valid {
		b.Tile = &tile.String
	}
	return b, nil
}

func queryBookmarks(q querier, where string, args ...any) ([]Bookmark, error) {
	rows, err := q.Query(`SELECT `+bookmarkCols+` FROM bookmarks `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Bookmark{}
	for rows.Next() {
		b, err := scanBookmark(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func getBookmark(q querier, id int64) (Bookmark, error) {
	b, err := scanBookmark(q.QueryRow(`SELECT `+bookmarkCols+` FROM bookmarks WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

// liveByKey returns the live bookmark with key, or ErrNotFound.
func liveByKey(q querier, key string) (Bookmark, error) {
	b, err := scanBookmark(q.QueryRow(`SELECT `+bookmarkCols+` FROM bookmarks WHERE url_key = ? AND deleted_at IS NULL`, key))
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

// Bookmark returns one bookmark.
func (s *Store) Bookmark(id int64) (Bookmark, error) { return getBookmark(s.db, id) }

// Bookmarks returns every bookmark, Trash included.
func (s *Store) Bookmarks() ([]Bookmark, error) {
	return queryBookmarks(s.db, `ORDER BY position, id`)
}

// CountLive returns the number of bookmarks not in Trash.
func (s *Store) CountLive() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM bookmarks WHERE deleted_at IS NULL`).Scan(&n)
	return n, err
}

// FindLive returns the live bookmark with the same identity as rawURL.
func (s *Store) FindLive(rawURL string) (Bookmark, error) {
	key, err := urlkey.Key(rawURL)
	if err != nil {
		return Bookmark{}, err
	}
	return liveByKey(s.db, key)
}

// OriginIcon is an icon used by a bookmark, with that bookmark's folder so
// the caller can leave out folders it must not see.
type OriginIcon struct {
	Icon     string
	Tile     *string
	FolderID *int64
}

// IconsForOrigin returns the icons of bookmarks on the same scheme, host and
// port as rawURL, live ones first, at most 20.
func (s *Store) IconsForOrigin(rawURL string) ([]OriginIcon, error) {
	origin := urlkey.Origin(rawURL)
	if origin == "" {
		return nil, nil
	}
	// Every key on the origin starts with origin + "/"; "0" is the byte
	// after "/", so the range covers exactly those keys and uses the index.
	rows, err := s.db.Query(`SELECT icon, tile, folder_id FROM bookmarks
		WHERE url_key >= ? AND url_key < ? AND icon IS NOT NULL
		ORDER BY deleted_at IS NOT NULL, id LIMIT 20`, origin+"/", origin+"0")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OriginIcon
	for rows.Next() {
		var c OriginIcon
		var t sql.NullString
		var f sql.NullInt64
		if err := rows.Scan(&c.Icon, &t, &f); err != nil {
			return nil, err
		}
		if t.Valid {
			c.Tile = &t.String
		}
		if f.Valid {
			c.FolderID = &f.Int64
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func nextPosition(q querier, folderID *int64) (int64, error) {
	var p int64
	err := q.QueryRow(`SELECT COALESCE(MAX(position), -1) + 1 FROM bookmarks WHERE folder_id IS ? AND deleted_at IS NULL`, nullable(folderID)).Scan(&p)
	return p, err
}

func folderExists(q querier, id int64) (bool, error) {
	var n int
	err := q.QueryRow(`SELECT COUNT(*) FROM folders WHERE id = ?`, id).Scan(&n)
	return n > 0, err
}

func nullable(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

// NewBookmark is the input for Create.
type NewBookmark struct {
	Title    string
	URL      string
	FolderID *int64
	// Force saves even when the URL is already saved: the existing bookmark
	// is moved to FolderID and takes the new title, because two live
	// bookmarks never share an identity.
	Force bool
}

// Create saves a bookmark. created is false when Force updated an existing
// one instead. Without Force an existing URL returns a *DuplicateError.
func (s *Store) Create(in NewBookmark) (b Bookmark, created bool, err error) {
	key, err := urlkey.Key(in.URL)
	if err != nil {
		return b, false, err
	}
	in.URL = strings.TrimSpace(in.URL)
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		in.Title = urlkey.Host(in.URL)
	}
	now := s.now()
	err = s.withTx(func(tx *sql.Tx) error {
		if in.FolderID != nil {
			ok, err := folderExists(tx, *in.FolderID)
			if err != nil {
				return err
			}
			if !ok {
				return ErrNoFolder
			}
		}
		existing, err := liveByKey(tx, key)
		switch {
		case err == nil && !in.Force:
			return &DuplicateError{Existing: existing}
		case err == nil && in.Force:
			pos := existing.Position
			if !sameFolder(existing.FolderID, in.FolderID) {
				if pos, err = nextPosition(tx, in.FolderID); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(`UPDATE bookmarks SET title = ?, folder_id = ?, position = ?, updated_at = ? WHERE id = ?`,
				in.Title, nullable(in.FolderID), pos, now, existing.ID); err != nil {
				return err
			}
			b, err = getBookmark(tx, existing.ID)
			if err != nil {
				return err
			}
		case errors.Is(err, ErrNotFound):
			pos, err := nextPosition(tx, in.FolderID)
			if err != nil {
				return err
			}
			res, err := tx.Exec(`INSERT INTO bookmarks (folder_id, title, url, url_key, position, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`, nullable(in.FolderID), in.Title, in.URL, key, pos, now, now)
			if err != nil {
				return err
			}
			id, _ := res.LastInsertId()
			if b, err = getBookmark(tx, id); err != nil {
				return err
			}
			created = true
		default:
			return err
		}
		if in.FolderID != nil {
			return rememberFolder(tx, *in.FolderID)
		}
		return nil
	})
	return b, created, err
}

func sameFolder(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// Patch holds the optional fields of a bookmark update. A nil field is left
// alone. FolderSet with a nil FolderID moves the bookmark to Inbox.
type Patch struct {
	Title     *string
	URL       *string
	FolderSet bool
	FolderID  *int64
	Pinned    *bool
}

// Update changes a bookmark. urlChanged reports whether the identity changed,
// so the caller can fetch a new icon.
func (s *Store) Update(id int64, p Patch) (b Bookmark, urlChanged bool, err error) {
	now := s.now()
	err = s.withTx(func(tx *sql.Tx) error {
		cur, err := getBookmark(tx, id)
		if err != nil {
			return err
		}
		if p.Title != nil {
			t := strings.TrimSpace(*p.Title)
			if t == "" {
				return ErrEmptyTitle
			}
			if _, err := tx.Exec(`UPDATE bookmarks SET title = ? WHERE id = ?`, t, id); err != nil {
				return err
			}
		}
		if p.URL != nil {
			raw := strings.TrimSpace(*p.URL)
			key, err := urlkey.Key(raw)
			if err != nil {
				return err
			}
			if key != cur.URLKey {
				if cur.DeletedAt == nil {
					if other, err := liveByKey(tx, key); err == nil && other.ID != id {
						return &DuplicateError{Existing: other}
					}
				}
				urlChanged = true
				// A different host or port means the old icon is wrong.
				if urlkey.Origin(raw) != urlkey.Origin(cur.URL) {
					if _, err := tx.Exec(`UPDATE bookmarks SET icon = NULL, tile = NULL WHERE id = ?`, id); err != nil {
						return err
					}
				}
			}
			if _, err := tx.Exec(`UPDATE bookmarks SET url = ?, url_key = ? WHERE id = ?`, raw, key, id); err != nil {
				return err
			}
		}
		if p.FolderSet && !sameFolder(cur.FolderID, p.FolderID) {
			if p.FolderID != nil {
				ok, err := folderExists(tx, *p.FolderID)
				if err != nil {
					return err
				}
				if !ok {
					return ErrNoFolder
				}
			}
			pos, err := nextPosition(tx, p.FolderID)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE bookmarks SET folder_id = ?, position = ? WHERE id = ?`, nullable(p.FolderID), pos, id); err != nil {
				return err
			}
		}
		// Moving into a folder counts as saving there, like Create: the
		// Shortcut saves to Inbox first and then moves the bookmark.
		if p.FolderSet && p.FolderID != nil {
			if err := rememberFolder(tx, *p.FolderID); err != nil {
				return err
			}
		}
		if p.Pinned != nil && *p.Pinned != cur.Pinned {
			if err := setPinned(tx, id, *p.Pinned); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`UPDATE bookmarks SET updated_at = ? WHERE id = ?`, now, id); err != nil {
			return err
		}
		b, err = getBookmark(tx, id)
		return err
	})
	return b, urlChanged, err
}

func setPinned(q querier, id int64, pinned bool) error {
	if !pinned {
		_, err := q.Exec(`UPDATE bookmarks SET pinned = 0, pinned_position = 0 WHERE id = ?`, id)
		return err
	}
	_, err := q.Exec(`UPDATE bookmarks SET pinned = 1,
		pinned_position = (SELECT COALESCE(MAX(pinned_position), -1) + 1 FROM bookmarks WHERE pinned = 1)
		WHERE id = ? AND pinned = 0`, id)
	return err
}

// MarkOpened records that the bookmark was opened now.
func (s *Store) MarkOpened(id int64) error {
	return s.execOne(`UPDATE bookmarks SET opened_at = ? WHERE id = ?`, s.now(), id)
}

// Trash moves a bookmark to Trash.
func (s *Store) Trash(id int64) error {
	return s.execOne(`UPDATE bookmarks SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?`, s.now(), id)
}

// Restore takes a bookmark out of Trash. If its folder is gone it lands in
// Inbox (the foreign key already cleared folder_id). If the same URL was saved
// again meanwhile, it returns a *DuplicateError and stays in Trash.
func (s *Store) Restore(id int64) error {
	return s.withTx(func(tx *sql.Tx) error { return restore(tx, id) })
}

func restore(tx *sql.Tx, id int64) error {
	b, err := getBookmark(tx, id)
	if err != nil {
		return err
	}
	if b.DeletedAt == nil {
		return nil
	}
	if other, err := liveByKey(tx, b.URLKey); err == nil {
		return &DuplicateError{Existing: other}
	}
	pos, err := nextPosition(tx, b.FolderID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE bookmarks SET deleted_at = NULL, position = ? WHERE id = ?`, pos, id)
	return err
}

// Delete removes a bookmark for good. It returns the icon file the bookmark
// used if nothing else uses it any more, so the caller can remove the file.
func (s *Store) Delete(id int64) (orphanIcons []string, err error) {
	err = s.withTx(func(tx *sql.Tx) error {
		ok, err := exists(tx, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		orphanIcons, err = deleteBookmarks(tx, `id = ?`, id)
		return err
	})
	return orphanIcons, err
}

func exists(q querier, id int64) (bool, error) {
	var n int
	err := q.QueryRow(`SELECT COUNT(*) FROM bookmarks WHERE id = ?`, id).Scan(&n)
	return n > 0, err
}

// Purge deletes bookmarks that have been in Trash longer than days.
func (s *Store) Purge(days int) (deleted int, orphanIcons []string, err error) {
	cutoff := s.now() - int64(days)*86400
	err = s.withTx(func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM bookmarks WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff).Scan(&n); err != nil {
			return err
		}
		deleted = n
		orphanIcons, err = deleteBookmarks(tx, `deleted_at IS NOT NULL AND deleted_at < ?`, cutoff)
		return err
	})
	return deleted, orphanIcons, err
}

// deleteBookmarks deletes the rows matching where and returns the icon files
// that no remaining bookmark points to.
func deleteBookmarks(tx *sql.Tx, where string, args ...any) ([]string, error) {
	rows, err := tx.Query(`SELECT DISTINCT icon FROM bookmarks WHERE icon IS NOT NULL AND `+where, args...)
	if err != nil {
		return nil, err
	}
	var icons []string
	for rows.Next() {
		var icon string
		if err := rows.Scan(&icon); err != nil {
			rows.Close()
			return nil, err
		}
		icons = append(icons, icon)
	}
	rows.Close()
	if _, err := tx.Exec(`DELETE FROM bookmarks WHERE `+where, args...); err != nil {
		return nil, err
	}
	var orphans []string
	for _, icon := range icons {
		used, err := iconInUse(tx, icon)
		if err != nil {
			return nil, err
		}
		if !used {
			orphans = append(orphans, icon)
		}
	}
	return orphans, nil
}

func iconInUse(q querier, icon string) (bool, error) {
	var n int
	err := q.QueryRow(`SELECT COUNT(*) FROM bookmarks WHERE icon = ?`, icon).Scan(&n)
	return n > 0, err
}

// IconInUse reports whether any bookmark points to the icon file.
func (s *Store) IconInUse(icon string) bool {
	used, err := iconInUse(s.db, icon)
	return err != nil || used // on error, keep the file
}

// SetIcon stores the fetched icon, but only if the bookmark still has the URL
// the icon was fetched for. It returns the previous icon file.
func (s *Store) SetIcon(id int64, forKey string, icon string, tile *string) (previous *string, err error) {
	err = s.withTx(func(tx *sql.Tx) error {
		b, err := getBookmark(tx, id)
		if err != nil {
			return err
		}
		if b.URLKey != forKey {
			return ErrNotFound
		}
		previous = b.Icon
		var t any
		if tile != nil {
			t = *tile
		}
		_, err = tx.Exec(`UPDATE bookmarks SET icon = ?, tile = ? WHERE id = ?`, icon, t, id)
		return err
	})
	return previous, err
}

// Bulk applies one action to many bookmarks: move, trash, restore, pin,
// unpin or delete. Restoring a bookmark whose URL was saved again leaves it
// in Trash.
func (s *Store) Bulk(ids []int64, action string, folderID *int64) (orphanIcons []string, err error) {
	now := s.now()
	err = s.withTx(func(tx *sql.Tx) error {
		if action == "move" && folderID != nil {
			ok, err := folderExists(tx, *folderID)
			if err != nil {
				return err
			}
			if !ok {
				return ErrNoFolder
			}
		}
		for _, id := range ids {
			var err error
			switch action {
			case "move":
				var pos int64
				if pos, err = nextPosition(tx, folderID); err == nil {
					_, err = tx.Exec(`UPDATE bookmarks SET folder_id = ?, position = ?, updated_at = ? WHERE id = ?`, nullable(folderID), pos, now, id)
				}
			case "trash":
				_, err = tx.Exec(`UPDATE bookmarks SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?`, now, id)
			case "restore":
				err = restore(tx, id)
				var dup *DuplicateError
				if errors.As(err, &dup) || errors.Is(err, ErrNotFound) {
					err = nil
				}
			case "pin":
				err = setPinned(tx, id, true)
			case "unpin":
				err = setPinned(tx, id, false)
			case "delete":
				var orphans []string
				orphans, err = deleteBookmarks(tx, `id = ?`, id)
				orphanIcons = append(orphanIcons, orphans...)
			default:
				return ErrUnknownAction
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	return orphanIcons, err
}

// OrderBookmarks sets the position of ids in the order given. ids that are
// not in folderID are ignored.
func (s *Store) OrderBookmarks(folderID *int64, ids []int64) error {
	return s.withTx(func(tx *sql.Tx) error {
		for i, id := range ids {
			if _, err := tx.Exec(`UPDATE bookmarks SET position = ? WHERE id = ? AND folder_id IS ?`, i, id, nullable(folderID)); err != nil {
				return err
			}
		}
		return nil
	})
}

// OrderPinned sets the order of the pinned dock.
func (s *Store) OrderPinned(ids []int64) error {
	return s.withTx(func(tx *sql.Tx) error {
		for i, id := range ids {
			if _, err := tx.Exec(`UPDATE bookmarks SET pinned_position = ? WHERE id = ? AND pinned = 1`, i, id); err != nil {
				return err
			}
		}
		return nil
	})
}

// execOne runs a single row update and returns ErrNotFound when no row matched.
func (s *Store) execOne(query string, args ...any) error {
	res, err := s.db.Exec(query, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
