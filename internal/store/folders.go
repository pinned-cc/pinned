package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
)

// Folder is a folder. ParentID nil means top level.
type Folder struct {
	ID        int64
	ParentID  *int64
	Name      string
	Position  int64
	CreatedAt int64
	// LockHash is the bcrypt hash of the folder's own password, nil when
	// the folder has no lock of its own.
	LockHash *string
	// HideRecent keeps the folder's bookmarks, and those of its subfolders,
	// out of the recently opened lists.
	HideRecent bool
}

// Folders returns every folder ordered by position.
func (s *Store) Folders() ([]Folder, error) { return queryFolders(s.db) }

func queryFolders(q querier) ([]Folder, error) {
	rows, err := q.Query(`SELECT id, parent_id, name, position, created_at, lock_hash, hide_recent FROM folders ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Folder{}
	for rows.Next() {
		var f Folder
		var parent sql.NullInt64
		var lock sql.NullString
		if err := rows.Scan(&f.ID, &parent, &f.Name, &f.Position, &f.CreatedAt, &lock, &f.HideRecent); err != nil {
			return nil, err
		}
		if parent.Valid {
			f.ParentID = &parent.Int64
		}
		if lock.Valid {
			f.LockHash = &lock.String
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// Folder returns one folder.
func (s *Store) Folder(id int64) (Folder, error) { return getFolder(s.db, id) }

func getFolder(q querier, id int64) (Folder, error) {
	var f Folder
	var parent sql.NullInt64
	var lock sql.NullString
	err := q.QueryRow(`SELECT id, parent_id, name, position, created_at, lock_hash, hide_recent FROM folders WHERE id = ?`, id).
		Scan(&f.ID, &parent, &f.Name, &f.Position, &f.CreatedAt, &lock, &f.HideRecent)
	if errors.Is(err, sql.ErrNoRows) {
		return f, ErrNotFound
	}
	if parent.Valid {
		f.ParentID = &parent.Int64
	}
	if lock.Valid {
		f.LockHash = &lock.String
	}
	return f, err
}

func nextFolderPosition(q querier, parentID *int64) (int64, error) {
	var p int64
	err := q.QueryRow(`SELECT COALESCE(MAX(position), -1) + 1 FROM folders WHERE parent_id IS ?`, nullable(parentID)).Scan(&p)
	return p, err
}

// CreateFolder adds a folder at the end of its level.
func (s *Store) CreateFolder(name string, parentID *int64) (Folder, error) {
	name = clip(name, MaxFolderName)
	if name == "" {
		return Folder{}, ErrEmptyName
	}
	var f Folder
	err := s.withTx(func(tx *sql.Tx) error {
		if err := checkNewFolderDepth(tx, parentID); err != nil {
			return err
		}
		id, err := insertFolder(tx, name, parentID, s.now())
		if err != nil {
			return err
		}
		f, err = getFolder(tx, id)
		return err
	})
	return f, err
}

// checkNewFolderDepth refuses a new folder deeper than MaxDepth.
func checkNewFolderDepth(q querier, parentID *int64) error {
	if parentID == nil {
		return nil
	}
	d, err := folderDepth(q, *parentID)
	if err != nil {
		return err
	}
	if d+1 > MaxDepth {
		return ErrTooDeep
	}
	return nil
}

// folderDepth is 1 for a top level folder, 2 for its subfolders, and so on.
func folderDepth(q querier, id int64) (int, error) {
	var d sql.NullInt64
	err := q.QueryRow(`WITH RECURSIVE up(id, parent_id, d) AS (
			SELECT id, parent_id, 1 FROM folders WHERE id = ?
			UNION ALL SELECT f.id, f.parent_id, up.d + 1 FROM folders f JOIN up ON f.id = up.parent_id)
		SELECT MAX(d) FROM up`, id).Scan(&d)
	return int(d.Int64), err
}

// subtreeHeight is 1 for a folder without subfolders, 2 with subfolders that
// have none, and so on.
func subtreeHeight(q querier, id int64) (int, error) {
	var d sql.NullInt64
	err := q.QueryRow(`WITH RECURSIVE sub(id, d) AS (
			SELECT ?, 1 UNION ALL SELECT f.id, sub.d + 1 FROM folders f JOIN sub ON f.parent_id = sub.id)
		SELECT MAX(d) FROM sub`, id).Scan(&d)
	return int(d.Int64), err
}

func insertFolder(tx *sql.Tx, name string, parentID *int64, createdAt int64) (int64, error) {
	if parentID != nil {
		ok, err := folderExists(tx, *parentID)
		if err != nil {
			return 0, err
		}
		if !ok {
			return 0, ErrNoFolder
		}
	}
	pos, err := nextFolderPosition(tx, parentID)
	if err != nil {
		return 0, err
	}
	res, err := tx.Exec(`INSERT INTO folders (parent_id, name, position, created_at) VALUES (?, ?, ?, ?)`,
		nullable(parentID), name, pos, createdAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// isDescendant reports whether candidate is folder id or lies below it.
func isDescendant(q querier, id, candidate int64) (bool, error) {
	var n int
	err := q.QueryRow(`WITH RECURSIVE sub(id) AS (
			SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
		SELECT COUNT(*) FROM sub WHERE id = ?`, id, candidate).Scan(&n)
	return n > 0, err
}

// UpdateFolder renames and or moves a folder. parentSet with a nil parentID
// moves it to the top level.
func (s *Store) UpdateFolder(id int64, name *string, parentSet bool, parentID *int64) (Folder, error) {
	var f Folder
	err := s.withTx(func(tx *sql.Tx) error {
		cur, err := getFolder(tx, id)
		if err != nil {
			return err
		}
		if name != nil {
			n := clip(*name, MaxFolderName)
			if n == "" {
				return ErrEmptyName
			}
			if _, err := tx.Exec(`UPDATE folders SET name = ? WHERE id = ?`, n, id); err != nil {
				return err
			}
		}
		if parentSet && !sameFolder(cur.ParentID, parentID) {
			if parentID != nil {
				ok, err := folderExists(tx, *parentID)
				if err != nil {
					return err
				}
				if !ok {
					return ErrNoFolder
				}
				below, err := isDescendant(tx, id, *parentID)
				if err != nil {
					return err
				}
				if below {
					return ErrCycle
				}
				depth, err := folderDepth(tx, *parentID)
				if err != nil {
					return err
				}
				height, err := subtreeHeight(tx, id)
				if err != nil {
					return err
				}
				if depth+height > MaxDepth {
					return ErrTooDeep
				}
			}
			pos, err := nextFolderPosition(tx, parentID)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE folders SET parent_id = ?, position = ? WHERE id = ?`, nullable(parentID), pos, id); err != nil {
				return err
			}
		}
		f, err = getFolder(tx, id)
		return err
	})
	return f, err
}

// SetHideRecent turns the folder's Hide from Recent setting on or off. The
// subfolders inherit it in the client; only the folder itself is stored.
func (s *Store) SetHideRecent(id int64, on bool) (Folder, error) {
	var f Folder
	err := s.withTx(func(tx *sql.Tx) error {
		if _, err := getFolder(tx, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE folders SET hide_recent = ? WHERE id = ?`, on, id); err != nil {
			return err
		}
		var err error
		f, err = getFolder(tx, id)
		return err
	})
	return f, err
}

// DeleteFolder deletes a folder and its subfolders. Every bookmark inside,
// at any depth, goes to Trash with its folder cleared. It returns how many
// live bookmarks went to Trash.
func (s *Store) DeleteFolder(id int64) (trashed int, err error) {
	now := s.now()
	err = s.withTx(func(tx *sql.Tx) error {
		if _, err := getFolder(tx, id); err != nil {
			return err
		}
		const sub = `WITH RECURSIVE sub(id) AS (
			SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id) `
		res, err := tx.Exec(sub+`UPDATE bookmarks SET deleted_at = ?, folder_id = NULL
			WHERE deleted_at IS NULL AND folder_id IN (SELECT id FROM sub)`, id, now)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		trashed = int(n)
		if _, err := tx.Exec(`DELETE FROM folders WHERE id = ?`, id); err != nil {
			return err
		}
		return nil
	})
	return trashed, err
}

// OrderFolders sets the position of the folders ids under parentID.
func (s *Store) OrderFolders(parentID *int64, ids []int64) error {
	return s.withTx(func(tx *sql.Tx) error {
		for i, id := range ids {
			if _, err := tx.Exec(`UPDATE folders SET position = ? WHERE id = ? AND parent_id IS ?`, i, id, nullable(parentID)); err != nil {
				return err
			}
		}
		return nil
	})
}

// Settings are the small remembered choices of the save page.
type Settings struct {
	LastFolder    *int64
	RecentFolders []int64
}

// Settings reads the settings, dropping folders that no longer exist.
func (s *Store) Settings() (Settings, error) {
	var st Settings
	st.RecentFolders = []int64{}
	rows, err := s.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return st, err
	}
	values := map[string]string{}
	for rows.Next() {
		var k string
		var v sql.NullString
		if err := rows.Scan(&k, &v); err != nil {
			rows.Close()
			return st, err
		}
		values[k] = v.String
	}
	rows.Close()

	var last int64
	if err := json.Unmarshal([]byte(values["last_folder"]), &last); err == nil {
		if ok, _ := folderExists(s.db, last); ok {
			st.LastFolder = &last
		}
	}
	var recent []int64
	if err := json.Unmarshal([]byte(values["recent_folders"]), &recent); err == nil {
		for _, id := range recent {
			if ok, _ := folderExists(s.db, id); ok {
				st.RecentFolders = append(st.RecentFolders, id)
			}
		}
	}
	return st, nil
}

// rememberFolder sets last_folder and puts id at the front of recent_folders.
func rememberFolder(tx *sql.Tx, id int64) error {
	var raw sql.NullString
	err := tx.QueryRow(`SELECT value FROM settings WHERE key = 'recent_folders'`).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var recent []int64
	if raw.Valid && raw.String != "" {
		if err := json.Unmarshal([]byte(raw.String), &recent); err != nil {
			log.Printf("settings: recent_folders is not a list, starting it again: %v", err)
		}
	}
	list := []int64{id}
	for _, r := range recent {
		if r != id && len(list) < 3 {
			list = append(list, r)
		}
	}
	enc, _ := json.Marshal(list)
	last, _ := json.Marshal(id)
	if _, err := tx.Exec(`INSERT INTO settings (key, value) VALUES ('recent_folders', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, string(enc)); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO settings (key, value) VALUES ('last_folder', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, string(last))
	return err
}
