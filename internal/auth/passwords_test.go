package auth

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestCommonListIsEmbedded(t *testing.T) {
	if n := len(commonSet()); n < 9900 {
		t.Fatalf("the list holds %d passwords", n)
	}
	for w := range commonSet() {
		if len(w) < 8 || w != strings.ToLower(w) {
			t.Fatalf("entry %q is short or not lower case", w)
		}
	}
}

func TestCommonPassword(t *testing.T) {
	host := HostWords("links.halftone.example:8443", "127.0.0.1:9098", "[::1]:8080", "www.home.lan")
	refused := []string{
		"password", "PASSWORD", "Password1", "12345678", "iloveyou", "QwErTyUiOp", "sunshine",
		"pinned", "Pinned123", "pinned-pinned", "bookmarks!", "bookmark-bookmark?", "p@ssw0rd", "P@SSW0RD!",
		"passwort2026", "pinnedpassword", "2026pinned", "halftone", "Halftone99", "links-halftone",
	}
	for _, pw := range refused {
		if !CommonPassword(pw, host...) {
			t.Errorf("%q passed", pw)
		}
	}
	allowed := []string{
		"correct horse battery", "s3cret-lock", "pinned to the wall", "bookmark the moon", "Grüezi mitenand", "日本語のパスワード",
		strings.Repeat("ab", 50), "lockpw-ui", "ui-test-password", "www.home.lan",
	}
	for _, pw := range allowed {
		if CommonPassword(pw, host...) {
			t.Errorf("%q refused", pw)
		}
	}
	if got := HostWords("links.halftone.example:8443", "www.home.lan", "127.0.0.1"); strings.Join(got, ",") != "links,halftone,example" {
		t.Errorf("host words %v", got)
	}
}

func TestKeyedPasswordHashes(t *testing.T) {
	old := BcryptCost
	BcryptCost = bcrypt.MinCost
	defer func() { BcryptCost = old }()
	secret := []byte(strings.Repeat("k", SecretSize))
	for _, pw := range []string{"short pw", strings.Repeat("x", 100), strings.Repeat("ä", 64), "日本語のパスワードです"} {
		h, err := HashKeyedPassword(secret, pw)
		if err != nil || !KeyedHash(h) {
			t.Fatalf("%q: %q %v", pw, h, err)
		}
		if ok, rehash := CheckKeyedPassword(secret, h, pw); !ok || rehash {
			t.Errorf("%q: ok %v rehash %v", pw, ok, rehash)
		}
		if ok, _ := CheckKeyedPassword(secret, h, pw+"x"); ok {
			t.Errorf("%q: a longer guess matched", pw)
		}
		if ok, _ := CheckKeyedPassword([]byte(strings.Repeat("o", SecretSize)), h, pw); ok {
			t.Errorf("%q: matched under another secret", pw)
		}
	}
	// A 100 character password differs from one sharing its first 72 bytes.
	a, b := strings.Repeat("a", 72)+"one", strings.Repeat("a", 72)+"two"
	h, _ := HashKeyedPassword(secret, a)
	if ok, _ := CheckKeyedPassword(secret, h, b); ok {
		t.Error("only the first 72 bytes were compared")
	}
	// An old hash opens and asks for a new one; a longer guess does not.
	raw, _ := bcrypt.GenerateFromPassword([]byte("abcd"), bcrypt.MinCost)
	if ok, rehash := CheckKeyedPassword(secret, string(raw), "abcd"); !ok || !rehash {
		t.Errorf("old hash: ok %v rehash %v", ok, rehash)
	}
	if ok, _ := CheckKeyedPassword(secret, string(raw), "abce"); ok {
		t.Error("old hash matched a wrong password")
	}
	full := strings.Repeat("y", 72)
	raw, _ = bcrypt.GenerateFromPassword([]byte(full), bcrypt.MinCost)
	if ok, _ := CheckKeyedPassword(secret, string(raw), full+"xyz"); ok {
		t.Error("old hash matched a guess past 72 bytes")
	}
}
