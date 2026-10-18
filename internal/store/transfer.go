package store

import (
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/pinned-cc/pinned/internal/netscape"
	"github.com/pinned-cc/pinned/internal/urlkey"
)

// ImportResult says what an import did. AddedIDs lists the new bookmarks so
// the caller can fetch their icons.
type ImportResult struct {
	Added    int     `json:"added"`
	Skipped  int     `json:"skipped"`
	Folders  int     `json:"folders"`
	AddedIDs []int64 `json:"-"`
}

// MaxImportName caps folder names read from an import file, in characters.
const MaxImportName = 200

// Import adds the bookmarks of a parsed file. Folders are matched by name
// under the same parent and created when missing. Links whose identity is
// already saved, or that are not http or https, are skipped. Links at the
// root of the file land in Inbox.
//
// Import never writes into a locked folder: a file folder whose name matches
// a locked folder becomes a new folder beside it, named "<name> (imported)".
// Folders deeper than MaxDepth are flattened into the folder at MaxDepth.
func (s *Store) Import(root *netscape.Folder) (ImportResult, error) {
	var res ImportResult
	now := s.now()
	err := s.withTx(func(tx *sql.Tx) error {
		return importFolder(tx, root, nil, 0, now, &res)
	})
	if err != nil {
		return ImportResult{}, err
	}
	return res, nil
}

// importFolder adds f's links and subfolders into parentID, which sits at
// depth (0 for the root and Inbox).
func importFolder(tx *sql.Tx, f *netscape.Folder, parentID *int64, depth int, now int64, res *ImportResult) error {
	for _, l := range f.Links {
		key, err := urlkey.Key(l.URL)
		if err != nil {
			res.Skipped++
			continue
		}
		if _, err := liveByKey(tx, key); err == nil {
			res.Skipped++
			continue
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		created := l.AddDate
		if created <= 0 {
			created = now
		}
		title := clip(l.Title, MaxTitle)
		if title == "" {
			title = urlkey.Host(l.URL)
		}
		pos, err := nextPosition(tx, parentID)
		if err != nil {
			return err
		}
		r, err := tx.Exec(`INSERT INTO bookmarks (folder_id, title, url, url_key, position, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, nullable(parentID), title, strings.TrimSpace(l.URL), key, pos, created, now)
		if err != nil {
			return err
		}
		id, err := r.LastInsertId()
		if err != nil {
			return err
		}
		res.Added++
		res.AddedIDs = append(res.AddedIDs, id)
	}
	for _, sub := range f.Folders {
		if depth >= MaxDepth {
			// Too deep: the folder's contents land in this folder.
			if err := importFolder(tx, sub, parentID, depth, now, res); err != nil {
				return err
			}
			continue
		}
		id, err := importTarget(tx, sub, parentID, now, res)
		if err != nil {
			return err
		}
		if err := importFolder(tx, sub, &id, depth+1, now, res); err != nil {
			return err
		}
	}
	return nil
}

// importTarget finds or creates the folder that a file folder imports into.
// An unlocked folder of the same name under parentID is reused; when the
// only match is locked, the name gets " (imported)" and the search repeats.
func importTarget(tx *sql.Tx, sub *netscape.Folder, parentID *int64, now int64, res *ImportResult) (int64, error) {
	name := strings.TrimSpace(sub.Name)
	if name == "" {
		name = "Imported"
	}
	if utf8.RuneCountInString(name) > MaxImportName {
		name = strings.TrimSpace(string([]rune(name)[:MaxImportName]))
	}
	for {
		var id int64
		var lock sql.NullString
		err := tx.QueryRow(`SELECT id, lock_hash FROM folders WHERE parent_id IS ? AND name = ?
			ORDER BY lock_hash IS NOT NULL, position, id LIMIT 1`, nullable(parentID), name).Scan(&id, &lock)
		switch {
		case err == nil && !lock.Valid:
			return id, nil
		case err == nil:
			name += " (imported)"
			continue
		case !errors.Is(err, sql.ErrNoRows):
			return 0, err
		}
		created := sub.AddDate
		if created <= 0 {
			created = now
		}
		id, err = insertFolder(tx, name, parentID, created)
		if err != nil {
			return 0, err
		}
		res.Folders++
		return id, nil
	}
}

// ExportTree returns the live bookmarks as a tree for the Netscape writer.
// Inbox bookmarks sit at the root; Trash is left out.
func (s *Store) ExportTree() (*netscape.Folder, error) {
	folders, err := s.Folders()
	if err != nil {
		return nil, err
	}
	bookmarks, err := queryBookmarks(s.db, `WHERE deleted_at IS NULL ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	root := &netscape.Folder{Name: "Bookmarks"}
	byID := map[int64]*netscape.Folder{}
	for _, f := range folders {
		byID[f.ID] = &netscape.Folder{Name: f.Name, AddDate: f.CreatedAt}
	}
	for _, f := range folders { // already ordered by position
		parent := root
		if f.ParentID != nil {
			if p, ok := byID[*f.ParentID]; ok {
				parent = p
			}
		}
		parent.Folders = append(parent.Folders, byID[f.ID])
	}
	for _, b := range bookmarks {
		parent := root
		if b.FolderID != nil {
			if p, ok := byID[*b.FolderID]; ok {
				parent = p
			}
		}
		parent.Links = append(parent.Links, netscape.Link{Title: b.Title, URL: b.URL, AddDate: b.CreatedAt})
	}
	return root, nil
}
