//go:build unix

package main

import (
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func mode(t *testing.T, path string) fs.FileMode {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}

// Data written readable by everyone (before 0.1.11) is made private at
// start; other files and symbolic links are left alone.
func TestTightenModes(t *testing.T) {
	dir := t.TempDir()
	for _, d := range []string{"icons", "export"} {
		os.Mkdir(filepath.Join(dir, d), 0o755)
	}
	os.Chmod(dir, 0o755)
	open := []string{"bookmarks.db", "bookmarks.db-wal", "bookmarks.db-shm", "secret.key",
		"bookmarks-schema6-2026-10-30-154210.db", "export/bookmarks.html", "icons/1-abcd.png"}
	for _, f := range open {
		os.WriteFile(filepath.Join(dir, f), []byte("x"), 0o644)
		os.Chmod(filepath.Join(dir, f), 0o644)
	}
	os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644)
	os.Chmod(filepath.Join(dir, "notes.txt"), 0o644)
	os.Symlink(filepath.Join(dir, "notes.txt"), filepath.Join(dir, "icons", "link.png"))

	tightenModes(dir)
	for _, d := range []string{"", "icons", "export"} {
		if m := mode(t, filepath.Join(dir, d)); m != 0o700 {
			t.Errorf("folder %q is %v", d, m)
		}
	}
	for _, f := range open {
		if m := mode(t, filepath.Join(dir, f)); m != 0o600 {
			t.Errorf("%s is %v", f, m)
		}
	}
	if m := mode(t, filepath.Join(dir, "notes.txt")); m != 0o644 {
		t.Errorf("a file the app does not own was changed to %v", m)
	}
	// A folder it cannot change is no reason to stop.
	tightenModes(filepath.Join(dir, "missing"))
}

// A new data folder is created private, and so are SQLite's own files.
func TestRunCreatesPrivateFiles(t *testing.T) {
	old := syscall.Umask(0o022)
	defer syscall.Umask(old)
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, port, _ := net.SplitHostPort(l.Addr().String())
	l.Close()
	dir := filepath.Join(t.TempDir(), "data")
	t.Setenv("APP_PASSWORD", "long enough")
	t.Setenv("DATA_DIR", dir)
	t.Setenv("PORT", port)
	t.Setenv("ICONS", "off")
	errc := make(chan error, 1)
	go func() { errc <- run() }()
	deadline := time.Now().Add(10 * time.Second)
	for checkHealth(port) != nil {
		if time.Now().After(deadline) {
			t.Fatal("server did not come up")
		}
		time.Sleep(50 * time.Millisecond)
	}
	for _, d := range []string{"", "icons", "export"} {
		if m := mode(t, filepath.Join(dir, d)); m != 0o700 {
			t.Errorf("folder %q is %v", d, m)
		}
	}
	for _, f := range []string{"bookmarks.db", "bookmarks.db-wal", "bookmarks.db-shm", "secret.key"} {
		if m := mode(t, filepath.Join(dir, f)); m != 0o600 {
			t.Errorf("%s is %v", f, m)
		}
	}
	syscall.Kill(os.Getpid(), syscall.SIGTERM)
	select {
	case <-errc:
	case <-time.After(15 * time.Second):
		t.Fatal("run did not return after SIGTERM")
	}
}
