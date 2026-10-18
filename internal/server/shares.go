package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"github.com/pinned-cc/pinned/internal/store"
)

const (
	shareCookie      = "pinned_share"      // proves the password was given
	shareSeenCookie  = "pinned_share_seen" // counts one open per hour
	unlockTTL        = 7 * 24 * time.Hour
	maxShareDays     = 3650
	minSharePassword = 8
)

type shareJSON struct {
	Token        string `json:"token"`
	URL          string `json:"url"`
	HasPassword  bool   `json:"has_password"`
	ExpiresAt    *int64 `json:"expires_at"`
	Opens        int64  `json:"opens"`
	LastOpenedAt *int64 `json:"last_opened_at"`
}

func (s *Server) shareToJSON(r *http.Request, sh store.Share) *shareJSON {
	return &shareJSON{
		Token: sh.Token, URL: s.baseURL(r) + "/s/" + sh.Token, HasPassword: sh.PasswordHash != nil,
		ExpiresAt: sh.ExpiresAt, Opens: sh.Opens, LastOpenedAt: sh.LastOpenedAt,
	}
}

func newShareToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// shareInput reads the optional password and expires_days fields. The set
// flags say whether the field was present at all.
type shareInput struct {
	passwordSet bool
	hash        *string
	expirySet   bool
	expiresAt   *int64
}

func (s *Server) readShareInput(w http.ResponseWriter, r *http.Request) (shareInput, bool) {
	var in shareInput
	var raw map[string]json.RawMessage
	if !readJSON(w, r, &raw) {
		return in, false
	}
	if v, ok := raw["password"]; ok {
		var pw *string
		if err := json.Unmarshal(v, &pw); err != nil {
			writeError(w, http.StatusBadRequest, "invalid password")
			return in, false
		}
		in.passwordSet = true
		if pw != nil && *pw != "" {
			if utf8.RuneCountInString(*pw) < minSharePassword {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("A share password needs at least %d characters.", minSharePassword))
				return in, false
			}
			h, err := bcrypt.GenerateFromPassword([]byte(*pw), 10)
			if err != nil {
				writeError(w, http.StatusBadRequest, "password is too long")
				return in, false
			}
			hs := string(h)
			in.hash = &hs
		}
	}
	if v, ok := raw["expires_days"]; ok {
		var days *int
		if err := json.Unmarshal(v, &days); err != nil || (days != nil && (*days < 1 || *days > maxShareDays)) {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("expires_days must be null or 1 to %d", maxShareDays))
			return in, false
		}
		in.expirySet = true
		if days != nil {
			t := s.st.Now().Add(time.Duration(*days) * 24 * time.Hour).Unix()
			in.expiresAt = &t
		}
	}
	return in, true
}

func (s *Server) apiCreateShare(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	in, ok := s.readShareInput(w, r)
	if !ok {
		return
	}
	token, err := newShareToken()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if f, ok := v.folders[id]; !ok || !v.listed(f) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if v.locked(id) {
		writeError(w, http.StatusConflict, "a locked folder cannot be shared")
		return
	}
	sh, err := s.st.CreateShare(id, token, in.hash, in.expiresAt)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, s.shareToJSON(r, sh))
}

func (s *Server) apiPatchShare(w http.ResponseWriter, r *http.Request) {
	in, ok := s.readShareInput(w, r)
	if !ok {
		return
	}
	sh, err := s.st.UpdateShare(r.PathValue("token"), in.passwordSet, in.hash, in.expirySet, in.expiresAt)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.shareToJSON(r, sh))
}

func (s *Server) apiDeleteShare(w http.ResponseWriter, r *http.Request) {
	s.done(w, s.st.DeleteShare(r.PathValue("token")))
}

// ---- public side ----

func shareHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Robots-Tag", "noindex, nofollow")
}

const goneHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Pinned</title>
<style>html,body{margin:0;height:100%;background:#0b0d10;color:#c9ccd1;font:15px/1.5 system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}</style>
</head><body><p>This link is no longer available.</p></body></html>
`

func shareGone(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNotFound)
	w.Write([]byte(goneHTML))
}

func (s *Server) sharePage(w http.ResponseWriter, r *http.Request) {
	shareHeaders(w)
	if _, err := s.st.ActiveShare(r.PathValue("token")); err != nil {
		shareGone(w)
		return
	}
	if _, err := fs.Stat(s.web, "share.html"); err != nil {
		shareGone(w)
		return
	}
	s.page("share.html", false)(w, r)
}

// unlockValue signs the token, the share's creation time, its password hash
// and the cookie's expiry. Revoking and sharing again, or changing the
// password, changes the input, so old cookies stop working.
func (s *Server) unlockValue(sh store.Share, expires int64) string {
	m := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(m, "share\x00%s\x00%d\x00%s\x00%d", sh.Token, sh.CreatedAt, deref(sh.PasswordHash), expires)
	return strconv.FormatInt(expires, 10) + "." + hex.EncodeToString(m.Sum(nil))
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (s *Server) shareUnlocked(r *http.Request, sh store.Share) bool {
	if sh.PasswordHash == nil {
		return true
	}
	c, err := r.Cookie(shareCookie)
	if err != nil {
		return false
	}
	expStr, _, ok := strings.Cut(c.Value, ".")
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if !ok || err != nil || exp <= s.st.Now().Unix() {
		return false
	}
	return hmac.Equal([]byte(c.Value), []byte(s.unlockValue(sh, exp)))
}

func (s *Server) shareUnlock(w http.ResponseWriter, r *http.Request) {
	shareHeaders(w)
	w.Header().Set("Cache-Control", "no-store")
	sh, err := s.st.ActiveShare(r.PathValue("token"))
	if err != nil {
		writeError(w, http.StatusNotFound, "This link is no longer available.")
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if sh.PasswordHash != nil {
		ok, wait := s.attempt(r, s.shareLimiter, s.clientKey(r), func() bool {
			return bcrypt.CompareHashAndPassword([]byte(*sh.PasswordHash), []byte(in.Password)) == nil
		})
		if !ok {
			refuseAttempt(w, wait, http.StatusUnauthorized, "Wrong password")
			return
		}
	}
	exp := s.st.Now().Add(unlockTTL).Unix()
	http.SetCookie(w, &http.Cookie{
		Name: shareCookie, Value: s.unlockValue(sh, exp), Path: "/s/" + sh.Token,
		MaxAge: int(unlockTTL.Seconds()), HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r),
	})
	w.WriteHeader(http.StatusNoContent)
}

type sharedBookmarkJSON struct {
	ID        int64   `json:"id"`
	FolderID  *int64  `json:"folder_id"`
	Title     string  `json:"title"`
	URL       string  `json:"url"`
	Host      string  `json:"host"`
	Icon      *string `json:"icon"`
	Tile      *string `json:"tile"`
	Letter    string  `json:"letter"`
	CreatedAt int64   `json:"created_at"`
}

func (s *Server) shareData(w http.ResponseWriter, r *http.Request) {
	shareHeaders(w)
	w.Header().Set("Cache-Control", "no-store")
	sh, err := s.st.ActiveShare(r.PathValue("token"))
	if err != nil {
		writeError(w, http.StatusNotFound, "This link is no longer available.")
		return
	}
	if !s.shareUnlocked(r, sh) {
		// The folder name is shown on the unlock page; nothing else leaks.
		out := map[string]any{"locked": true}
		if f, err := s.st.Folder(sh.FolderID); err == nil {
			out["folder"] = map[string]string{"name": f.Name}
		}
		writeJSON(w, http.StatusUnauthorized, out)
		return
	}
	root, folders, bookmarks, err := s.st.ShareContents(sh.FolderID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "This link is no longer available.")
			return
		}
		writeStoreError(w, err)
		return
	}

	// Count one open per browser per hour.
	if _, err := r.Cookie(shareSeenCookie); err != nil {
		if err := s.st.RecordShareOpen(sh.Token); err != nil {
			log.Printf("share open count: %v", err)
		}
		http.SetCookie(w, &http.Cookie{
			Name: shareSeenCookie, Value: "1", Path: "/s/" + sh.Token,
			MaxAge: 3600, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r),
		})
	}

	// A visitor never unlocks anything: locked subfolders stay out.
	public, err := s.lockView(nil)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	type sharedFolderJSON struct {
		ID       int64  `json:"id"`
		ParentID *int64 `json:"parent_id"`
		Name     string `json:"name"`
		Position int64  `json:"position"`
	}
	fj := make([]sharedFolderJSON, 0, len(folders))
	for _, f := range folders {
		if public.hidden(f.ID) {
			continue
		}
		fj = append(fj, sharedFolderJSON{ID: f.ID, ParentID: f.ParentID, Name: f.Name, Position: f.Position})
	}
	bj := make([]sharedBookmarkJSON, 0, len(bookmarks))
	for _, b := range bookmarks {
		if public.bookmarkHidden(b) {
			continue
		}
		var icon *string
		if b.Icon != nil {
			u := "/s/" + sh.Token + "/icons/" + *b.Icon
			icon = &u
		}
		bj = append(bj, sharedBookmarkJSON{
			ID: b.ID, FolderID: b.FolderID, Title: b.Title, URL: b.URL, Host: b.Host(),
			Icon: icon, Tile: b.Tile, Letter: b.Letter(), CreatedAt: b.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"folder":    map[string]string{"name": root.Name},
		"folders":   fj,
		"bookmarks": bj,
	})
}

func (s *Server) shareIcon(w http.ResponseWriter, r *http.Request) {
	shareHeaders(w)
	sh, err := s.st.ActiveShare(r.PathValue("token"))
	name := r.PathValue("file")
	if err != nil || !s.shareUnlocked(r, sh) || name != filepath.Base(name) || !s.st.ShareHasIcon(sh.FolderID, name) {
		http.NotFound(w, r)
		return
	}
	// Icons of bookmarks in a locked subfolder stay private.
	if !s.publicIcon(sh.FolderID, name) {
		http.NotFound(w, r)
		return
	}
	s.siteIcon(w, r)
}

// publicIcon reports whether icon belongs to a bookmark a visitor of the
// shared folder can see, leaving out locked subfolders.
func (s *Server) publicIcon(folderID int64, icon string) bool {
	public, err := s.lockView(nil)
	if err != nil {
		return false
	}
	_, _, bookmarks, err := s.st.ShareContents(folderID)
	if err != nil {
		return false
	}
	for _, b := range bookmarks {
		if b.Icon != nil && *b.Icon == icon && !public.bookmarkHidden(b) {
			return true
		}
	}
	return false
}
