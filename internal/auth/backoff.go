package auth

import (
	"sync"
	"time"
)

// Backoff counts failures of one kind across all clients, with waits that
// grow: the first BackoffFree failures in a row are free, then each one
// starts a wait of BackoffFirst, doubling up to BackoffMax. During a wait
// nothing is checked. A success clears it. It lives in memory only, so a
// restart clears it too.
//
// The login uses it for wrong second factor codes after a right password,
// which only someone who has the password can send: the per client limiter
// alone would let two addresses guess codes all day.
type Backoff struct {
	mu    sync.Mutex
	fails int
	until time.Time
	// Now returns the current time. Tests replace it.
	Now func() time.Time
}

const (
	BackoffFree  = 5
	BackoffFirst = time.Minute
	BackoffMax   = 24 * time.Hour
)

// NewBackoff returns a Backoff with no failures.
func NewBackoff() *Backoff { return &Backoff{Now: time.Now} }

// Waiting returns how long until checks may run again, zero when they may.
func (b *Backoff) Waiting() time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	if now := b.Now(); now.Before(b.until) {
		return b.until.Sub(now)
	}
	return 0
}

// Fail records a failure and returns the wait it starts, zero while the
// failures are still free.
func (b *Backoff) Fail() time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fails++
	if b.fails < BackoffFree {
		return 0
	}
	wait := BackoffFirst
	for i := BackoffFree; i < b.fails && wait < BackoffMax; i++ {
		wait *= 2
	}
	wait = min(wait, BackoffMax)
	b.until = b.Now().Add(wait)
	return wait
}

// Success clears the failures.
func (b *Backoff) Success() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fails, b.until = 0, time.Time{}
}
