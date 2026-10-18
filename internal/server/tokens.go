package server

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
)

// API tokens let the browser extension or a script call /api/*
// with "Authorization: Bearer tk_..." instead of the session cookie.

const tokenPrefix = "tk_"

type ctxKey int

const bearerKey ctxKey = 1

// isBearer reports whether the request was authenticated with a token.
func isBearer(r *http.Request) bool {
	v, _ := r.Context().Value(bearerKey).(bool)
	return v
}

// bearerToken returns the token from the Authorization header. ok is false
// when the header does not use the Bearer scheme at all.
func bearerToken(r *http.Request) (token string, ok bool) {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	scheme, rest, _ := strings.Cut(h, " ")
	if !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	return strings.TrimSpace(rest), true
}

// extensionOrigin reports whether origin belongs to a browser extension.
func extensionOrigin(origin string) bool {
	for _, p := range []string{"chrome-extension://", "moz-extension://", "safari-web-extension://"} {
		if strings.HasPrefix(origin, p) && len(origin) > len(p) {
			return true
		}
	}
	return false
}

// CORS is only for browser extensions, which call the API from their own
// origin with a bearer token. A web page on another site never gets an
// Allow-Origin header, and credentials are never allowed, so the session
// cookie cannot be used cross site.
func allowExtension(w http.ResponseWriter, r *http.Request) bool {
	h := w.Header()
	h.Add("Vary", "Origin")
	origin := r.Header.Get("Origin")
	if !extensionOrigin(origin) {
		return false
	}
	h.Set("Access-Control-Allow-Origin", origin)
	return true
}

// preflight answers OPTIONS on /api/*.
func preflight(w http.ResponseWriter, r *http.Request) {
	if !allowExtension(w, r) {
		writeError(w, http.StatusForbidden, "origin not allowed")
		return
	}
	h := w.Header()
	h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
	h.Set("Access-Control-Max-Age", "600")
	w.WriteHeader(http.StatusNoContent)
}

// tokenRoutes is everything a token may call: list folders, check a URL,
// save, read the state, and rename or move a bookmark (apiPatch accepts only
// title and folder_id from a token). Everything else is refused, so a token
// lost with a phone or read by an extension cannot export, delete, share,
// lock, import or manage tokens.
var tokenRoutes = map[string]bool{
	"GET /api/state":            true,
	"GET /api/folders":          true,
	"GET /api/check":            true,
	"POST /api/bookmarks":       true,
	"PATCH /api/bookmarks/{id}": true,
}

// serveBearer checks the token and runs h without cookies and without the
// CSRF check. A valid token always passes; a wrong one waits and counts in
// the token limiter, apart from the login.
func (s *Server) serveBearer(w http.ResponseWriter, r *http.Request, token string, h http.HandlerFunc) {
	allowExtension(w, r)
	var t store.Token
	err := store.ErrNotFound
	if strings.HasPrefix(token, tokenPrefix) {
		t, err = s.st.TokenByHash(auth.HashToken(s.secret, token))
	}
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		s.refuse(w, s.tokenLimiter, s.clientKey(r), http.StatusUnauthorized, "invalid token")
		return
	}
	if !tokenRoutes[r.Pattern] {
		writeError(w, http.StatusForbidden, "not allowed with a token")
		return
	}
	// Record the use at most once a minute, to keep writes down.
	if now := s.st.Now().Unix(); t.LastUsedAt == nil || now-*t.LastUsedAt >= 60 {
		if err := s.st.TouchToken(t.ID); err != nil {
			log.Printf("token last use: %v", err)
		}
	}
	// A bearer request carries no cookies: no session, no unlocked folders.
	r = r.Clone(context.WithValue(r.Context(), bearerKey, true))
	r.Header.Del("Cookie")
	h(w, r)
}

type tokenJSON struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Token      string `json:"token,omitempty"`
	CreatedAt  int64  `json:"created_at"`
	LastUsedAt *int64 `json:"last_used_at"`
}

func (s *Server) apiTokens(w http.ResponseWriter, r *http.Request) {
	list, err := s.st.Tokens()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	out := make([]tokenJSON, 0, len(list))
	for _, t := range list {
		out = append(out, tokenJSON{ID: t.ID, Name: t.Name, CreatedAt: t.CreatedAt, LastUsedAt: t.LastUsedAt})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) apiCreateToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	raw, err := auth.NewToken()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	value := tokenPrefix + raw
	t, err := s.st.CreateToken(in.Name, auth.HashToken(s.secret, value))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": t.ID, "name": t.Name, "token": value, "created_at": t.CreatedAt})
}

func (s *Server) apiDeleteToken(w http.ResponseWriter, r *http.Request) {
	s.byID(w, r, s.st.DeleteToken)
}

// apiFolderList is the light folder list for the pickers in the extension
// and in scripts. Folders whose contents are locked are left out: nothing can be
// saved into them.
func (s *Server) apiFolderList(w http.ResponseWriter, r *http.Request) {
	folders, err := s.st.Folders()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	v, err := s.lockView(r)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	type lite struct {
		ID       int64  `json:"id"`
		ParentID *int64 `json:"parent_id"`
		Name     string `json:"name"`
		Position int64  `json:"position"`
	}
	out := make([]lite, 0, len(folders))
	for _, f := range folders {
		if !v.hidden(f.ID) {
			out = append(out, lite{f.ID, f.ParentID, f.Name, f.Position})
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// extras serves the downloads in web/extras: the browser extension.
func (s *Server) extras(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if name == "" || name != path.Base(name) || strings.HasPrefix(name, ".") {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(s.web, "extras/"+name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Cache-Control", "no-cache")
	switch path.Ext(name) {
	case ".zip":
		h.Set("Content-Type", "application/zip")
		h.Set("Content-Disposition", `attachment; filename="`+name+`"`)
	case ".txt":
		h.Set("Content-Type", "text/plain; charset=utf-8")
	default:
		h.Set("Content-Type", "application/octet-stream")
	}
	w.Write(data)
}
