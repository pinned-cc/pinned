package store

import (
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"
)

// Token is an API token: a name and a hash. The value itself is never stored.
type Token struct {
	ID         int64
	Name       string
	CreatedAt  int64
	LastUsedAt *int64
	// Origin is the browser extension origin the token is bound to, set at
	// its first use from an extension; nil until then.
	Origin *string
}

const maxTokenName = 80

const tokenCols = `id, name, created_at, last_used_at, origin`

func scanToken(sc scanner) (Token, error) {
	var t Token
	var last sql.NullInt64
	var origin sql.NullString
	err := sc.Scan(&t.ID, &t.Name, &t.CreatedAt, &last, &origin)
	if last.Valid {
		t.LastUsedAt = &last.Int64
	}
	if origin.Valid {
		t.Origin = &origin.String
	}
	return t, err
}

// BindTokenOrigin binds the token to origin unless it is bound already,
// and returns the origin it is bound to now.
func (s *Store) BindTokenOrigin(id int64, origin string) (string, error) {
	var bound string
	err := s.withTx(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE tokens SET origin = ? WHERE id = ? AND origin IS NULL`, origin, id); err != nil {
			return err
		}
		err := tx.QueryRow(`SELECT origin FROM tokens WHERE id = ?`, id).Scan(&bound)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	return bound, err
}

// CreateToken stores a new token under its hash.
func (s *Store) CreateToken(name, hash string) (Token, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Token{}, ErrEmptyName
	}
	if utf8.RuneCountInString(name) > maxTokenName {
		name = string([]rune(name)[:maxTokenName])
	}
	now := s.now()
	res, err := s.exec(`INSERT INTO tokens (name, hash, created_at) VALUES (?, ?, ?)`, name, hash, now)
	if err != nil {
		return Token{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Token{}, err
	}
	return Token{ID: id, Name: name, CreatedAt: now}, nil
}

// Tokens lists every token, newest first.
func (s *Store) Tokens() ([]Token, error) {
	rows, err := s.db.Query(`SELECT ` + tokenCols + ` FROM tokens ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Token{}
	for rows.Next() {
		t, err := scanToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TokenByHash finds the token with this hash.
func (s *Store) TokenByHash(hash string) (Token, error) {
	t, err := scanToken(s.db.QueryRow(`SELECT `+tokenCols+` FROM tokens WHERE hash = ?`, hash))
	if errors.Is(err, sql.ErrNoRows) {
		return Token{}, ErrNotFound
	}
	return t, err
}

// TouchToken records a use of the token.
func (s *Store) TouchToken(id int64) error {
	_, err := s.exec(`UPDATE tokens SET last_used_at = ? WHERE id = ?`, s.now(), id)
	return err
}

// DeleteToken revokes a token.
func (s *Store) DeleteToken(id int64) error {
	res, err := s.exec(`DELETE FROM tokens WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
