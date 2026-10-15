// Package auth holds the password check, session tokens and the failure
// counter behind the rate limits.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// SecretSize is the length of DATA_DIR/secret.key in bytes.
const SecretSize = 32

// PasswordOK compares in constant time. Both sides are hashed first so the
// comparison does not leak the password length either.
func PasswordOK(want, got string) bool {
	a := sha256.Sum256([]byte(want))
	b := sha256.Sum256([]byte(got))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// NewToken returns 32 random bytes, URL safe base64 encoded, for the cookie.
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken is what the database stores instead of the token itself.
func HashToken(secret []byte, token string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(token))
	return hex.EncodeToString(m.Sum(nil))
}

// PasswordFingerprint is an HMAC of the app password. It is stored so a
// restart can tell that APP_PASSWORD changed, without storing the password.
func PasswordFingerprint(secret []byte, password string) string {
	return HashToken(secret, "app-password\x00"+password)
}

// LoadSecret reads DATA_DIR/secret.key, creating it with 32 random bytes the
// first time. A file that exists but is too short is an error: replacing it
// would sign out every session and break every token without a word.
func LoadSecret(dataDir string) ([]byte, error) {
	path := filepath.Join(dataDir, "secret.key")
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) < SecretSize {
			return nil, fmt.Errorf("%s holds %d bytes, it needs at least %d; restore it from a backup, or delete it to start over (this signs out every session and revokes every API token)", path, len(b), SecretSize)
		}
		return b, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	b = make([]byte, SecretSize)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return nil, err
	}
	return b, nil
}

// Limiter counts failed checks per client. After MaxFails failures the
// client waits Wait; when the wait is over the count starts again. Only
// failures count: a correct password or a valid token is never refused.
type Limiter struct {
	mu      sync.Mutex
	clients map[string]*attempts
	Now     func() time.Time
}

type attempts struct {
	fails int
	until time.Time
	last  time.Time
}

const (
	MaxFails = 5
	Wait     = 30 * time.Second
)

func NewLimiter() *Limiter {
	return &Limiter{clients: map[string]*attempts{}, Now: time.Now}
}

// Fail records a failed check for client and returns how long the client
// has to wait now, zero while it is under the limit.
func (l *Limiter) Fail(client string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	l.forgetOld(now)
	a := l.clients[client]
	if a == nil {
		a = &attempts{}
		l.clients[client] = a
	}
	if now.Before(a.until) {
		a.last = now
		return a.until.Sub(now)
	}
	if !a.until.IsZero() {
		// The wait is over: start counting again.
		*a = attempts{}
	}
	a.fails++
	a.last = now
	if a.fails >= MaxFails {
		a.until = now.Add(Wait)
		return Wait
	}
	return 0
}

// Success clears the client's failures.
func (l *Limiter) Success(client string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.clients, client)
}

// forgetOld drops clients that have been quiet for an hour, so the map
// cannot grow without bound.
func (l *Limiter) forgetOld(now time.Time) {
	for k, a := range l.clients {
		if now.Sub(a.last) > time.Hour && now.After(a.until) {
			delete(l.clients, k)
		}
	}
}
