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
}

const maxTokenName = 80

func scanToken(sc scanner) (Token, error) {
	var t Token
	var last sql.NullInt64
	err := sc.Scan(&t.ID, &t.Name, &t.CreatedAt, &last)
	if last.Valid {
		t.LastUsedAt = &last.Int64
	}
	return t, err
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
	res, err := s.db.Exec(`INSERT INTO tokens (name, hash, created_at) VALUES (?, ?, ?)`, name, hash, now)
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
	rows, err := s.db.Query(`SELECT id, name, created_at, last_used_at FROM tokens ORDER BY created_at DESC, id DESC`)
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
	t, err := scanToken(s.db.QueryRow(`SELECT id, name, created_at, last_used_at FROM tokens WHERE hash = ?`, hash))
	if errors.Is(err, sql.ErrNoRows) {
		return Token{}, ErrNotFound
	}
	return t, err
}

// TouchToken records a use of the token.
func (s *Store) TouchToken(id int64) error {
	_, err := s.db.Exec(`UPDATE tokens SET last_used_at = ? WHERE id = ?`, s.now(), id)
	return err
}

// DeleteToken revokes a token.
func (s *Store) DeleteToken(id int64) error {
	res, err := s.db.Exec(`DELETE FROM tokens WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
