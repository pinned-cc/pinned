package store

import "database/sql"

// SetLock gives a folder its own password hash. Shares on the folder and
// on every folder below it are deleted, so nothing locked stays public.
func (s *Store) SetLock(folderID int64, hash string) error {
	return s.withTx(func(tx *sql.Tx) error {
		res, err := tx.Exec(`UPDATE folders SET lock_hash = ? WHERE id = ?`, hash, folderID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		_, err = tx.Exec(subtree+`DELETE FROM shares WHERE folder_id IN (SELECT id FROM sub)`, folderID)
		return err
	})
}

// RemoveLock takes the folder's own password away.
func (s *Store) RemoveLock(folderID int64) error {
	return s.execOne(`UPDATE folders SET lock_hash = NULL WHERE id = ?`, folderID)
}
