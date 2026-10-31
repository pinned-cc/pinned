package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	_ "embed" // the list of common passwords
	"encoding/base64"
	"strings"
	"sync"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

// commonList is 10000 common passwords of 8 characters or more, one per
// line, in lower case: the first 10000 such entries of
// xato-net-10-million-passwords-100000.txt from SecLists (MIT licence, see
// docs/security.md). The app never sends a password anywhere to check it.
//
//go:embed common-passwords.txt
var commonList string

var commonSet = sync.OnceValue(func() map[string]struct{} {
	m := make(map[string]struct{}, 10000)
	for _, line := range strings.Split(commonList, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			m[line] = struct{}{}
		}
	}
	return m
})

// contextWords are refused on their own, with digits or symbols around
// them, in leet spelling (p@ssw0rd) and joined to one another.
var contextWords = []string{"pinned", "bookmarks", "bookmark", "password", "passwort", "passwd"}

// hostStopWords are parts of host names too general to refuse.
var hostStopWords = map[string]bool{"www": true, "local": true, "localhost": true, "home": true, "lan": true, "com": true, "net": true, "org": true}

// HostWords returns the parts of host names (pinned.example.com:8080 gives
// pinned and example) to pass to CommonPassword as context words.
func HostWords(hosts ...string) []string {
	var out []string
	for _, h := range hosts {
		h = strings.ToLower(h)
		if i := strings.LastIndex(h, ":"); i >= 0 && !strings.Contains(h[i:], "]") {
			h = h[:i]
		}
		for _, part := range strings.FieldsFunc(h, func(r rune) bool { return r == '.' || r == '-' || r == '_' }) {
			if w := lettersOnly(part); len(w) >= 4 && !hostStopWords[w] {
				out = append(out, w)
			}
		}
	}
	return out
}

// CommonPassword reports whether pw is too easy to guess: one of the
// embedded common passwords, compared without case, or made only of
// context words (the app's own words and the extra ones given, such as
// HostWords) with digits and symbols.
func CommonPassword(pw string, extra ...string) bool {
	lower := strings.ToLower(pw)
	if _, ok := commonSet()[strings.TrimSpace(lower)]; ok {
		return true
	}
	words := append([]string{}, contextWords...)
	for _, w := range extra {
		if w = lettersOnly(strings.ToLower(w)); len(w) >= 4 {
			words = append(words, w)
		}
	}
	// Longer words first, so bookmarks goes before bookmark.
	for i := 1; i < len(words); i++ {
		for j := i; j > 0 && len(words[j]) > len(words[j-1]); j-- {
			words[j], words[j-1] = words[j-1], words[j]
		}
	}
	trimmed := strings.TrimFunc(lower, func(r rune) bool { return !unicode.IsLetter(r) })
	for _, c := range []string{lettersOnly(lower), lettersOnly(unleet(trimmed))} {
		if c != "" && onlyWords(c, words) {
			return true
		}
	}
	return false
}

// onlyWords reports whether s is nothing but the words, repeated or joined.
func onlyWords(s string, words []string) bool {
	for {
		before := s
		for _, w := range words {
			s = strings.ReplaceAll(s, w, "")
		}
		if s == "" {
			return true
		}
		if s == before {
			return false
		}
	}
}

func lettersOnly(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) {
			return r
		}
		return -1
	}, s)
}

var leet = strings.NewReplacer("0", "o", "1", "i", "3", "e", "4", "a", "@", "a", "$", "s", "5", "s", "7", "t", "!", "i")

func unleet(s string) string { return leet.Replace(s) }

// keyedPrefix marks a stored lock or share password hash made from
// KeyedPasswordKey. A hash without it is bcrypt over the password itself,
// from before 0.1.11.
const keyedPrefix = "k1:"

// KeyedPasswordKey is what the stored hash of a lock or share password is
// made from: the HMAC-SHA256 of the password under secret.key, base64
// encoded. It is 44 bytes for a password of any length, so bcrypt's 72
// byte limit no longer cuts or refuses long passwords.
func KeyedPasswordKey(secret []byte, password string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte("password\x00"))
	m.Write([]byte(password))
	return base64.StdEncoding.EncodeToString(m.Sum(nil))
}

// HashKeyedPassword returns the hash kept for a lock or share password.
func HashKeyedPassword(secret []byte, password string) (string, error) {
	h, err := HashPassword(KeyedPasswordKey(secret, password))
	if err != nil {
		return "", err
	}
	return keyedPrefix + h, nil
}

// CheckKeyedPassword checks a lock or share password against its stored
// hash. A hash from before 0.1.11 is checked the old way and, when it
// matches, rehash is true so the caller stores a new one. A password over
// 72 bytes never matches an old hash: bcrypt would compare only its first
// 72 bytes, and such a password could not be set then.
func CheckKeyedPassword(secret []byte, hash, password string) (ok, rehash bool) {
	if h, keyed := strings.CutPrefix(hash, keyedPrefix); keyed {
		return CheckPasswordHash(h, KeyedPasswordKey(secret, password))
	}
	if len(password) > 72 {
		return false, false
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return false, false
	}
	return true, true
}

// KeyedHash reports whether a stored hash is in the current form.
func KeyedHash(hash string) bool { return strings.HasPrefix(hash, keyedPrefix) }
