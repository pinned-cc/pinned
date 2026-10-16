// Package server is the HTTP side: pages, the JSON API and static files.
package server

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
	"github.com/pinned-cc/pinned/internal/urlkey"
)

// CookieName is the session cookie.
const CookieName = "pinned_session"

// Config is what the server needs from the environment.
type Config struct {
	Password    string
	DataDir     string
	BaseURL     string // optional, without trailing slash
	SessionDays int
	Version     string
	// TrustedProxies are the reverse proxies whose X-Forwarded-For is
	// believed for the rate limits (TRUSTED_PROXIES).
	TrustedProxies []netip.Prefix
}

// DefaultSessionDays is the session lifetime when SESSION_DAYS is not set.
const DefaultSessionDays = 90

// IconQueue starts a background icon fetch for a bookmark.
type IconQueue interface{ Enqueue(id int64) }

// Server serves everything.
type Server struct {
	cfg    Config
	st     *store.Store
	web    fs.FS // the web/ folder
	icons  IconQueue
	secret []byte
	// Failure counters, kept apart so wrong tokens from a broken extension
	// never lock the owner out of the login.
	loginLimiter  *auth.Limiter // app password: login, removing a lock
	tokenLimiter  *auth.Limiter // API tokens
	shareLimiter  *auth.Limiter // share passwords
	folderLimiter *auth.Limiter // folder lock passwords, per client and folder
	// sleep waits after a failed check; tests replace it.
	sleep func(time.Duration)
	mux   *http.ServeMux
}

// New builds the server. web is the web/ folder (pages at its root).
func New(cfg Config, st *store.Store, web fs.FS, icons IconQueue, secret []byte) *Server {
	if cfg.SessionDays <= 0 {
		cfg.SessionDays = DefaultSessionDays
	}
	s := &Server{
		cfg: cfg, st: st, web: web, icons: icons, secret: secret,
		loginLimiter: auth.NewLimiter(), tokenLimiter: auth.NewLimiter(),
		shareLimiter: auth.NewLimiter(), folderLimiter: auth.NewLimiter(),
		sleep: time.Sleep, mux: http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	securityHeaders(w.Header())
	if r.Method == http.MethodOptions && strings.HasPrefix(r.URL.Path, "/api/") {
		preflight(w, r)
		return
	}
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	m := s.mux
	// Pages
	m.HandleFunc("GET /{$}", s.page("index.html", true))
	m.HandleFunc("GET /login", s.loginPage)
	m.HandleFunc("POST /login", s.loginForm)
	m.HandleFunc("GET /save", s.savePage)
	m.HandleFunc("GET /bookmarklet", s.page("bookmarklet.html", true))
	m.HandleFunc("GET /search", s.search)
	m.HandleFunc("GET /opensearch.xml", s.openSearch)
	m.HandleFunc("GET /manifest.webmanifest", s.manifest)
	m.HandleFunc("GET /health", s.health)
	for _, name := range []string{"icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.svg"} {
		m.HandleFunc("GET /"+name, s.appIcon(name))
	}
	m.HandleFunc("GET /icons/{file}", s.requirePage(s.siteIcon))
	m.HandleFunc("GET /extras/{file}", s.extras)
	m.Handle("GET /static/", http.StripPrefix("/static/", s.static()))

	// Shared folders, public
	m.HandleFunc("GET /s/{token}", s.sharePage)
	m.HandleFunc("GET /s/{token}/data", s.shareData)
	m.HandleFunc("GET /s/{token}/icons/{file}", s.shareIcon)
	m.HandleFunc("POST /s/{token}/unlock", s.shareUnlock)

	// API
	m.HandleFunc("POST /api/login", s.csrf(s.apiLogin))
	m.HandleFunc("POST /api/logout", s.api(s.apiLogout))
	m.HandleFunc("GET /api/state", s.api(s.apiState))
	m.HandleFunc("GET /api/check", s.api(s.apiCheck))
	m.HandleFunc("POST /api/bookmarks", s.api(s.apiCreate))
	m.HandleFunc("POST /api/bookmarks/bulk", s.api(s.apiBulk))
	m.HandleFunc("PUT /api/bookmarks/order", s.api(s.apiOrderBookmarks))
	m.HandleFunc("PATCH /api/bookmarks/{id}", s.api(s.apiPatch))
	m.HandleFunc("POST /api/bookmarks/{id}/open", s.api(s.apiOpen))
	m.HandleFunc("POST /api/bookmarks/{id}/restore", s.api(s.apiRestore))
	m.HandleFunc("POST /api/bookmarks/{id}/refetch-icon", s.api(s.apiRefetch))
	m.HandleFunc("DELETE /api/bookmarks/{id}", s.api(s.apiDelete))
	m.HandleFunc("DELETE /api/trash", s.api(s.apiEmptyTrash))
	m.HandleFunc("PUT /api/pinned/order", s.api(s.apiOrderPinned))
	m.HandleFunc("GET /api/folders", s.api(s.apiFolderList))
	m.HandleFunc("POST /api/folders", s.api(s.apiCreateFolder))
	m.HandleFunc("PUT /api/folders/order", s.api(s.apiOrderFolders))
	m.HandleFunc("PATCH /api/folders/{id}", s.api(s.apiPatchFolder))
	m.HandleFunc("DELETE /api/folders/{id}", s.api(s.apiDeleteFolder))
	m.HandleFunc("POST /api/folders/{id}/share", s.api(s.apiCreateShare))
	m.HandleFunc("POST /api/folders/{id}/lock", s.api(s.apiLockFolder))
	m.HandleFunc("DELETE /api/folders/{id}/lock", s.api(s.apiRemoveLock))
	m.HandleFunc("POST /api/folders/{id}/unlock", s.api(s.apiUnlockFolder))
	m.HandleFunc("POST /api/folders/{id}/relock", s.api(s.apiRelockFolder))
	m.HandleFunc("PATCH /api/shares/{token}", s.api(s.apiPatchShare))
	m.HandleFunc("DELETE /api/shares/{token}", s.api(s.apiDeleteShare))
	m.HandleFunc("POST /api/import", s.api(s.apiImport))
	m.HandleFunc("GET /api/export", s.api(s.apiExport))
	m.HandleFunc("GET /api/tokens", s.api(s.apiTokens))
	m.HandleFunc("POST /api/tokens", s.api(s.apiCreateToken))
	m.HandleFunc("DELETE /api/tokens/{id}", s.api(s.apiDeleteToken))
	m.HandleFunc("/api/", s.api(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "no such endpoint")
	}))
}

// ---- sessions and guards ----

func (s *Server) sessionTTL() time.Duration {
	return time.Duration(s.cfg.SessionDays) * 24 * time.Hour
}

// loggedIn reports whether the request carries a valid session. With a
// ResponseWriter, a session last renewed more than a day ago is renewed for
// the full lifetime, in the database and in the cookie.
func (s *Server) loggedIn(w http.ResponseWriter, r *http.Request) bool {
	c, err := r.Cookie(CookieName)
	if err != nil || c.Value == "" {
		return false
	}
	hash := auth.HashToken(s.secret, c.Value)
	exp, ok := s.st.SessionExpiry(hash)
	now := s.st.Now()
	if !ok || !exp.After(now) {
		return false
	}
	ttl := s.sessionTTL()
	if w != nil && now.Add(ttl).Sub(exp) > 24*time.Hour {
		if err := s.st.ExtendSession(hash, now.Add(ttl)); err != nil {
			log.Printf("renew session: %v", err)
		} else {
			s.setSessionCookie(w, r, c.Value, ttl)
		}
	}
	return true
}

// csrf rejects mutating requests that do not carry X-Requested-With: fetch.
// A form or image on another site cannot set that header.
func (s *Server) csrf(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Requested-With") != "fetch" {
			writeError(w, http.StatusForbidden, "missing X-Requested-With: fetch header")
			return
		}
		h(w, r)
	}
}

// api requires a session, then the CSRF header. A request with a bearer
// token is checked against the tokens instead and skips both.
func (s *Server) api(h http.HandlerFunc) http.HandlerFunc {
	guarded := s.csrf(h)
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if token, ok := bearerToken(r); ok {
			s.serveBearer(w, r, token, h)
			return
		}
		if !s.loggedIn(w, r) {
			writeError(w, http.StatusUnauthorized, "not logged in")
			return
		}
		guarded(w, r)
	}
}

// requirePage redirects to the login page when there is no session.
func (s *Server) requirePage(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.loggedIn(w, r) {
			http.Redirect(w, r, "/login?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
			return
		}
		h(w, r)
	}
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request) error {
	token, err := auth.NewToken()
	if err != nil {
		return err
	}
	ttl := s.sessionTTL()
	if err := s.st.CreateSession(auth.HashToken(s.secret, token), s.st.Now().Add(ttl)); err != nil {
		return err
	}
	s.setSessionCookie(w, r, token, ttl)
	return nil
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		// Lax, so the bookmarklet popup (a top level visit from another
		// site) still carries the cookie.
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS(r),
	})
}

func (s *Server) endSession(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(CookieName); err == nil {
		if err := s.st.DeleteSession(auth.HashToken(s.secret, c.Value)); err != nil {
			log.Printf("end session: %v", err)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r)})
}

// isHTTPS decides the cookie's Secure flag. X-Forwarded-Proto can only make
// the cookie stricter, so it is read without a trust check.
func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// checkPassword compares the app password. A correct password always
// passes; a wrong one waits, counts, and returns the wait once the client
// is over the limit.
func (s *Server) checkPassword(r *http.Request, password string) (ok bool, wait time.Duration) {
	key := s.clientKey(r)
	if auth.PasswordOK(s.cfg.Password, password) {
		s.loginLimiter.Success(key)
		return true, 0
	}
	return false, s.fail(s.loginLimiter, key)
}

// baseURL is BASE_URL when set. Only without it are the request's Host and
// X-Forwarded-Proto used.
func (s *Server) baseURL(r *http.Request) string {
	if s.cfg.BaseURL != "" {
		return strings.TrimRight(s.cfg.BaseURL, "/")
	}
	scheme := "http"
	if isHTTPS(r) {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// ---- JSON helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v) // a client that went away is not an error worth logging
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeStoreError maps store errors to status codes.
func writeStoreError(w http.ResponseWriter, err error) {
	var dup *store.DuplicateError
	switch {
	case errors.As(err, &dup):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Already saved", "duplicate": toJSON(dup.Existing)})
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, urlkey.ErrInvalid),
		errors.Is(err, store.ErrNoFolder),
		errors.Is(err, store.ErrCycle),
		errors.Is(err, store.ErrEmptyName),
		errors.Is(err, store.ErrEmptyTitle),
		errors.Is(err, store.ErrUnknownAction),
		errors.Is(err, store.ErrTooDeep):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, store.ErrShareExists), errors.Is(err, errContainsLocked):
		writeError(w, http.StatusConflict, err.Error())
	default:
		log.Printf("error: %v", err)
		writeError(w, http.StatusInternalServerError, "something went wrong")
	}
}

// readJSON decodes a JSON body of at most 1 MB.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}
