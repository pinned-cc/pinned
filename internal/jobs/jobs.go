// Package jobs runs the background work: the nightly export file and the
// daily Trash purge.
package jobs

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/pinned-cc/pinned/internal/netscape"
	"github.com/pinned-cc/pinned/internal/store"
)

// TrashDays is how long a bookmark waits in Trash.
const TrashDays = 30

// ExportFile returns the path of the nightly export.
func ExportFile(dataDir string) string { return filepath.Join(dataDir, "export", "bookmarks.html") }

// WriteExport writes the export file atomically: temp file, then rename.
func WriteExport(st *store.Store, dataDir string) error {
	dir := filepath.Join(dataDir, "export")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tree, err := st.ExportTree()
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".bookmarks-*.html")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	if err := netscape.Write(tmp, tree); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), ExportFile(dataDir))
}

// Purge deletes bookmarks that have been in Trash for 30 days, removes icon
// files nothing uses any more, and clears expired sessions.
func Purge(st *store.Store, dataDir string) (int, error) {
	n, orphans, err := st.Purge(TrashDays)
	if err != nil {
		return 0, err
	}
	RemoveIcons(dataDir, orphans)
	if err := st.PurgeSessions(); err != nil {
		log.Printf("session purge: %v", err)
	}
	return n, nil
}

// RemoveIcons deletes icon files by name from DATA_DIR/icons.
func RemoveIcons(dataDir string, names []string) {
	for _, name := range names {
		if name != filepath.Base(name) {
			continue // never leave the icons folder
		}
		if err := os.Remove(filepath.Join(dataDir, "icons", name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("remove icon: %v", err)
		}
	}
}

// NextRun returns the next 03:00 in now's location, strictly after now.
func NextRun(now time.Time) time.Time {
	next := time.Date(now.Year(), now.Month(), now.Day(), 3, 0, 0, 0, now.Location())
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

// exportIsStale reports whether the export file is missing or older than a day.
func exportIsStale(dataDir string, now time.Time) bool {
	info, err := os.Stat(ExportFile(dataDir))
	return err != nil || now.Sub(info.ModTime()) > 24*time.Hour
}

// Run does the start up work, then runs the export and the purge every day
// at 03:00 local time until ctx ends.
func Run(ctx context.Context, st *store.Store, dataDir string) {
	runOnce(st, dataDir, exportIsStale(dataDir, time.Now()))
	for {
		wait := time.Until(NextRun(time.Now()))
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
			runOnce(st, dataDir, true)
		}
	}
}

func runOnce(st *store.Store, dataDir string, export bool) {
	if export {
		if err := WriteExport(st, dataDir); err != nil {
			log.Printf("nightly export: %v", err)
		}
	}
	if n, err := Purge(st, dataDir); err != nil {
		log.Printf("trash purge: %v", err)
	} else if n > 0 {
		log.Printf("trash purge: deleted %d bookmarks older than %d days", n, TrashDays)
	}
}
