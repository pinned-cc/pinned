package pinned

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

// Every module go.mod requires, at the version it requires, has its licence
// in THIRD_PARTY_NOTICES, and so has Go. When this fails, run
// go run ./tools/notices and commit the file.
func TestThirdPartyNoticesCoverGoMod(t *testing.T) {
	gomod, err := os.ReadFile("go.mod")
	if err != nil {
		t.Fatal(err)
	}
	reqs := requires(string(gomod))
	if len(reqs) == 0 {
		t.Fatal("no requirements read from go.mod")
	}
	for _, r := range reqs {
		head := "\n== " + r + " ==\n\n-- "
		if !bytes.Contains(ThirdPartyNotices, []byte(head)) {
			t.Errorf("THIRD_PARTY_NOTICES lacks %s; run go run ./tools/notices", r)
		}
	}
	for _, want := range []string{"\n== Go (the Go toolchain, runtime and standard library) ==\n\n-- LICENSE --\n", "Copyright 2009 The Go Authors."} {
		if !bytes.Contains(ThirdPartyNotices, []byte(want)) {
			t.Errorf("THIRD_PARTY_NOTICES lacks Go's licence: %q", want)
		}
	}
}

// requires returns "path version" for every require in go.mod, in a block
// or on its own line.
func requires(gomod string) []string {
	var out []string
	block := false
	for _, line := range strings.Split(gomod, "\n") {
		line, _, _ = strings.Cut(line, "//")
		f := strings.Fields(line)
		switch {
		case len(f) == 0:
		case block && f[0] == ")":
			block = false
		case block && len(f) >= 2:
			out = append(out, f[0]+" "+f[1])
		case f[0] == "require" && len(f) == 2 && f[1] == "(":
			block = true
		case f[0] == "require" && len(f) >= 3:
			out = append(out, f[1]+" "+f[2])
		}
	}
	return out
}
