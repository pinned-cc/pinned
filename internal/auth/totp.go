package auth

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// TOTP checks the one-time codes of RFC 6238 that an authenticator app
// shows: HMAC-SHA1, 6 digits, 30 second steps, with one step of clock drift
// allowed either way. A code is accepted once: after a login with the code
// of one step, codes of that step and of earlier steps are refused.
type TOTP struct {
	key  []byte
	mu   sync.Mutex
	last int64 // the step of the last code used
	// Now returns the current time. Tests replace it.
	Now func() time.Time
}

const (
	totpDigits = 6
	totpStep   = 30 // seconds
	totpDrift  = 1  // steps either way
	// MinTOTPSecret is the shortest secret accepted, in bytes: RFC 4226
	// asks for at least 128 bits.
	MinTOTPSecret = 16
)

// ParseTOTPSecret decodes a base32 secret as authenticator apps take it.
// Case, spaces and padding do not matter.
func ParseTOTPSecret(s string) ([]byte, error) {
	s = strings.ToUpper(strings.Join(strings.Fields(s), ""))
	s = strings.TrimRight(s, "=")
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(s)
	if err != nil {
		return nil, errors.New("it is not base32 (letters A to Z and digits 2 to 7)")
	}
	if len(key) < MinTOTPSecret {
		return nil, fmt.Errorf("it holds %d bytes, it needs at least %d (%d base32 characters)", len(key), MinTOTPSecret, (MinTOTPSecret*8+4)/5)
	}
	return key, nil
}

// NewTOTP checks codes for key.
func NewTOTP(key []byte) *TOTP {
	return &TOTP{key: key, last: -1, Now: time.Now}
}

// hotp is the code of RFC 4226 for counter, with digits digits.
func hotp(key []byte, counter uint64, digits int) string {
	m := hmac.New(sha1.New, key)
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	m.Write(msg[:])
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	mod := uint32(1)
	for range digits {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, bin%mod)
}

// Match reports whether code is the code of the current step or one step
// either side, and of which step. It does not use the code up: call Use
// once the whole login has passed, so a guess without the password
// cannot burn the owner's code.
func (t *TOTP) Match(code string) (step int64, ok bool) {
	code = strings.Join(strings.Fields(code), "")
	if len(code) != totpDigits {
		return 0, false
	}
	now := t.Now().Unix() / totpStep
	for d := int64(-totpDrift); d <= totpDrift; d++ {
		s := now + d
		if s < 0 {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(hotp(t.key, uint64(s), totpDigits)), []byte(code)) == 1 {
			step, ok = s, true
		}
	}
	return step, ok
}

// Use marks the code of step as used. It returns false when that code, or
// a later one, was used already.
func (t *TOTP) Use(step int64) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if step <= t.last {
		return false
	}
	t.last = step
	return true
}
