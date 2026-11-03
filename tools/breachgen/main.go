// Command breachgen writes the breached password filter that Pinned checks
// new passwords against (internal/auth/breached/*.bin). It runs once, by
// hand, when the filter changes; the app never fetches anything.
//
// Sources, both from SecLists (https://github.com/danielmiessler/SecLists,
// MIT licence, copyright (c) 2018 Daniel Miessler), at commit
// 68bcd12457978649d41ae4f56e3b5d2db2b72560:
//
//	https://raw.githubusercontent.com/danielmiessler/SecLists/68bcd12457978649d41ae4f56e3b5d2db2b72560/Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt
//	sha256 424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51
//	https://raw.githubusercontent.com/danielmiessler/SecLists/68bcd12457978649d41ae4f56e3b5d2db2b72560/Passwords/Leaked-Databases/rockyou.txt.tar.gz
//	sha256 47c070a029bcdb4cbd0e02c69fed136ef46dce4048ddbadf177daa5e885b8172
//
// Each line is put in lower case and trimmed (auth.NormaliseBreached); lines
// that are not UTF-8, shorter than 8 characters or repeated are left out.
// All of the xato list goes in, in its order, then rockyou.txt in its order
// (most used first) until the filter holds 1000000 passwords.
//
// Run it with the two files downloaded into a folder outside the repo:
//
//	go run ./tools/breachgen -xato DIR/xato-net-10-million-passwords-1000000.txt -rockyou DIR/rockyou.txt.tar.gz
//
// It writes internal/auth/breached/0.bin to 3.bin and prints the SHA-256 of
// the whole filter, which internal/auth/breached_test.go holds.
package main

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"unicode/utf8"

	"github.com/pinned-cc/pinned/internal/auth"
)

const (
	xatoSHA256    = "424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51"
	rockyouSHA256 = "47c070a029bcdb4cbd0e02c69fed136ef46dce4048ddbadf177daa5e885b8172"
	entries       = 1000000
	falsePositive = 1e-6
	minLength     = 8 // the shortest app, lock and share password
	maxPart       = 1 << 20
)

func main() {
	xato := flag.String("xato", "", "path to xato-net-10-million-passwords-1000000.txt")
	rockyou := flag.String("rockyou", "", "path to rockyou.txt.tar.gz")
	out := flag.String("out", "internal/auth/breached", "folder to write the parts into")
	flag.Parse()
	if err := run(*xato, *rockyou, *out); err != nil {
		fmt.Fprintln(os.Stderr, "breachgen:", err)
		os.Exit(1)
	}
}

func run(xato, rockyou, out string) error {
	for path, want := range map[string]string{xato: xatoSHA256, rockyou: rockyouSHA256} {
		if err := checkSum(path, want); err != nil {
			return err
		}
	}
	seen := make(map[string]struct{}, entries)
	var words []string
	add := func(line string) bool {
		if !utf8.ValidString(line) {
			return true
		}
		w := auth.NormaliseBreached(line)
		if utf8.RuneCountInString(w) < minLength {
			return true
		}
		if _, ok := seen[w]; !ok {
			seen[w] = struct{}{}
			words = append(words, w)
		}
		return len(words) < entries
	}
	f, err := os.Open(xato)
	if err != nil {
		return err
	}
	err = eachLine(f, add)
	f.Close()
	if err != nil {
		return err
	}
	fromXato := len(words)
	if err := eachRockyouLine(rockyou, add); err != nil {
		return err
	}
	if len(words) != entries {
		return fmt.Errorf("only %d passwords", len(words))
	}
	filter := auth.BuildBreachedFilter(words, falsePositive)
	partLen := (len(filter) + auth.BreachedParts - 1) / auth.BreachedParts
	if partLen > maxPart {
		return fmt.Errorf("a part would be %d bytes", partLen)
	}
	for i := 0; i < auth.BreachedParts; i++ {
		part := filter[min(i*partLen, len(filter)):min((i+1)*partLen, len(filter))]
		if err := os.WriteFile(filepath.Join(out, fmt.Sprintf("%d.bin", i)), part, 0o644); err != nil {
			return err
		}
	}
	sum := sha256.Sum256(filter)
	fmt.Printf("%d passwords (%d from xato, %d from rockyou), %d bytes in %d parts of %d\nsha256 %s\n",
		len(words), fromXato, len(words)-fromXato, len(filter), auth.BreachedParts, partLen, hex.EncodeToString(sum[:]))
	return nil
}

func checkSum(path, want string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != want {
		return fmt.Errorf("%s has sha256 %s, want %s", path, got, want)
	}
	return nil
}

// eachLine calls add for every line until add returns false.
func eachLine(r io.Reader, add func(string) bool) error {
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 64*1024), 1<<20)
	for s.Scan() {
		if !add(s.Text()) {
			return nil
		}
	}
	return s.Err()
}

func eachRockyouLine(path string, add func(string) bool) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return errors.New("rockyou.txt is not in the archive")
			}
			return err
		}
		if h.Typeflag == tar.TypeReg && filepath.Base(h.Name) == "rockyou.txt" {
			return eachLine(tr, add)
		}
	}
}
