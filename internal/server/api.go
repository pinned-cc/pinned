package server

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/pinned-cc/pinned/internal/jobs"
	"github.com/pinned-cc/pinned/internal/netscape"
	"github.com/pinned-cc/pinned/internal/store"
	"github.com/pinned-cc/pinned/internal/urlkey"
)

// bookmarkJSON is a bookmark as the front end sees it.
type bookmarkJSON struct {
	ID             int64   `json:"id"`
	FolderID       *int64  `json:"folder_id"`
	Title          string  `json:"title"`
	URL            string  `json:"url"`
	Host           string  `json:"host"`
	Position       int64   `json:"position"`
	Pinned         bool    `json:"pinned"`
	PinnedPosition int64   `json:"pinned_position"`
	Icon           *string `json:"icon"`
	Tile           *string `json:"tile"`
	Letter         string  `json:"letter"`
	CreatedAt      int64   `json:"created_at"`
	UpdatedAt      int64   `json:"updated_at"`
	OpenedAt       *int64  `json:"opened_at"`
	DeletedAt      *int64  `json:"deleted_at"`
}

func iconURL(name *string) *string {
	if name == nil {
		return nil
	}
	u := "/icons/" + *name
	return &u
}

func toJSON(b store.Bookmark) bookmarkJSON {
	return bookmarkJSON{
		ID: b.ID, FolderID: b.FolderID, Title: b.Title, URL: b.URL, Host: b.Host(),
		Position: b.Position, Pinned: b.Pinned, PinnedPosition: b.PinnedPosition,
		Icon: iconURL(b.Icon), Tile: b.Tile, Letter: b.Letter(),
		CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt, OpenedAt: b.OpenedAt, DeletedAt: b.DeletedAt,
	}
}

type folderJSON struct {
	ID       int64      `json:"id"`
	ParentID *int64     `json:"parent_id"`
	Name     string     `json:"name"`
	Position int64      `json:"position"`
	Share    *shareJSON `json:"share"`
	Locked   bool       `json:"locked"`
	Unlocked bool       `json:"unlocked"`
	// HideRecent is the folder's own setting; subfolders inherit it.
	HideRecent bool `json:"hide_recent"`
}

func folderToJSON(f store.Folder) folderJSON {
	return folderJSON{ID: f.ID, ParentID: f.ParentID, Name: f.Name, Position: f.Position, HideRecent: f.HideRecent}
}

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

// ---- auth ----

func (s *Server) apiLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ok, wait := s.checkPassword(r, in.Password)
	if wait > 0 {
		tooMany(w, wait)
		return
	}
	if !ok {
		writeError(w, http.StatusUnauthorized, "Wrong password")
		return
	}
	if err := s.startSession(w, r); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiLogout(w http.ResponseWriter, r *http.Request) {
	s.endSession(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// ---- read ----

func (s *Server) apiState(w http.ResponseWriter, r *http.Request) {
	folders, err := s.st.Folders()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	bookmarks, err := s.st.Bookmarks()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	settings, err := s.st.Settings()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	shares, err := s.st.Shares()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	shareOf := map[int64]store.Share{}
	for _, sh := range shares {
		shareOf[sh.FolderID] = sh
	}
	fj := make([]folderJSON, 0, len(folders))
	for _, f := range folders {
		if !v.listed(f) {
			continue // inside a locked folder
		}
		j := folderToJSON(f)
		if sh, ok := shareOf[f.ID]; ok {
			j.Share = s.shareToJSON(r, sh)
		}
		if v.locked(f.ID) {
			j.Locked, j.Unlocked = true, !v.hidden(f.ID)
		}
		fj = append(fj, j)
	}
	bj := make([]bookmarkJSON, 0, len(bookmarks))
	for _, b := range bookmarks {
		if v.bookmarkHidden(b) {
			continue
		}
		bj = append(bj, toJSON(b))
	}
	// The save page's remembered folders never name a hidden folder.
	last := settings.LastFolder
	if last != nil && v.hidden(*last) {
		last = nil
	}
	recent := make([]int64, 0, len(settings.RecentFolders))
	for _, id := range settings.RecentFolders {
		if !v.hidden(id) {
			recent = append(recent, id)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"folders":   fj,
		"bookmarks": bj,
		"settings": map[string]any{
			"last_folder":    last,
			"recent_folders": recent,
		},
		"version": s.cfg.Version,
	})
}

// apiCheck tells the save page whether the URL is already saved, and offers
// the icon of another bookmark on the same host and port. A URL saved in a
// hidden folder answers as if it were not saved at all, without an icon.
func (s *Server) apiCheck(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	if _, err := urlkey.Key(raw); err != nil {
		writeStoreError(w, err)
		return
	}
	out := map[string]any{"duplicate": nil, "icon": nil}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if b, err := s.st.FindLive(raw); err == nil {
		if v.bookmarkHidden(b) {
			writeJSON(w, http.StatusOK, out)
			return
		}
		out["duplicate"] = toJSON(b)
	} else if !errors.Is(err, store.ErrNotFound) {
		writeStoreError(w, err)
		return
	}
	if icon, tile, ok := s.iconForOrigin(raw, v); ok {
		out["icon"] = map[string]any{"icon": iconURL(&icon), "tile": tile}
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- bookmarks ----

func (s *Server) apiCreate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title    string `json:"title"`
		URL      string `json:"url"`
		FolderID *int64 `json:"folder_id"`
		Force    bool   `json:"force"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := v.openFolder(in.FolderID); err != nil {
		writeStoreError(w, err)
		return
	}
	// Save anyway must never pull a bookmark out of a locked folder.
	if existing, err := s.st.FindLive(in.URL); err == nil && v.bookmarkHidden(existing) {
		writeLockedDuplicate(w)
		return
	}
	b, created, err := s.st.Create(store.NewBookmark{Title: in.Title, URL: in.URL, FolderID: in.FolderID, Force: in.Force})
	if err != nil {
		if !handleDuplicate(w, v, err) {
			writeStoreError(w, err)
		}
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
		b = s.giveIcon(b, v)
	}
	writeJSON(w, status, toJSON(b))
}

// iconForOrigin is the icon of a bookmark on the same host and port that
// the lock view can see.
func (s *Server) iconForOrigin(raw string, v *lockView) (string, *string, bool) {
	list, err := s.st.IconsForOrigin(raw)
	if err != nil {
		log.Printf("icon for origin: %v", err)
		return "", nil, false
	}
	for _, c := range list {
		if v == nil || c.FolderID == nil || !v.hidden(*c.FolderID) {
			return c.Icon, c.Tile, true
		}
	}
	return "", nil, false
}

// giveIcon reuses the icon of a bookmark on the same host and port when there
// is one, and otherwise queues a fetch.
func (s *Server) giveIcon(b store.Bookmark, v *lockView) store.Bookmark {
	if icon, tile, ok := s.iconForOrigin(b.URL, v); ok {
		if _, err := s.st.SetIcon(b.ID, b.URLKey, icon, tile); err == nil {
			b.Icon, b.Tile = &icon, tile
			return b
		}
	}
	s.icons.Enqueue(b.ID)
	return b
}

func (s *Server) apiPatch(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var in map[string]json.RawMessage
	if !readJSON(w, r, &in) {
		return
	}
	var p store.Patch
	for key, raw := range in {
		// A token may rename and move, nothing else.
		if isBearer(r) && key != "title" && key != "folder_id" {
			writeError(w, http.StatusBadRequest, "a token can change only title and folder_id")
			return
		}
		var err error
		switch key {
		case "title":
			err = json.Unmarshal(raw, &p.Title)
		case "url":
			err = json.Unmarshal(raw, &p.URL)
		case "folder_id":
			p.FolderSet = true
			err = json.Unmarshal(raw, &p.FolderID)
		case "pinned":
			err = json.Unmarshal(raw, &p.Pinned)
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid "+key)
			return
		}
	}
	old, v, err := s.visibleBookmark(r, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if p.FolderSet {
		if err := v.openFolder(p.FolderID); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	b, urlChanged, err := s.st.Update(id, p)
	if err != nil {
		if !handleDuplicate(w, v, err) {
			writeStoreError(w, err)
		}
		return
	}
	if urlChanged {
		if old.Icon != nil && (b.Icon == nil || *b.Icon != *old.Icon) && !s.st.IconInUse(*old.Icon) {
			jobs.RemoveIcons(s.cfg.DataDir, []string{*old.Icon})
		}
		s.icons.Enqueue(b.ID)
	}
	writeJSON(w, http.StatusOK, toJSON(b))
}

func (s *Server) apiOpen(w http.ResponseWriter, r *http.Request) {
	s.bookmarkByID(w, r, s.st.MarkOpened)
}

func (s *Server) apiRestore(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	_, v, err := s.visibleBookmark(r, id)
	if err == nil {
		err = s.st.Restore(id)
	}
	if err != nil {
		if !handleDuplicate(w, v, err) {
			writeStoreError(w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// bookmarkByID is byID for bookmarks: one hidden in a locked folder is a 404.
func (s *Server) bookmarkByID(w http.ResponseWriter, r *http.Request, fn func(int64) error) {
	s.byID(w, r, func(id int64) error {
		if _, _, err := s.visibleBookmark(r, id); err != nil {
			return err
		}
		return fn(id)
	})
}

func (s *Server) apiRefetch(w http.ResponseWriter, r *http.Request) {
	s.bookmarkByID(w, r, func(id int64) error {
		s.icons.Enqueue(id)
		return nil
	})
}

func (s *Server) apiDelete(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("permanent") == "1" {
		s.bookmarkByID(w, r, func(id int64) error {
			orphans, err := s.st.Delete(id)
			jobs.RemoveIcons(s.cfg.DataDir, orphans)
			return err
		})
		return
	}
	s.bookmarkByID(w, r, s.st.Trash)
}

// byID runs fn with the {id} path value and answers 204 or the error.
func (s *Server) byID(w http.ResponseWriter, r *http.Request, fn func(int64) error) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if err := fn(id); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiEmptyTrash(w http.ResponseWriter, r *http.Request) {
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	all, err := s.st.Bookmarks()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// Trash in a locked folder stays until the folder is unlocked.
	var ids []int64
	for _, b := range all {
		if b.DeletedAt != nil && !v.bookmarkHidden(b) {
			ids = append(ids, b.ID)
		}
	}
	orphans, err := s.st.Bulk(ids, "delete", nil)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	jobs.RemoveIcons(s.cfg.DataDir, orphans)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiBulk(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs      []int64 `json:"ids"`
		Action   string  `json:"action"`
		FolderID *int64  `json:"folder_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if in.Action == "move" {
		if err := v.openFolder(in.FolderID); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	if !s.allVisibleIn(w, v, in.IDs) {
		return
	}
	orphans, err := s.st.Bulk(in.IDs, in.Action, in.FolderID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	jobs.RemoveIcons(s.cfg.DataDir, orphans)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiOrderBookmarks(w http.ResponseWriter, r *http.Request) {
	var in struct {
		FolderID *int64  `json:"folder_id"`
		IDs      []int64 `json:"ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if v, err := s.lockView(r); err != nil || v.openFolder(in.FolderID) != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	s.done(w, s.st.OrderBookmarks(in.FolderID, in.IDs))
}

func (s *Server) apiOrderPinned(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []int64 `json:"ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !s.allVisible(w, r, in.IDs) {
		return
	}
	s.done(w, s.st.OrderPinned(in.IDs))
}

// allVisible answers 404 and returns false when one of ids is a bookmark
// in a hidden folder.
func (s *Server) allVisible(w http.ResponseWriter, r *http.Request, ids []int64) bool {
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return false
	}
	return s.allVisibleIn(w, v, ids)
}

func (s *Server) allVisibleIn(w http.ResponseWriter, v *lockView, ids []int64) bool {
	for _, id := range ids {
		b, err := s.st.Bookmark(id)
		if errors.Is(err, store.ErrNotFound) {
			continue // the store ignores ids that are gone
		}
		if err != nil {
			writeStoreError(w, err)
			return false
		}
		if v.bookmarkHidden(b) {
			writeError(w, http.StatusNotFound, "not found")
			return false
		}
	}
	return true
}

func (s *Server) done(w http.ResponseWriter, err error) {
	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- folders ----

func (s *Server) apiCreateFolder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name     string `json:"name"`
		ParentID *int64 `json:"parent_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if v, err := s.lockView(r); err != nil {
		writeStoreError(w, err)
		return
	} else if err := v.openFolder(in.ParentID); err != nil {
		writeStoreError(w, err)
		return
	}
	f, err := s.st.CreateFolder(in.Name, in.ParentID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, folderToJSON(f))
}

func (s *Server) apiPatchFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var in map[string]json.RawMessage
	if !readJSON(w, r, &in) {
		return
	}
	var name *string
	var parentID *int64
	_, parentSet := in["parent_id"]
	if raw, ok := in["name"]; ok {
		if err := json.Unmarshal(raw, &name); err != nil {
			writeError(w, http.StatusBadRequest, "invalid name")
			return
		}
	}
	if parentSet {
		if err := json.Unmarshal(in["parent_id"], &parentID); err != nil {
			writeError(w, http.StatusBadRequest, "invalid parent_id")
			return
		}
	}
	var hideRecent *bool
	if raw, ok := in["hide_recent"]; ok {
		if err := json.Unmarshal(raw, &hideRecent); err != nil || hideRecent == nil {
			writeError(w, http.StatusBadRequest, "invalid hide_recent")
			return
		}
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// A locked folder is renamed or moved only while it is unlocked.
	if err := v.openFolder(&id); err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if parentSet {
		if err := v.openFolder(parentID); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	f, err := s.st.UpdateFolder(id, name, parentSet, parentID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if hideRecent != nil {
		if f, err = s.st.SetHideRecent(id, *hideRecent); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, folderToJSON(f))
}

func (s *Server) apiDeleteFolder(w http.ResponseWriter, r *http.Request) {
	s.byID(w, r, func(id int64) error {
		v, err := s.lockView(r)
		if err != nil {
			return err
		}
		if err := v.openFolder(&id); err != nil {
			return store.ErrNotFound
		}
		// Deleting would move the bookmarks of a locked subfolder into
		// the open Trash, so it waits until that subfolder is unlocked.
		if v.hasHiddenBelow(id) {
			return errContainsLocked
		}
		_, err = s.st.DeleteFolder(id)
		return err
	})
}

func (s *Server) apiOrderFolders(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ParentID *int64  `json:"parent_id"`
		IDs      []int64 `json:"ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if v, err := s.lockView(r); err != nil || v.openFolder(in.ParentID) != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	s.done(w, s.st.OrderFolders(in.ParentID, in.IDs))
}

// ---- import and export ----

// maxImport caps the import request body.
const maxImport = 20 << 20

func (s *Server) apiImport(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImport)
	file, _, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "the file is larger than 20 MB")
			return
		}
		writeError(w, http.StatusBadRequest, "send the bookmark file as multipart field \"file\"")
		return
	}
	defer file.Close()
	root, err := netscape.Parse(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "not a bookmark file")
		return
	}
	res, err := s.st.Import(root)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	for _, id := range res.AddedIDs {
		s.icons.Enqueue(id)
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) apiExport(w http.ResponseWriter, r *http.Request) {
	tree, err := s.st.ExportTree()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="bookmarks.html"`)
	w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
	if err := netscape.Write(w, tree); err != nil {
		log.Printf("export: %v", err)
	}
}
