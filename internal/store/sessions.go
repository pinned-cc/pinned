package store

import (
	"database/sql"
	"errors"
	"time"
)

// Session is a signed in browser. The token itself is never stored, only
// its hash; ID is the row id, for listing and ending a session.
type Session struct {
	ID        int64
	Agent     string // a short browser name taken at login
	CreatedAt int64  // the login; the absolute lifetime counts from here
	UsedAt    int64  // last use, updated at most once an hour
	ExpiresAt int64
}

// CreateSession stores a hashed session token.
func (s *Store) CreateSession(tokenHash, agent string, expires time.Time) error {
	now := s.now()
	_, err := s.exec(`INSERT INTO sessions (token_hash, expires_at, created_at, used_at, agent) VALUES (?, ?, ?, ?, ?)`,
		tokenHash, expires.Unix(), now, now, agent)
	return err
}

const sessionColumns = `rowid, agent, created_at, used_at, expires_at`

func scanSession(sc scanner) (Session, error) {
	var x Session
	err := sc.Scan(&x.ID, &x.Agent, &x.CreatedAt, &x.UsedAt, &x.ExpiresAt)
	return x, err
}

// Session returns the session with this hashed token, expired or not. ok
// is false when there is no such session.
func (s *Store) Session(tokenHash string) (Session, bool) {
	x, err := scanSession(s.db.QueryRow(`SELECT `+sessionColumns+` FROM sessions WHERE token_hash = ?`, tokenHash))
	return x, err == nil
}

// Sessions lists the sessions that have not expired, last used first.
func (s *Store) Sessions() ([]Session, error) {
	rows, err := s.db.Query(`SELECT `+sessionColumns+` FROM sessions WHERE expires_at > ? ORDER BY used_at DESC, rowid DESC`, s.now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		x, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// ExtendSession moves the session's expiry and records a use now.
func (s *Store) ExtendSession(tokenHash string, expires time.Time) error {
	return s.execOne(`UPDATE sessions SET expires_at = ?, used_at = ? WHERE token_hash = ?`, expires.Unix(), s.now(), tokenHash)
}

// DeleteSessionByID ends the session with this row id.
func (s *Store) DeleteSessionByID(id int64) error {
	return s.execOne(`DELETE FROM sessions WHERE rowid = ?`, id)
}

// DeleteOtherSessions ends every session but the one with keepHash and
// returns how many ended.
func (s *Store) DeleteOtherSessions(keepHash string) (int64, error) {
	res, err := s.exec(`DELETE FROM sessions WHERE token_hash != ?`, keepHash)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
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
