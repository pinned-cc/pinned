package urlkey

import (
	"errors"
	"strings"
	"testing"
)

func TestKeyEquality(t *testing.T) {
	same := [][2]string{
		{"http://h:80", "http://h"},
		{"https://h:443/x", "https://h/x"},
		{"HTTP://Example.COM/Path", "http://example.com/Path"},
		{"http://example.com/a#top", "http://example.com/a"},
		{"http://example.com", "http://example.com/"},
		{"http://nas/?q=1", "http://nas?q=1"},
		// White space before the fragment is trimmed like white space at
		// the ends (spec S23.4).
		{"http://h/a #top", "http://h/a"},
		{"http://h/a   #top", "http://h/a"},
		{"http://h/?q=a #x", "http://h/?q=a"},
		{"http://h/a\u00a0#x", "http://h/a"},
		{"http://h #x", "http://h/"},
	}
	for _, p := range same {
		a, err := Key(p[0])
		if err != nil {
			t.Fatalf("%s: %v", p[0], err)
		}
		b, err := Key(p[1])
		if err != nil {
			t.Fatalf("%s: %v", p[1], err)
		}
		if a != b {
			t.Errorf("want %q == %q, got %q and %q", p[0], p[1], a, b)
		}
	}

	different := [][2]string{
		{"http://h:8080", "http://h:8081"},
		{"http://h:8080", "http://h"},
		{"http://h:443", "https://h"},
		{"http://example.com/Path", "http://example.com/path"},
		{"http://10.0.0.5:8080", "http://10.0.0.5"},
	}
	for _, p := range different {
		a, _ := Key(p[0])
		b, _ := Key(p[1])
		if a == b {
			t.Errorf("want %q != %q, both gave %q", p[0], p[1], a)
		}
	}
}

// A tab, CR or LF before the fragment stays refused, as url.Parse refused it
// before the trim came in (spec S23.4).
func TestKeyRefusesControlBeforeFragment(t *testing.T) {
	for _, raw := range []string{"http://h/a\t#x", "http://h/a\n#x", "http://h/a\r#x", "http://h/a \t #x", "http://h/a\x7f#x"} {
		if k, err := Key(raw); !errors.Is(err, ErrInvalid) {
			t.Errorf("Key(%q) = %q, %v; want ErrInvalid", raw, k, err)
		}
	}
}

func TestKeyValues(t *testing.T) {
	cases := map[string]string{
		"http://10.0.0.5:8080":          "http://10.0.0.5:8080/",
		"http://10.0.0.5:8080/app#frag": "http://10.0.0.5:8080/app",
		"http://homelab":                "http://homelab/",
		"http://homelab:8080/x?y=Z":     "http://homelab:8080/x?y=Z",
		"  https://example.org/a%20b  ": "https://example.org/a%20b",
		"http://[::1]:80/":              "http://[::1]/",
		"http://User:Pw@Example.com/":   "http://User:Pw@example.com/",
	}
	for in, want := range cases {
		got, err := Key(in)
		if err != nil {
			t.Errorf("%q: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("Key(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestKeyInvalid(t *testing.T) {
	for _, in := range []string{"", "example.com", "ftp://example.com", "javascript:alert(1)", "http://", "http:///path", "mailto:a@b.c"} {
		if _, err := Key(in); err == nil {
			t.Errorf("Key(%q) should fail", in)
		}
	}
}

func TestHost(t *testing.T) {
	cases := map[string]string{
		"http://10.0.0.5:8080/x":      "10.0.0.5:8080",
		"http://homelab:80":           "homelab",
		"https://www.example.com:443": "www.example.com",
		"https://example.org:8443/":   "example.org:8443",
	}
	for in, want := range cases {
		if got := Host(in); got != want {
			t.Errorf("Host(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCheckLen(t *testing.T) {
	base := "https://example.com/"
	ok := base + strings.Repeat("a", MaxLen-len(base))
	if err := CheckLen("  " + ok + " "); err != nil {
		t.Errorf("an address of %d bytes: %v", len(ok), err)
	}
	err := CheckLen(ok + "a")
	if !errors.Is(err, ErrTooLong) || !errors.Is(err, ErrInvalid) {
		t.Errorf("an address of %d bytes: %v", len(ok)+1, err)
	}
}
