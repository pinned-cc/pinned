package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"runtime"
	"strings"
	"testing"
	"time"
)

// breachedSHA256 is what tools/breachgen printed for the filter.
const breachedSHA256 = "1c4b19b9ba972834ed9a1eaee5408c71e64980a21514b18d8055892981d30c70"

func TestBreachedFilterIntegrity(t *testing.T) {
	sum := sha256.Sum256([]byte(breachedPart0 + breachedPart1 + breachedPart2 + breachedPart3))
	if got := hex.EncodeToString(sum[:]); got != breachedSHA256 {
		t.Fatalf("filter sha256 %s, breachgen wrote %s", got, breachedSHA256)
	}
	f, err := breachedFilter()
	if err != nil {
		t.Fatal(err)
	}
	if f.n != 1000000 || f.k != 20 {
		t.Fatalf("n %d k %d", f.n, f.k)
	}
	// The false positive rate the filter is built for.
	fp := math.Pow(1-math.Exp(-float64(f.k)*float64(f.n)/float64(f.m)), float64(f.k))
	if fp > 1.1e-6 {
		t.Fatalf("false positive rate %g", fp)
	}
	for _, p := range []string{breachedPart0, breachedPart1, breachedPart2, breachedPart3} {
		if len(p) > 1<<20 {
			t.Fatalf("a part is %d bytes", len(p))
		}
	}
	// Every common password is in the filter (both come from the xato list).
	for w := range commonSet() {
		if !f.has(w) {
			t.Fatalf("%q is in the common list but not the filter", w)
		}
	}
}

func TestBreachedFilterRoundTrip(t *testing.T) {
	words := []string{"correct horse", "tr0ub4dor&3", "zebra-zebra-9"}
	data := BuildBreachedFilter(words, 1e-6)
	n := (len(data) + 2) / 3
	b, err := openBloom(string(data[:n]), string(data[n:2*n]), string(data[2*n:]))
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range words {
		if !b.has(w) {
			t.Errorf("%q missing", w)
		}
	}
	if b.has("not in it at all") {
		t.Error("a word not in the filter was found")
	}
	if _, err := openBloom(string(data[:len(data)-1])); err == nil {
		t.Error("a short filter opened")
	}
	if _, err := openBloom("notafilter" + string(data[10:])); err == nil {
		t.Error("a filter without the magic opened")
	}
}

func TestBreachedPassword(t *testing.T) {
	// From deep in the xato list and from rockyou.txt, none in the common
	// list of 10000.
	breached := []string{"19912609", "1991242408ds", "vasipyx_1985", "Vasi4kina", "soyguapo", "RazorLight",
		"rockyou.com", "sahil,,payam", "  sahetapy  ", "sahiia12"}
	for _, pw := range breached {
		if _, common := commonSet()[NormaliseBreached(pw)]; common {
			t.Fatalf("%q is in the common list, pick another", pw)
		}
		if !BreachedPassword(pw) || !CommonPassword(pw) {
			t.Errorf("%q passed", pw)
		}
	}
	for _, pw := range []string{"correct horse battery", "s3cret-lock", "lockpw-ui", "ui-test-password"} {
		if BreachedPassword(pw) {
			t.Errorf("%q refused", pw)
		}
	}
}

// TestBreachedRandomPasswords checks 100000 random 16 character passwords:
// at a false positive rate of one in a million, none should be refused.
func TestBreachedRandomPasswords(t *testing.T) {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!"
	n := 100000
	if testing.Short() {
		n = 10000
	}
	buf := make([]byte, 16)
	refused := 0
	for i := 0; i < n; i++ {
		if _, err := rand.Read(buf); err != nil {
			t.Fatal(err)
		}
		for j := range buf {
			buf[j] = alphabet[int(buf[j])%len(alphabet)]
		}
		if BreachedPassword(string(buf)) {
			refused++
		}
	}
	if refused > 0 {
		t.Errorf("%d of %d random passwords refused", refused, n)
	}
}

// TestBreachedCost logs what the filter costs: the first check opens it,
// later ones hash the password and read 20 bits.
func TestBreachedCost(t *testing.T) {
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	start := time.Now()
	f, err := openBloom(breachedPart0, breachedPart1, breachedPart2, breachedPart3)
	open := time.Since(start)
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	start = time.Now()
	const checks = 10000
	for i := 0; i < checks; i++ {
		f.has(strings.Repeat("x", i%40+8))
	}
	t.Logf("filter %d bytes; open %v, %d bytes allocated; a check %v",
		bloomHeader+int(f.m/8), open, after.TotalAlloc-before.TotalAlloc, time.Since(start)/checks)
}
