package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
)

// A folder with its own password is locked, and so is everything below it.
// While locked, its subfolders and bookmarks are left out of every answer
// and every write on them is a 404. Unlocking sets a short lived cookie.

const (
	unlockCookiePrefix = "pinned_unlock_"
	folderUnlockTTL    = 10 * time.Minute
	minLockPassword    = 4
)

func unlockCookieName(folderID int64) string {
	return unlockCookiePrefix + strconv.FormatInt(folderID, 10)
}

// folderUnlockValue signs the folder id, its lock stamp (see
// store.Folder.PasswordKey) and the expiry, so a new password makes every
// earlier cookie worthless, and a stronger hash of the same one does not.
func (s *Server) folderUnlockValue(f store.Folder, expires int64) string {
	m := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(m, "unlock\x00%d\x00%s\x00%d", f.ID, f.PasswordKey(), expires)
	return strconv.FormatInt(expires, 10) + "." + hex.EncodeToString(m.Sum(nil))
}

// cookieOpens reports whether the request carries a valid unlock cookie for f.
func (s *Server) cookieOpens(r *http.Request, f store.Folder) bool {
	if f.LockHash == nil {
		return true
	}
	if r == nil {
		return false
	}
	// Over HTTPS the cookie is __Host- prefixed; the plain name is from
	// plain HTTP or from before 0.1.11.
	c, err := r.Cookie(hostPrefix + unlockCookieName(f.ID))
	if err != nil {
		if c, err = r.Cookie(unlockCookieName(f.ID)); err != nil {
			return false
		}
	}
	v := signedPayload(c.Value)
	expStr, _, ok := strings.Cut(v, ".")
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if !ok || err != nil || exp <= s.st.Now().Unix() {
		return false
	}
	return hmac.Equal([]byte(v), []byte(s.folderUnlockValue(f, exp)))
}

// lockView answers lock questions for one request. A nil request means a
// visitor with no cookies, used for public share links.
type lockView struct {
	folders map[int64]store.Folder
	open    map[int64]bool // folder id -> its own lock is open
}

func (s *Server) lockView(r *http.Request) (*lockView, error) {
	folders, err := s.st.Folders()
	if err != nil {
		return nil, err
	}
	v := &lockView{folders: map[int64]store.Folder{}, open: map[int64]bool{}}
	for _, f := range folders {
		v.folders[f.ID] = f
		v.open[f.ID] = s.cookieOpens(r, f)
	}
	return v, nil
}

// chain calls fn for the folder and each of its parents, stopping when fn
// returns true. It guards against a broken tree with a step limit.
func (v *lockView) chain(id int64, fn func(store.Folder) bool) bool {
	for steps := 0; steps < 1000; steps++ {
		f, ok := v.folders[id]
		if !ok {
			return false
		}
		if fn(f) {
			return true
		}
		if f.ParentID == nil {
			return false
		}
		id = *f.ParentID
	}
	return false
}

// hidden reports whether the contents of folder id are hidden: the folder or
// one of its parents is locked and not unlocked.
func (v *lockView) hidden(id int64) bool {
	return v.chain(id, func(f store.Folder) bool { return f.LockHash != nil && !v.open[f.ID] })
}

// locked reports whether the folder or one of its parents has a lock.
func (v *lockView) locked(id int64) bool {
	return v.chain(id, func(f store.Folder) bool { return f.LockHash != nil })
}

// listed reports whether the folder itself shows up: its parent's contents
// are not hidden. A locked folder shows up by name while its parent is open.
func (v *lockView) listed(f store.Folder) bool {
	return f.ParentID == nil || !v.hidden(*f.ParentID)
}

func (v *lockView) bookmarkHidden(b store.Bookmark) bool {
	return b.FolderID != nil && v.hidden(*b.FolderID)
}

// hiddenSet is every hidden folder, for the store's duplicate lookups.
func (v *lockView) hiddenSet() store.Hidden {
	h := store.Hidden{}
	for id := range v.folders {
		if v.hidden(id) {
			h[id] = true
		}
	}
	return h
}

// hasHiddenBelow reports whether a folder below id is locked and not unlocked.
func (v *lockView) hasHiddenBelow(id int64) bool {
	for fid := range v.folders {
		if fid == id {
			continue
		}
		below := v.chain(fid, func(f store.Folder) bool { return f.ID == id })
		if below && v.hidden(fid) {
			return true
		}
	}
	return false
}

// errContainsLocked is a 409: the folder holds a locked subfolder.
var errContainsLocked = errors.New("this folder holds a locked folder; unlock it first")

// errHidden is answered as a 404, the same as a folder or bookmark that
// does not exist.
var errHidden = store.ErrNotFound

// openFolder checks that writes into folder id are allowed.
func (v *lockView) openFolder(id *int64) error {
	if id == nil {
		return nil
	}
	if _, ok := v.folders[*id]; !ok {
		return store.ErrNoFolder
	}
	if v.hidden(*id) {
		return errHidden
	}
	return nil
}

// visibleBookmark loads a bookmark and hides it when it sits in a locked folder.
func (s *Server) visibleBookmark(r *http.Request, id int64) (store.Bookmark, *lockView, error) {
	b, err := s.st.Bookmark(id)
	if err != nil {
		return b, nil, err
	}
	v, err := s.lockView(r)
	if err != nil {
		return b, nil, err
	}
	if v.bookmarkHidden(b) {
		return b, v, errHidden
	}
	return b, v, nil
}

// writeLockedDuplicate answers a duplicate whose original is hidden without
// telling anything about it. The duplicate lookups skip hidden folders, so
// it should not happen; it stays so a hidden bookmark is never shown.
func writeLockedDuplicate(w http.ResponseWriter) {
	writeJSON(w, http.StatusConflict, map[string]any{"error": "Already saved", "duplicate": nil, "locked": true})
}

// handleDuplicate writes a 409 for a duplicate error, hiding a locked original.
// It returns false when err is not a duplicate.
func handleDuplicate(w http.ResponseWriter, v *lockView, err error) bool {
	var dup *store.DuplicateError
	if !errors.As(err, &dup) {
		return false
	}
	if v != nil && v.bookmarkHidden(dup.Existing) {
		writeLockedDuplicate(w)
		return true
	}
	writeJSON(w, http.StatusConflict, map[string]any{"error": "Already saved", "duplicate": toJSON(dup.Existing)})
	return true
}

// ---- routes ----

// apiLockFolder sets a folder's own password. Changing the password of a
// folder that already has one needs the current one in current_password,
// checked under the same limiter as unlocking: an unlock cookie alone (a
// browser left open for ten minutes) cannot replace it. The app password
// is not asked here; it stays the way to remove a lock whose password is
// lost.
func (s *Server) apiLockFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var in struct {
		Password        string `json:"password"`
		CurrentPassword string `json:"current_password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	f, ok := v.folders[id]
	if !ok || v.hidden(id) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if utf8.RuneCountInString(in.Password) < minLockPassword {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("password must have at least %d characters", minLockPassword))
		return
	}
	if len(in.Password) > 72 {
		writeError(w, http.StatusBadRequest, "password is too long")
		return
	}
	if f.LockHash != nil {
		key, known := s.limitKey(r)
		ok, wait := s.attempt(r, s.folderLimiters.get(id), key, known, func() bool {
			return checkStored(*f.LockHash, in.CurrentPassword, func(h string) { s.rehashLock(&f, h) })
		})
		if !ok {
			s.failed(r, "lock", wait, "folder", id)
			refuseAttempt(w, wait, http.StatusForbidden, "Wrong password")
			return
		}
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, "password is too long")
		return
	}
	if err := s.st.SetLock(id, hash); err != nil {
		writeStoreError(w, err)
		return
	}
	event := "lock.set"
	if f.LockHash != nil {
		event = "lock.change"
	}
	s.security(r, event, "folder", id)
	s.clearUnlockCookie(w, r, id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiRemoveLock(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var in struct {
		AppPassword string `json:"app_password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	f, ok := v.folders[id]
	if !ok || !v.listed(f) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if !s.reauthWith(w, r, in.AppPassword, "lock.remove", "folder", id) {
		return
	}
	if err := s.st.RemoveLock(id); err != nil {
		writeStoreError(w, err)
		return
	}
	s.security(r, "lock.remove", "folder", id)
	s.clearUnlockCookie(w, r, id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiUnlockFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	f, ok := v.folders[id]
	if !ok || !v.listed(f) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if f.LockHash == nil {
		writeError(w, http.StatusBadRequest, "folder is not locked")
		return
	}
	key, known := s.limitKey(r)
	ok, wait := s.attempt(r, s.folderLimiters.get(id), key, known, func() bool {
		return checkStored(*f.LockHash, in.Password, func(h string) { s.rehashLock(&f, h) })
	})
	if !ok {
		s.failed(r, "lock", wait, "folder", id)
		refuseAttempt(w, wait, http.StatusForbidden, "Wrong password")
		return
	}
	exp := s.st.Now().Add(folderUnlockTTL).Unix()
	secure := s.isHTTPS(r)
	name := unlockCookieName(id)
	if secure {
		name = hostPrefix + name
	}
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: signedVersion + s.folderUnlockValue(f, exp), Path: "/",
		MaxAge: int(folderUnlockTTL.Seconds()), HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure,
	})
	s.security(r, "lock.unlock", "folder", id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) apiRelockFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if _, err := s.st.Folder(id); err != nil {
		writeStoreError(w, err)
		return
	}
	s.clearUnlockCookie(w, r, id)
	w.WriteHeader(http.StatusNoContent)
}

// clearUnlockCookie clears the folder's unlock cookie under both names; a
// __Host- cookie can only be cleared over HTTPS.
func (s *Server) clearUnlockCookie(w http.ResponseWriter, r *http.Request, id int64) {
	secure := s.isHTTPS(r)
	names := []string{unlockCookieName(id)}
	if secure {
		names = append(names, hostPrefix+unlockCookieName(id))
	}
	for _, name := range names {
		http.SetCookie(w, &http.Cookie{
			Name: name, Value: "", Path: "/", MaxAge: -1,
			HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure,
		})
	}
}
