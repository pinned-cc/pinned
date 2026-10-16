package jobs

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pinned-cc/pinned/internal/store"
)

func TestNextRun(t *testing.T) {
	zone, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tzdata")
	}
	cases := []struct{ now, want string }{
		{"2026-10-12 02:59", "2026-10-12 03:00"},
		{"2026-10-12 03:00", "2026-10-13 03:00"},
		{"2026-10-12 23:10", "2026-10-13 03:00"},
	}
	for _, c := range cases {
		now, _ := time.ParseInLocation("2006-01-02 15:04", c.now, zone)
		if got := NextRun(now).Format("2006-01-02 15:04"); got != c.want {
			t.Errorf("NextRun(%s) = %s, want %s", c.now, got, c.want)
		}
	}
}

func TestWriteExportAndPurge(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "bookmarks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if !exportIsStale(dir, time.Now()) {
		t.Error("missing file should be stale")
	}
	b, _, _ := st.Create(store.NewBookmark{Title: "Example", URL: "https://example.com"})
	if err := WriteExport(st, dir); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(ExportFile(dir))
	if !strings.Contains(string(data), `HREF="https://example.com"`) {
		t.Errorf("export missing bookmark:\n%s", data)
	}
	if exportIsStale(dir, time.Now()) {
		t.Error("fresh file should not be stale")
	}
	entries, _ := os.ReadDir(filepath.Join(dir, "export"))
	if len(entries) != 1 {
		t.Errorf("temp files left behind: %v", entries)
	}

	// Purge removes an orphaned icon file.
	os.MkdirAll(filepath.Join(dir, "icons"), 0o755)
	os.WriteFile(filepath.Join(dir, "icons", "x.png"), []byte("x"), 0o644)
	st.SetIcon(b.ID, b.URLKey, "x.png", nil)
	st.Now = func() time.Time { return time.Now().Add(-40 * 24 * time.Hour) }
	st.Trash(b.ID)
	st.Now = time.Now
	n, err := Purge(st, dir)
	if err != nil || n != 1 {
		t.Fatalf("purge n=%d err=%v", n, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "icons", "x.png")); !os.IsNotExist(err) {
		t.Error("orphaned icon not removed")
	}
}

func TestRunDoesStartWorkAndStops(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "bookmarks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() { Run(ctx, st, dir); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run ignored the cancelled context")
	}
	if exportIsStale(dir, time.Now()) {
		t.Error("start up export not written")
	}
	// A broken export folder is logged, not fatal.
	os.RemoveAll(filepath.Join(dir, "export"))
	os.WriteFile(filepath.Join(dir, "export"), []byte("a file"), 0o644)
	runOnce(st, dir, true)
}

func TestRemoveIconsStaysInItsFolder(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "icons"), 0o755)
	os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, "icons", "a.png"), []byte("x"), 0o644)
	RemoveIcons(dir, []string{"../keep.txt", "a.png", "missing.png"})
	if _, err := os.Stat(filepath.Join(dir, "keep.txt")); err != nil {
		t.Error("left the icons folder")
	}
	if _, err := os.Stat(filepath.Join(dir, "icons", "a.png")); !os.IsNotExist(err) {
		t.Error("icon not removed")
	}
}
