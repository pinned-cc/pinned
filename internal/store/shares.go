package store

import (
	"database/sql"
	"errors"
)

// Share is a read only link to one folder and everything below it.
type Share struct {
	ID           int64
	FolderID     int64
	Token        string
	PasswordHash *string
	ExpiresAt    *int64
	CreatedAt    int64
	Opens        int64
	LastOpenedAt *int64
}

const shareCols = `id, folder_id, token, password_hash, expires_at, created_at, opens, last_opened_at`

func scanShare(sc scanner) (Share, error) {
	var sh Share
	var pw sql.NullString
	var exp, last sql.NullInt64
	err := sc.Scan(&sh.ID, &sh.FolderID, &sh.Token, &pw, &exp, &sh.CreatedAt, &sh.Opens, &last)
	if pw.Valid {
		sh.PasswordHash = &pw.String
	}
	if exp.Valid {
		sh.ExpiresAt = &exp.Int64
	}
	if last.Valid {
		sh.LastOpenedAt = &last.Int64
	}
	return sh, err
}

func nullString(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// CreateShare shares a folder. A folder has at most one share.
func (s *Store) CreateShare(folderID int64, token string, passwordHash *string, expiresAt *int64) (Share, error) {
	var sh Share
	err := s.withTx(func(tx *sql.Tx) error {
		ok, err := folderExists(tx, folderID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM shares WHERE folder_id = ?`, folderID).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			return ErrShareExists
		}
		if _, err := tx.Exec(`INSERT INTO shares (folder_id, token, password_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
			folderID, token, nullString(passwordHash), nullable(expiresAt), s.now()); err != nil {
			return err
		}
		sh, err = scanShare(tx.QueryRow(`SELECT `+shareCols+` FROM shares WHERE token = ?`, token))
		return err
	})
	return sh, err
}

// Shares returns every share, expired ones included.
func (s *Store) Shares() ([]Share, error) {
	rows, err := s.db.Query(`SELECT ` + shareCols + ` FROM shares`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Share
	for rows.Next() {
		sh, err := scanShare(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

// ShareByToken returns a share, expired or not.
func (s *Store) ShareByToken(token string) (Share, error) {
	sh, err := scanShare(s.db.QueryRow(`SELECT `+shareCols+` FROM shares WHERE token = ?`, token))
	if errors.Is(err, sql.ErrNoRows) {
		return sh, ErrNotFound
	}
	return sh, err
}

// ActiveShare returns a share only when it exists and has not expired.
func (s *Store) ActiveShare(token string) (Share, error) {
	sh, err := s.ShareByToken(token)
	if err != nil {
		return sh, err
	}
	if sh.ExpiresAt != nil && *sh.ExpiresAt <= s.now() {
		return sh, ErrNotFound
	}
	return sh, nil
}

// UpdateShare changes the password and or the expiry. passwordSet with a nil
// hash removes the password; expirySet with a nil time means never.
func (s *Store) UpdateShare(token string, passwordSet bool, passwordHash *string, expirySet bool, expiresAt *int64) (Share, error) {
	if passwordSet {
		if err := s.execOne(`UPDATE shares SET password_hash = ? WHERE token = ?`, nullString(passwordHash), token); err != nil {
			return Share{}, err
		}
	}
	if expirySet {
		if err := s.execOne(`UPDATE shares SET expires_at = ? WHERE token = ?`, nullable(expiresAt), token); err != nil {
			return Share{}, err
		}
	}
	return s.ShareByToken(token)
}

// DeleteShare revokes a share.
func (s *Store) DeleteShare(token string) error {
	return s.execOne(`DELETE FROM shares WHERE token = ?`, token)
}

// RecordShareOpen counts one visit.
func (s *Store) RecordShareOpen(token string) error {
	return s.execOne(`UPDATE shares SET opens = opens + 1, last_opened_at = ? WHERE token = ?`, s.now(), token)
}

const subtree = `WITH RECURSIVE sub(id) AS (
	SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id) `

// ShareContents returns the shared folder, its subfolders at any depth, and
// the live bookmarks in all of them.
func (s *Store) ShareContents(folderID int64) (root Folder, folders []Folder, bookmarks []Bookmark, err error) {
	if root, err = getFolder(s.db, folderID); err != nil {
		return
	}
	rows, err := s.db.Query(subtree+`SELECT id, parent_id, name, position, created_at FROM folders
		WHERE id IN (SELECT id FROM sub) AND id != ? ORDER BY position, id`, folderID, folderID)
	if err != nil {
		return
	}
	folders = []Folder{}
	for rows.Next() {
		var f Folder
		var parent sql.NullInt64
		if err = rows.Scan(&f.ID, &parent, &f.Name, &f.Position, &f.CreatedAt); err != nil {
			rows.Close()
			return
		}
		if parent.Valid {
			f.ParentID = &parent.Int64
		}
		folders = append(folders, f)
	}
	rows.Close()
	rows, err = s.db.Query(subtree+`SELECT `+bookmarkCols+` FROM bookmarks
		WHERE deleted_at IS NULL AND folder_id IN (SELECT id FROM sub) ORDER BY position, id`, folderID)
	if err != nil {
		return
	}
	defer rows.Close()
	bookmarks = []Bookmark{}
	for rows.Next() {
		var b Bookmark
		if b, err = scanBookmark(rows); err != nil {
			return
		}
		bookmarks = append(bookmarks, b)
	}
	err = rows.Err()
	return
}

// ShareHasIcon reports whether icon belongs to a live bookmark in the shared
// folder or below it.
func (s *Store) ShareHasIcon(folderID int64, icon string) bool {
	var n int
	err := s.db.QueryRow(subtree+`SELECT COUNT(*) FROM bookmarks
		WHERE icon = ? AND deleted_at IS NULL AND folder_id IN (SELECT id FROM sub)`, folderID, icon).Scan(&n)
	return err == nil && n > 0
}
