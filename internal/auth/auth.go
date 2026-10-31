// Package auth holds the password check, session tokens and the failure
// counter behind the rate limits.
package auth

import (
	"context"
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

	"golang.org/x/crypto/bcrypt"
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

// PasswordFingerprint is an HMAC of the app password, kept in memory to sign
// device cookies. Versions before 0.1.11 stored it as password_hmac; it is
// still read once to move that record to a bcrypt hash.
func PasswordFingerprint(secret []byte, password string) string {
	return HashToken(secret, "app-password\x00"+password)
}

// BcryptCost is the cost of new bcrypt hashes. A stored hash with a lower
// cost is replaced at its next successful check.
var BcryptCost = bcrypt.DefaultCost

// HashPassword returns a bcrypt hash of password at BcryptCost. It fails
// for a password longer than 72 bytes.
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	return string(h), err
}

// AppPasswordKey is what the stored hash of the app password is made from:
// the SHA-256 of the password in hex. It is 64 bytes for a password of any
// length, so an app password longer than bcrypt's 72 bytes still works.
func AppPasswordKey(password string) string {
	sum := sha256.Sum256([]byte(password))
	return hex.EncodeToString(sum[:])
}

// HashAppPassword returns the bcrypt hash kept for the app password.
func HashAppPassword(password string) (string, error) { return HashPassword(AppPasswordKey(password)) }

// CheckAppPassword is CheckPasswordHash for the app password's stored hash.
func CheckAppPassword(hash, password string) (ok, rehash bool) {
	return CheckPasswordHash(hash, AppPasswordKey(password))
}

// CheckPasswordHash reports whether password matches the bcrypt hash, and
// whether the hash should be replaced because its cost is below BcryptCost.
func CheckPasswordHash(hash, password string) (ok, rehash bool) {
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return false, false
	}
	cost, err := bcrypt.Cost([]byte(hash))
	return true, err == nil && cost < BcryptCost
}

// LoadSecret reads DATA_DIR/secret.key, creating it with 32 random bytes the
// first time. A file that exists but is too short is an error: replacing it
// would sign out every session and break every token without a word.
func LoadSecret(dataDir string) ([]byte, error) {
	path := filepath.Join(dataDir, "secret.key")
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) < SecretSize {
			return nil, fmt.Errorf("%s holds %d bytes, it needs at least %d; restore it from a backup, or delete it to start over (this signs out every session, revokes every API token, and folder and share passwords must be set again)", path, len(b), SecretSize)
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
// client waits Wait; when the wait is over the count starts again. During the
// wait no check runs at all, so not even the right password gets in. Checks
// from one client run one at a time, and past GlobalMaxFails failures in
// GlobalWindow across all clients everyone waits, which slows a guesser that
// spreads over many addresses.
//
// The global cap would also stop the owner, so a client the caller knows
// (a browser holding a device cookie from an earlier login) checks with
// BeginKnown and FailKnown: only its own count applies to it, and its
// failures do not count toward the cap.
type Limiter struct {
	mu      sync.Mutex
	clients map[string]*attempts
	slots   map[string]*slot
	global  []time.Time // failures inside GlobalWindow, oldest first
	Now     func() time.Time
}

type attempts struct {
	fails int
	until time.Time
	last  time.Time
}

// slot lets one check per client run; users counts who holds or waits for
// it, so it can be dropped when the last one is done.
type slot struct {
	ch    chan struct{}
	users int
}

const (
	MaxFails       = 5
	Wait           = 30 * time.Second
	GlobalMaxFails = 100
	GlobalWindow   = 10 * time.Minute
)

func NewLimiter() *Limiter {
	return &Limiter{clients: map[string]*attempts{}, slots: map[string]*slot{}, Now: time.Now}
}

// Begin starts a check for client. While the client, or everyone, has to
// wait it returns the wait and no check may run. Otherwise it returns done,
// which the caller calls once the check and its Fail or Success are over;
// until then other checks from the same client queue here. done is nil with
// a zero wait when ctx ends while queued.
func (l *Limiter) Begin(ctx context.Context, client string) (done func(), wait time.Duration) {
	return l.begin(ctx, client, false)
}

// BeginKnown is Begin for a known client: the global cap does not apply.
func (l *Limiter) BeginKnown(ctx context.Context, client string) (done func(), wait time.Duration) {
	return l.begin(ctx, client, true)
}

func (l *Limiter) begin(ctx context.Context, client string, known bool) (done func(), wait time.Duration) {
	if wait := l.waiting(client, known); wait > 0 {
		return nil, wait
	}
	l.mu.Lock()
	sl := l.slots[client]
	if sl == nil {
		sl = &slot{ch: make(chan struct{}, 1)}
		l.slots[client] = sl
	}
	sl.users++
	l.mu.Unlock()
	leave := func() {
		l.mu.Lock()
		if sl.users--; sl.users == 0 {
			delete(l.slots, client)
		}
		l.mu.Unlock()
	}
	select {
	case sl.ch <- struct{}{}:
	case <-ctx.Done():
		leave()
		return nil, 0
	}
	release := func() {
		<-sl.ch
		leave()
	}
	// The check queued before this one may have started the wait.
	if wait := l.waiting(client, known); wait > 0 {
		release()
		return nil, wait
	}
	return release, 0
}

func (l *Limiter) waiting(client string, known bool) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	var wait time.Duration
	if a := l.clients[client]; a != nil && now.Before(a.until) {
		wait = a.until.Sub(now)
	}
	if known {
		return wait
	}
	return max(wait, l.globalWait(now))
}

// globalWait drops failures older than GlobalWindow and returns how long
// until the oldest one leaves it, zero while under the cap.
func (l *Limiter) globalWait(now time.Time) time.Duration {
	cut := 0
	for cut < len(l.global) && now.Sub(l.global[cut]) >= GlobalWindow {
		cut++
	}
	l.global = l.global[cut:]
	if len(l.global) < GlobalMaxFails {
		return 0
	}
	return l.global[0].Add(GlobalWindow).Sub(now)
}

// Fail records a failed check for client and returns how long the client
// has to wait now, zero while it is under the limit.
func (l *Limiter) Fail(client string) time.Duration { return l.fail(client, false) }

// FailKnown is Fail for a known client: the failure does not count toward
// the global cap, and the wait returned is the client's own.
func (l *Limiter) FailKnown(client string) time.Duration { return l.fail(client, true) }

func (l *Limiter) fail(client string, known bool) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	l.forgetOld(now)
	var gw time.Duration
	if !known {
		if len(l.global) < GlobalMaxFails {
			l.global = append(l.global, now)
		}
		gw = l.globalWait(now)
	}
	a := l.clients[client]
	if a == nil {
		a = &attempts{}
		l.clients[client] = a
	}
	if now.Before(a.until) {
		a.last = now
		return max(a.until.Sub(now), gw)
	}
	if !a.until.IsZero() {
		// The wait is over: start counting again.
		*a = attempts{}
	}
	a.fails++
	a.last = now
	if a.fails >= MaxFails {
		a.until = now.Add(Wait)
		return max(Wait, gw)
	}
	return gw
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
