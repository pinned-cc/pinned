package store

import (
	"database/sql"
	"errors"
	"time"
)

// CreateSession stores a hashed session token.
func (s *Store) CreateSession(tokenHash string, expires time.Time) error {
	_, err := s.exec(`INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)`, tokenHash, expires.Unix())
	return err
}

// SessionExpiry returns when the session with this hashed token expires.
// ok is false when there is no such session.
func (s *Store) SessionExpiry(tokenHash string) (expires time.Time, ok bool) {
	var exp int64
	if err := s.db.QueryRow(`SELECT expires_at FROM sessions WHERE token_hash = ?`, tokenHash).Scan(&exp); err != nil {
		return time.Time{}, false
	}
	return time.Unix(exp, 0), true
}

// ExtendSession moves the session's expiry.
func (s *Store) ExtendSession(tokenHash string, expires time.Time) error {
	return s.execOne(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`, expires.Unix(), tokenHash)
}

// DeleteSession removes a session.
func (s *Store) DeleteSession(tokenHash string) error {
	_, err := s.exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

// PurgeSessions removes expired sessions.
func (s *Store) PurgeSessions() error {
	_, err := s.exec(`DELETE FROM sessions WHERE expires_at <= ?`, s.now())
	return err
}

// The app password is kept as a bcrypt hash under passwordSetting. Versions
// before 0.1.11 kept an HMAC under legacyPasswordSetting, which the first
// start of a newer version reads once and replaces.
const (
	passwordSetting       = "password_hash"
	legacyPasswordSetting = "password_hmac"
)

// SyncPassword compares the app password with the record stored at the last
// start. check tells whether a stored value belongs to the current password
// (legacy is true for the old HMAC record) and whether it should be
// replaced; hash makes a new record. When the password differs, every
// session and every API token is deleted and changed is true. The first start only stores the
// record. A legacy record is always replaced by a hash.
func (s *Store) SyncPassword(check func(stored string, legacy bool) (same, rehash bool), hash func() (string, error)) (changed bool, err error) {
	err = s.withTx(func(tx *sql.Tx) error {
		found, same, rehash := false, false, false
		for _, key := range []string{passwordSetting, legacyPasswordSetting} {
			var v string
			err := tx.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			found = true
			same, rehash = check(v, key == legacyPasswordSetting)
			rehash = rehash || key == legacyPasswordSetting
			break
		}
		if found && same && !rehash {
			return nil
		}
		if found && !same {
			changed = true
			if _, err := tx.Exec(`DELETE FROM sessions; DELETE FROM tokens`); err != nil {
				return err
			}
		}
		h, err := hash()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM settings WHERE key = ?`, legacyPasswordSetting); err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, passwordSetting, h)
		return err
	})
	return changed, err
}
