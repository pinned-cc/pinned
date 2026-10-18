package auth

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPasswordOK(t *testing.T) {
	if !PasswordOK("secret", "secret") || PasswordOK("secret", "Secret") || PasswordOK("secret", "") {
		t.Error("password compare wrong")
	}
}

func TestTokens(t *testing.T) {
	a, _ := NewToken()
	b, _ := NewToken()
	if a == b || len(a) != 43 {
		t.Errorf("tokens %q %q", a, b)
	}
	h1, h2 := HashToken([]byte("k"), a), HashToken([]byte("k"), a)
	if h1 == a || h1 != h2 || HashToken([]byte("other"), a) == h1 {
		t.Error("hash wrong")
	}
}

func TestPasswordFingerprint(t *testing.T) {
	k := []byte("0123456789abcdef0123456789abcdef")
	a := PasswordFingerprint(k, "first password")
	if a != PasswordFingerprint(k, "first password") || a == PasswordFingerprint(k, "second password") || strings.Contains(a, "first") {
		t.Error("fingerprint wrong")
	}
}

func TestLoadSecretIsStable(t *testing.T) {
	dir := t.TempDir()
	a, err := LoadSecret(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := LoadSecret(dir)
	if !bytes.Equal(a, b) || len(a) != 32 {
		t.Error("secret changed between loads")
	}
}

func TestLoadSecretRefusesShortFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret.key")
	os.WriteFile(path, []byte("short"), 0o600)
	if _, err := LoadSecret(dir); err == nil || !strings.Contains(err.Error(), "needs at least 32") {
		t.Fatalf("want an error for a short key, got %v", err)
	}
	if b, _ := os.ReadFile(path); string(b) != "short" {
		t.Error("short key file was replaced")
	}
}

func TestLimiter(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiter()
	l.Now = func() time.Time { return now }
	for i := 0; i < 4; i++ {
		if wait := l.Fail("a"); wait != 0 {
			t.Fatalf("blocked after %d failures", i+1)
		}
	}
	if wait := l.Fail("a"); wait != 30*time.Second {
		t.Fatalf("want 30 s wait after 5 failures, got %v", wait)
	}
	now = now.Add(10 * time.Second)
	if wait := l.Fail("a"); wait != 20*time.Second {
		t.Fatalf("failure during the wait: %v", wait)
	}
	if wait := l.Fail("b"); wait != 0 {
		t.Error("other client blocked")
	}
	now = now.Add(21 * time.Second)
	if wait := l.Fail("a"); wait != 0 {
		t.Error("count should restart after the wait")
	}
	l.Success("a")
	if _, ok := l.clients["a"]; ok {
		t.Error("success should clear")
	}
	now = now.Add(2 * time.Hour)
	l.Fail("c")
	if len(l.clients) != 1 {
		t.Errorf("quiet clients not forgotten: %d", len(l.clients))
	}
}

func TestLimiterGlobalCap(t *testing.T) {
	now := time.Unix(1000, 0)
	l := NewLimiter()
	l.Now = func() time.Time { return now }
	// Many addresses, each under its own limit.
	for i := 0; i < GlobalMaxFails-1; i++ {
		if wait := l.Fail(fmt.Sprintf("10.0.%d.%d", i/250, i%250)); wait != 0 {
			t.Fatalf("blocked after %d spread failures", i+1)
		}
		now = now.Add(time.Second)
	}
	if wait := l.Fail("fresh"); wait <= 0 {
		t.Fatal("global cap not reached")
	}
	if done, wait := l.Begin(context.Background(), "another"); done != nil || wait <= 0 {
		t.Fatal("a new client may check past the global cap")
	}
	// Once the oldest failures leave the window, checks run again.
	now = now.Add(GlobalWindow - time.Duration(GlobalMaxFails-5)*time.Second)
	done, wait := l.Begin(context.Background(), "another")
	if done == nil || wait != 0 {
		t.Fatalf("still blocked after the window moved: %v", wait)
	}
	done()
	if len(l.slots) != 0 {
		t.Error("slot not released")
	}
}
