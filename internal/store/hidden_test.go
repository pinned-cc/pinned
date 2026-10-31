package store

import (
	"errors"
	"testing"

	"github.com/pinned-cc/pinned/internal/netscape"
)

// A bookmark in a folder the caller cannot see does not count as saved:
// Create, FindLive, Update, Restore and Import go ahead beside it. Without
// a hidden set, nothing changes.
func TestHiddenFoldersDoNotCountAsSaved(t *testing.T) {
	s := open(t)
	f, _ := s.CreateFolder("Work", nil)
	hidden := Hidden{f.ID: true}
	u := "https://example.com/a"
	locked, _, err := s.Create(NewBookmark{URL: u, FolderID: &f.ID})
	if err != nil {
		t.Fatal(err)
	}
	var dup *DuplicateError
	if _, _, err := s.Create(NewBookmark{URL: u}); !errors.As(err, &dup) {
		t.Fatalf("without a hidden set: %v", err)
	}
	if _, err := s.FindLive(u, hidden); !errors.Is(err, ErrNotFound) {
		t.Errorf("FindLive found a hidden bookmark: %v", err)
	}
	// Force must not move the hidden one.
	open1, created, err := s.Create(NewBookmark{URL: u, Force: true, Hidden: hidden})
	if err != nil || !created || open1.ID == locked.ID {
		t.Fatalf("save beside a hidden one: %+v %v %v", open1, created, err)
	}
	if b, _ := s.FindLive(u, hidden); b.ID != open1.ID {
		t.Errorf("FindLive: %d, want %d", b.ID, open1.ID)
	}
	if b, _ := s.FindLive(u, nil); b.ID != locked.ID {
		t.Errorf("FindLive without a hidden set: %d, want the oldest %d", b.ID, locked.ID)
	}
	// Visible duplicates are still refused.
	if _, _, err := s.Create(NewBookmark{URL: u, Hidden: hidden}); !errors.As(err, &dup) || dup.Existing.ID != open1.ID {
		t.Errorf("visible duplicate: %v", err)
	}

	// Update and Restore.
	other, _, _ := s.Create(NewBookmark{URL: "https://example.com/b"})
	s.Create(NewBookmark{URL: "https://example.com/c", FolderID: &f.ID})
	c := "https://example.com/c"
	if _, _, err := s.Update(other.ID, Patch{URL: &c}); !errors.As(err, &dup) {
		t.Errorf("edit to a hidden address without a hidden set: %v", err)
	}
	if _, _, err := s.Update(other.ID, Patch{URL: &c, Hidden: hidden}); err != nil {
		t.Errorf("edit to a hidden address: %v", err)
	}
	s.Trash(other.ID)
	if _, _, err := s.Create(NewBookmark{URL: c, FolderID: &f.ID, Hidden: hidden}); err != nil {
		t.Fatal(err)
	}
	if err := s.Restore(other.ID, nil); !errors.As(err, &dup) {
		t.Errorf("restore without a hidden set: %v", err)
	}
	if err := s.Restore(other.ID, hidden); err != nil {
		t.Errorf("restore beside hidden ones: %v", err)
	}

	// Import.
	root := &netscape.Folder{Links: []netscape.Link{{Title: "d", URL: "https://example.com/d"}}}
	s.Create(NewBookmark{URL: "https://example.com/d", FolderID: &f.ID})
	if res, err := s.Import(root, hidden); err != nil || res.Added != 1 {
		t.Errorf("import beside a hidden one: %+v %v", res, err)
	}
	if res, err := s.Import(root, hidden); err != nil || res.Added != 0 || res.Skipped != 1 {
		t.Errorf("second import: %+v %v", res, err)
	}
}
