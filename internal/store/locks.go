package store

import "database/sql"

// SetLock gives a folder its own password hash and a new stamp. Shares on
// the folder and on every folder below it are deleted, so nothing locked
// stays public.
func (s *Store) SetLock(folderID int64, hash string) error {
	stamp, err := newStamp()
	if err != nil {
		return err
	}
	return s.withTx(func(tx *sql.Tx) error {
		res, err := tx.Exec(`UPDATE folders SET lock_hash = ?, lock_stamp = ? WHERE id = ?`, hash, stamp, folderID)
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

// ReplaceLockHash replaces oldHash, the hash of a folder's lock password,
// with newHash, another hash of the same password. The stamp stays, so
// unlock cookies keep working. A lock from before schema 11 has no stamp
// (its cookies sign the hash) and gets one. When the hash is no longer
// oldHash, because the password changed meanwhile, nothing changes
// (ErrNotFound).
func (s *Store) ReplaceLockHash(folderID int64, oldHash, newHash string) error {
	stamp, err := newStamp()
	if err != nil {
		return err
	}
	return s.execOne(`UPDATE folders SET lock_hash = ?, lock_stamp = COALESCE(lock_stamp, ?) WHERE id = ? AND lock_hash = ?`, newHash, stamp, folderID, oldHash)
}

// RemoveLock takes the folder's own password away. A share left in the
// folder's subtree by an older version, which moved shared folders into
// locked ones without removing the share, is deleted too, so it does not
// come back to life with the lock gone.
func (s *Store) RemoveLock(folderID int64) error {
	return s.withTx(func(tx *sql.Tx) error {
		res, err := tx.Exec(`UPDATE folders SET lock_hash = NULL, lock_stamp = NULL WHERE id = ?`, folderID)
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

// underLock reports whether the folder or one of its parents has a lock.
func underLock(q querier, folderID int64) (bool, error) {
	var n int
	err := q.QueryRow(`WITH RECURSIVE up(id, depth) AS (
		SELECT ?, 0 UNION ALL SELECT f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.id
		WHERE f.parent_id IS NOT NULL AND up.depth < 1000)
		SELECT COUNT(*) FROM folders WHERE id IN (SELECT id FROM up) AND lock_hash IS NOT NULL`, folderID).Scan(&n)
	return n > 0, err
}
