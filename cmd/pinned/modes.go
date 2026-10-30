package main

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// Modes for what the app writes to DATA_DIR: only the user the app runs as
// may read the bookmarks, the share tokens and the key.
const (
	dirMode  fs.FileMode = 0o700
	fileMode fs.FileMode = 0o600
)

// tightenModes sets the folders of the data folder to 0700 and the files
// the app writes there to 0600, for data written by a version that made
// them readable by everyone. Only the app's own folders and files are
// touched, symbolic links are left alone, and a change that fails (a
// volume or share that does not allow it, a file of another owner) is
// logged once and skipped, never fatal.
func tightenModes(dataDir string) {
	failed := false
	set := func(path string, want fs.FileMode, dir bool) {
		info, err := os.Lstat(path)
		if err != nil || info.IsDir() != dir || (!dir && !info.Mode().IsRegular()) {
			return
		}
		if info.Mode().Perm()&^want == 0 {
			return
		}
		if err := os.Chmod(path, want); err != nil && !failed {
			failed = true
			log.Printf("data folder: could not make %s private (%v); check who owns DATA_DIR", path, err)
		}
	}
	for _, d := range []string{"", "icons", "export"} {
		set(filepath.Join(dataDir, d), dirMode, true)
	}
	entries, _ := os.ReadDir(dataDir)
	for _, e := range entries {
		name := e.Name()
		if name == "secret.key" || (strings.HasPrefix(name, "bookmarks") && strings.Contains(name, ".db")) {
			set(filepath.Join(dataDir, name), fileMode, false)
		}
	}
	set(filepath.Join(dataDir, "export", "bookmarks.html"), fileMode, false)
	icons, _ := os.ReadDir(filepath.Join(dataDir, "icons"))
	for _, e := range icons {
		set(filepath.Join(dataDir, "icons", e.Name()), fileMode, false)
	}
}
