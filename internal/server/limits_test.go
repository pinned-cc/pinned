package server

import (
	"strings"
	"testing"

	"github.com/pinned-cc/pinned/internal/urlkey"
)

// A 900 KB address used to be saved; anything past urlkey.MaxLen now gets
// a 400 that says why.
func TestLongURLAnswers400(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	long := "https://example.com/" + strings.Repeat("a", urlkey.MaxLen)
	body := e.expect("POST", "/api/bookmarks", map[string]any{"url": long}, 400)
	if !strings.Contains(string(body), "longer than 8192 bytes") {
		t.Errorf("answer %s", body)
	}
	e.expect("POST", "/api/bookmarks", map[string]any{"url": long[:urlkey.MaxLen]}, 201)
}
