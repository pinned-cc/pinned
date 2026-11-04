package urlkey

import "testing"

// FuzzKey feeds arbitrary addresses to Key. It must never panic, and the key
// of a key is the same key, so a saved address matches itself on the next check.
func FuzzKey(f *testing.F) {
	for _, s := range []string{
		"http://10.0.0.5:8080", "https://h:443/x", "HTTP://Example.COM/Path#top",
		"http://user:pw@nas?q=1", "http://[::1]:80/", "https://homelab", "ftp://x", "",
	} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		k, err := Key(raw)
		if err != nil {
			return
		}
		k2, err := Key(k)
		if err != nil {
			t.Fatalf("Key(%q) = %q, which Key refuses: %v", raw, k, err)
		}
		if k2 != k {
			t.Fatalf("Key is not stable: %q gives %q, then %q", raw, k, k2)
		}
	})
}
