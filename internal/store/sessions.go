package store

import (
	"database/sql"
	"errors"
	"time"
)

// CreateSession stores a hashed session token.
func (s *Store) CreateSession(tokenHash string, expires time.Time) error {
	_, err := s.db.Exec(`INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)`, tokenHash, expires.Unix())
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

// SessionValid reports whether the hashed token exists and has not expired.
func (s *Store) SessionValid(tokenHash string) bool {
	exp, ok := s.SessionExpiry(tokenHash)
	return ok && exp.Unix() > s.now()
}

// ExtendSession moves the session's expiry.
func (s *Store) ExtendSession(tokenHash string, expires time.Time) error {
	return s.execOne(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`, expires.Unix(), tokenHash)
}

// DeleteSession removes a session.
func (s *Store) DeleteSession(tokenHash string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

// PurgeSessions removes expired sessions.
func (s *Store) PurgeSessions() error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, s.now())
	return err
}

const passwordSetting = "password_hmac"

// SyncPasswordFingerprint compares the fingerprint of the app password with
// the one stored at the last start. When it differs, every session is
// deleted (API tokens stay) and the new fingerprint is stored. The first
// start with this check only stores it. changed reports a real change.
func (s *Store) SyncPasswordFingerprint(fingerprint string) (changed bool, err error) {
	err = s.withTx(func(tx *sql.Tx) error {
		var old string
		err := tx.QueryRow(`SELECT value FROM settings WHERE key = ?`, passwordSetting).Scan(&old)
		switch {
		case err == nil && old == fingerprint:
			return nil
		case err == nil:
			changed = true
			if _, err := tx.Exec(`DELETE FROM sessions`); err != nil {
				return err
			}
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
		_, err = tx.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, passwordSetting, fingerprint)
		return err
	})
	return changed, err
}
