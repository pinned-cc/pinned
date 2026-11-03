package auth

import (
	"crypto/sha256"
	_ "embed" // the breached password filter
	"encoding/binary"
	"errors"
	"math"
	"strings"
	"sync"
)

// The breached password filter is a Bloom filter over 1000000 passwords of
// 8 characters or more from public breach lists (SecLists, MIT licence, see
// common-passwords.LICENSE and tools/breachgen). It answers "maybe in the
// list" or "surely not": about one password in a million that is not in the
// list is refused too, and none in the list is let through. It is built into
// the binary in four parts, each under 1 MB, read in place and never copied.
//
//go:embed breached/0.bin
var breachedPart0 string

//go:embed breached/1.bin
var breachedPart1 string

//go:embed breached/2.bin
var breachedPart2 string

//go:embed breached/3.bin
var breachedPart3 string

// BreachedParts is how many files tools/breachgen writes the filter into.
const BreachedParts = 4

// bloomMagic starts the filter. Then come k (the number of probes) and n
// (the number of passwords) as uint32 and m (the number of bits) as uint64,
// little endian, then the m bits.
const bloomMagic = "pinnedbf"

const bloomHeader = len(bloomMagic) + 4 + 4 + 8

// bloom reads a filter held in parts, all of one length but the last.
type bloom struct {
	parts   []string
	partLen uint64
	k       uint32
	n       uint32
	m       uint64
}

func (b *bloom) byteAt(off uint64) byte {
	return b.parts[off/b.partLen][off%b.partLen]
}

// openBloom checks the header and the length of a filter held in parts.
func openBloom(parts ...string) (*bloom, error) {
	total := uint64(0)
	for i, p := range parts {
		if p == "" || (i < len(parts)-1 && len(p) != len(parts[0])) || len(p) > len(parts[0]) {
			return nil, errors.New("breached filter: parts of the wrong length")
		}
		total += uint64(len(p))
	}
	if total < uint64(bloomHeader) {
		return nil, errors.New("breached filter: too short")
	}
	b := &bloom{parts: parts, partLen: uint64(len(parts[0]))}
	var head [bloomHeader]byte
	for i := range head {
		head[i] = b.byteAt(uint64(i))
	}
	if string(head[:len(bloomMagic)]) != bloomMagic {
		return nil, errors.New("breached filter: not a filter")
	}
	b.k = binary.LittleEndian.Uint32(head[8:])
	b.n = binary.LittleEndian.Uint32(head[12:])
	b.m = binary.LittleEndian.Uint64(head[16:])
	if b.k == 0 || b.k > 64 || b.m == 0 || total != uint64(bloomHeader)+(b.m+7)/8 {
		return nil, errors.New("breached filter: header does not match its length")
	}
	return b, nil
}

// bloomProbes gives the k bit positions of a password: double hashing over
// the first 16 bytes of its SHA-256.
func bloomProbes(word string, k uint32, m uint64, each func(bit uint64) bool) bool {
	sum := sha256.Sum256([]byte(word))
	h1 := binary.LittleEndian.Uint64(sum[0:8])
	h2 := binary.LittleEndian.Uint64(sum[8:16]) | 1
	for i := uint64(0); i < uint64(k); i++ {
		if !each((h1 + i*h2) % m) {
			return false
		}
	}
	return true
}

func (b *bloom) has(word string) bool {
	return bloomProbes(word, b.k, b.m, func(bit uint64) bool {
		return b.byteAt(uint64(bloomHeader)+bit/8)&(1<<(bit%8)) != 0
	})
}

// BuildBreachedFilter returns a filter over words, which must already be
// normalised (NormaliseBreached) and without repeats, sized for a false
// positive rate of fp. tools/breachgen writes it into the parts.
func BuildBreachedFilter(words []string, fp float64) []byte {
	n := float64(len(words))
	m := uint64(math.Ceil(-n * math.Log(fp) / (math.Ln2 * math.Ln2)))
	m = (m + 7) / 8 * 8
	k := uint32(math.Round(float64(m) / n * math.Ln2))
	out := make([]byte, bloomHeader+int(m/8))
	copy(out, bloomMagic)
	binary.LittleEndian.PutUint32(out[8:], k)
	binary.LittleEndian.PutUint32(out[12:], uint32(len(words)))
	binary.LittleEndian.PutUint64(out[16:], m)
	bits := out[bloomHeader:]
	for _, w := range words {
		bloomProbes(w, k, m, func(bit uint64) bool {
			bits[bit/8] |= 1 << (bit % 8)
			return true
		})
	}
	return out
}

// NormaliseBreached is how a password is compared with the breached list:
// lower case, without spaces around it, the same as the common list.
func NormaliseBreached(pw string) string { return strings.TrimSpace(strings.ToLower(pw)) }

// breachedFilter opens the embedded filter once, at the first password
// check. Opening reads only its header; the bits stay where the binary
// holds them.
var breachedFilter = sync.OnceValues(func() (*bloom, error) {
	return openBloom(breachedPart0, breachedPart1, breachedPart2, breachedPart3)
})

// BreachedPassword reports whether pw is, compared without case, one of
// the breached passwords in the embedded filter. A filter that does not
// open counts every password as breached, so a broken build cannot let one
// through; the tests catch it first.
func BreachedPassword(pw string) bool {
	f, err := breachedFilter()
	if err != nil {
		return true
	}
	return f.has(NormaliseBreached(pw))
}
