package auth

import (
	"strings"
	"testing"
	"time"
)

// The SHA-1 test vectors of RFC 6238, appendix B: the key is the ASCII
// string "12345678901234567890" and the codes have 8 digits.
func TestTOTPVectors(t *testing.T) {
	key := []byte("12345678901234567890")
	for _, v := range []struct {
		unix int64
		code string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
		{20000000000, "65353130"},
	} {
		if got := hotp(key, uint64(v.unix/30), 8); got != v.code {
			t.Errorf("T=%d: %s, want %s", v.unix, got, v.code)
		}
		// The 6 digit code is the last six digits of the same number.
		if got := hotp(key, uint64(v.unix/30), 6); got != v.code[2:] {
			t.Errorf("T=%d, 6 digits: %s, want %s", v.unix, got, v.code[2:])
		}
	}
}

func TestTOTPDriftAndOneUse(t *testing.T) {
	key := []byte("12345678901234567890")
	now := time.Unix(1111111111, 0)
	tp := NewTOTP(key)
	tp.Now = func() time.Time { return now }
	step := now.Unix() / 30
	code := func(s int64) string { return hotp(key, uint64(s), 6) }
	for _, d := range []int64{-1, 0, 1} {
		if s, ok := tp.Match(code(step + d)); !ok || s != step+d {
			t.Errorf("drift %d refused", d)
		}
	}
	for _, d := range []int64{-2, 2} {
		if _, ok := tp.Match(code(step + d)); ok {
			t.Errorf("drift %d accepted", d)
		}
	}
	if _, ok := tp.Match("12345"); ok {
		t.Error("five digits accepted")
	}
	if s, ok := tp.Match(" " + code(step)[:3] + " " + code(step)[3:]); !ok || s != step {
		t.Error("a code with spaces refused")
	}
	// Each code once, and never an older one after a newer one.
	if !tp.Use(step) || tp.Use(step) || tp.Use(step-1) || !tp.Use(step+1) {
		t.Error("a code was accepted twice")
	}
}

func TestParseTOTPSecret(t *testing.T) {
	key, err := ParseTOTPSecret("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")
	if err != nil || string(key) != "12345678901234567890" {
		t.Errorf("key %q, %v", key, err)
	}
	if _, err := ParseTOTPSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ===="); err != nil {
		t.Errorf("padding: %v", err)
	}
	if _, err := ParseTOTPSecret("JBSWY3DPEHPK3PXP"); err == nil || !strings.Contains(err.Error(), "at least 16") {
		t.Errorf("80 bit key: %v", err)
	}
	if _, err := ParseTOTPSecret("not base32 at all!"); err == nil {
		t.Error("junk accepted")
	}
}
