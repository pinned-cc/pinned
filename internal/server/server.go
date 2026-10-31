// Package server is the HTTP side: pages, the JSON API and static files.
package server

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
	"github.com/pinned-cc/pinned/internal/urlkey"
)

// CookieName is the session cookie. Over HTTPS it carries the __Host-
// prefix, so the browser accepts it only with Secure, Path=/ and no Domain:
// nothing on plain HTTP or another host can set or replace it.
const CookieName = "pinned_session"

// hostPrefix is the cookie name prefix used over HTTPS.
const hostPrefix = "__Host-"

// DefaultHSTSMaxAge is the max-age sent when HSTS=true. HSTS is off unless
// HSTS is set, because it covers the whole host name on every port, and other
// services on the same NAS or Tailscale name may only speak plain http. It
// never has includeSubDomains, for the same reason one level down.
const DefaultHSTSMaxAge = 31536000

// Config is what the server needs from the environment.
type Config struct {
	Password    string
	DataDir     string
	BaseURL     string // optional, without trailing slash
	SessionDays int    // idle timeout: a session unused this long ends
	// SessionMaxDays is the absolute lifetime: a session this old ends
	// however much it is used (SESSION_MAX_DAYS).
	SessionMaxDays int
	Version        string
	Changelog      []byte // CHANGELOG.md, for What's new
	// TrustedProxies are the reverse proxies whose X-Forwarded-For is
	// believed for the rate limits (TRUSTED_PROXIES).
	TrustedProxies []netip.Prefix
	// HSTSMaxAge is the Strict-Transport-Security max-age in seconds sent
	// on HTTPS responses (HSTS). 0, the default, sends no header.
	HSTSMaxAge int
	// TOTPKey turns on the second factor for the app login (TOTP_SECRET):
	// the login then needs the code of an authenticator app too.
	TOTPKey []byte
	// EasyPassword is set when APP_PASSWORD is common but ran before this
	// version refused it; the app then shows a warning to change it.
	EasyPassword bool
}

// ParseHSTS reads HSTS: empty, "false" or "0" is off, "true" is
// DefaultHSTSMaxAge, and a positive whole number is that max-age in seconds.
func ParseHSTS(s string) (int, error) {
	s = strings.TrimSpace(s)
	switch strings.ToLower(s) {
	case "", "false", "0":
		return 0, nil
	case "true":
		return DefaultHSTSMaxAge, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("HSTS must be true, false or a max-age in seconds, not %q", s)
	}
	return n, nil
}

// DefaultSessionDays is the idle timeout when SESSION_DAYS is not set.
const DefaultSessionDays = 90

// DefaultSessionMaxDays is the absolute session lifetime when
// SESSION_MAX_DAYS is not set.
const DefaultSessionMaxDays = 365

// IconQueue starts a background icon fetch for a bookmark.
type IconQueue interface{ Enqueue(id int64) }

// Server serves everything.
type Server struct {
	cfg    Config
	st     *store.Store
	web    fs.FS // the web/ folder
	icons  IconQueue
	secret []byte
	// baseHost is the host of BASE_URL when it starts with https, else "".
	baseHost string
	// Failure counters, kept apart so wrong tokens from a broken extension
	// never lock the owner out of the login.
	loginLimiter   *auth.Limiter // app password: login, removing a lock
	tokenLimiter   *auth.Limiter // API tokens
	shareLimiters  limiterSet    // share passwords, one limiter per share
	folderLimiters limiterSet    // folder lock passwords, one limiter per folder
	// sleep waits after a failed check; tests replace it.
	sleep func(time.Duration)
	mux   *http.ServeMux
	// totp checks the second factor; nil when TOTP_SECRET is not set.
	totp *auth.TOTP
	// codeBackoff counts wrong codes after a right password, across all
	// clients, and holds every code check for a growing time.
	codeBackoff *auth.Backoff
	// log takes the security events; tests replace it.
	log *log.Logger
	// waitLogged holds, per area and client, the end of a wait already
	// logged (see failed).
	waitMu     sync.Mutex
	waitLogged map[string]time.Time
}

// New builds the server. web is the web/ folder (pages at its root).
func New(cfg Config, st *store.Store, web fs.FS, icons IconQueue, secret []byte) *Server {
	if cfg.SessionDays <= 0 {
		cfg.SessionDays = DefaultSessionDays
	}
	if cfg.SessionMaxDays <= 0 {
		cfg.SessionMaxDays = DefaultSessionMaxDays
	}
	s := &Server{
		cfg: cfg, st: st, web: web, icons: icons, secret: secret,
		loginLimiter: auth.NewLimiter(), tokenLimiter: auth.NewLimiter(),
		sleep: time.Sleep, mux: http.NewServeMux(),
		log: log.Default(), waitLogged: map[string]time.Time{},
		codeBackoff: auth.NewBackoff(),
	}
	if len(cfg.TOTPKey) > 0 {
		s.totp = auth.NewTOTP(cfg.TOTPKey)
	}
	if u, err := url.Parse(cfg.BaseURL); err == nil && strings.EqualFold(u.Scheme, "https") {
		s.baseHost = strings.TrimSuffix(u.Host, ":443")
	}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	securityHeaders(w.Header())
	if s.cfg.HSTSMaxAge > 0 && s.isHTTPS(r) {
		w.Header().Set("Strict-Transport-Security", "max-age="+strconv.Itoa(s.cfg.HSTSMaxAge))
	}
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
	m.HandleFunc("GET /changelog", s.requirePage(s.changelog))
	for _, name := range []string{"icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.svg"} {
		m.HandleFunc("GET /"+name, s.appIcon(name))
	}
	m.HandleFunc("GET /icons/{file}", s.requirePage(s.appSiteIcon))
	m.HandleFunc("GET /extras/{file}", s.extras)
	m.Handle("GET /static/", http.StripPrefix("/static/", s.static()))

	// Shared folders, public. A link is /s/#<token>: the token stays in the
	// fragment, which never reaches the server or a proxy, and share.js
	// sends it in the X-Share-Token header to the /s/-/ routes. Links of
	// the form /s/<token> from before 0.1.11 keep working.
	m.HandleFunc("GET /s/{$}", s.sharePage)
	m.HandleFunc("GET /s/-/data", s.shareData)
	m.HandleFunc("GET /s/-/icons/{file}", s.shareIcon)
	m.HandleFunc("POST /s/-/unlock", s.shareUnlock)
	m.HandleFunc("GET /s/{token}", s.sharePage)
	m.HandleFunc("GET /s/{token}/data", s.shareData)
	m.HandleFunc("GET /s/{token}/icons/{file}", s.shareIcon)
	m.HandleFunc("POST /s/{token}/unlock", s.shareUnlock)

	// API
	m.HandleFunc("POST /api/login", s.csrf(s.apiLogin))
	m.HandleFunc("POST /api/logout", s.api(s.apiLogout))
	m.HandleFunc("GET /api/sessions", s.api(s.apiSessions))
	m.HandleFunc("DELETE /api/sessions", s.api(s.apiEndOtherSessions))
	m.HandleFunc("DELETE /api/sessions/{id}", s.api(s.apiEndSession))
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

// sessionEnd is the end of a session's absolute lifetime.
func (s *Server) sessionEnd(sess store.Session) time.Time {
	return time.Unix(sess.CreatedAt, 0).Add(time.Duration(s.cfg.SessionMaxDays) * 24 * time.Hour)
}

// sessionLive reports whether sess has neither been idle too long nor
// passed its absolute lifetime.
func (s *Server) sessionLive(sess store.Session, now time.Time) bool {
	return time.Unix(sess.ExpiresAt, 0).After(now) && s.sessionEnd(sess).After(now)
}

// loggedIn reports whether the request carries a valid session. With a
// ResponseWriter, a session last renewed more than a day ago is renewed for
// SESSION_DAYS, in the database and in the cookie, but never past its
// absolute lifetime of SESSION_MAX_DAYS from the login. Its last use is
// recorded at most once an hour.
//
// A session cookie without the __Host- prefix on an HTTPS request, from
// before 0.1.11, is renewed under the prefixed name the same way.
func (s *Server) loggedIn(w http.ResponseWriter, r *http.Request) bool {
	c, legacy := s.sessionCookie(r)
	if c == nil {
		return false
	}
	hash := auth.HashToken(s.secret, c.Value)
	sess, ok := s.st.Session(hash)
	now := s.st.Now()
	if !ok || !s.sessionLive(sess, now) {
		return false
	}
	if w == nil {
		return true
	}
	s.upgradeDevice(w, r)
	exp := time.Unix(sess.ExpiresAt, 0)
	renewed := now.Add(s.sessionTTL())
	if end := s.sessionEnd(sess); renewed.After(end) {
		renewed = end
	}
	switch {
	case legacy || renewed.Sub(exp) > 24*time.Hour:
		if err := s.st.ExtendSession(hash, renewed); err != nil {
			log.Printf("renew session: %v", err)
		} else {
			s.setSessionCookie(w, r, c.Value, renewed.Sub(now))
		}
	case now.Sub(time.Unix(sess.UsedAt, 0)) > time.Hour:
		if err := s.st.ExtendSession(hash, exp); err != nil {
			log.Printf("session use: %v", err)
		}
	}
	return true
}

// csrf rejects mutating requests that do not carry X-Requested-With: fetch,
// and logs csrf.refused. A form or image on another site cannot set that
// header.
func (s *Server) csrf(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Requested-With") != "fetch" {
			// At most one line a minute per client, so a page that keeps
			// trying cannot flood the log.
			if s.firstIn("csrf|"+s.clientKey(r), time.Minute) {
				s.security(r, "csrf.refused", "method", r.Method, "route", r.Pattern)
			}
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

// startSession starts a new session after a login. A session the browser
// already holds, under either cookie name, ends first, so a login never
// leaves an older cookie working beside the new one.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request) error {
	s.dropSessions(r)
	token, err := auth.NewToken()
	if err != nil {
		return err
	}
	ttl := min(s.sessionTTL(), time.Duration(s.cfg.SessionMaxDays)*24*time.Hour)
	if err := s.st.CreateSession(auth.HashToken(s.secret, token), browserName(r.UserAgent()), s.st.Now().Add(ttl)); err != nil {
		return err
	}
	s.setSessionCookie(w, r, token, ttl)
	s.rememberDevice(w, r)
	return nil
}

// sessionCookie returns the session cookie of r, the __Host- one first.
// legacy is true when only the unprefixed one came with an HTTPS request.
func (s *Server) sessionCookie(r *http.Request) (c *http.Cookie, legacy bool) {
	if c, err := r.Cookie(hostPrefix + CookieName); err == nil && c.Value != "" {
		return c, false
	}
	if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
		return c, s.isHTTPS(r)
	}
	return nil, false
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, ttl time.Duration) {
	secure := s.isHTTPS(r)
	name := CookieName
	if secure {
		name = hostPrefix + CookieName
		// Drop the unprefixed cookie of an older version, so the browser
		// does not keep sending a second session.
		if _, err := r.Cookie(CookieName); err == nil {
			http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true})
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		// Lax, so the bookmarklet popup (a top level visit from another
		// site) still carries the cookie.
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

// dropSessions deletes the sessions of r's cookies, under either name.
func (s *Server) dropSessions(r *http.Request) {
	for _, name := range []string{hostPrefix + CookieName, CookieName} {
		if c, err := r.Cookie(name); err == nil && c.Value != "" {
			if err := s.st.DeleteSession(auth.HashToken(s.secret, c.Value)); err != nil {
				log.Printf("end session: %v", err)
			}
		}
	}
}

// endSession ends the session of either cookie name and clears both.
func (s *Server) endSession(w http.ResponseWriter, r *http.Request) {
	s.dropSessions(r)
	secure := s.isHTTPS(r)
	for _, name := range []string{hostPrefix + CookieName, CookieName} {
		if name != CookieName && !secure {
			continue // a __Host- cookie can only be set, or cleared, over HTTPS
		}
		http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure})
	}
}

// cgnat is 100.64.0.0/10, where Tailscale addresses live.
var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// isHTTPS reports whether the visitor reached the app over HTTPS. It
// decides the Secure flag and __Host- prefix of cookies, HSTS, and the
// scheme of links built from the request. It is true when:
//
//   - this connection is TLS;
//   - X-Forwarded-Proto says https and comes from a trusted proxy:
//     TRUSTED_PROXIES when set, otherwise any loopback, private or
//     100.64.0.0/10 address, where a reverse proxy in front of a home
//     server sits; from anywhere else the header is ignored;
//   - no trusted X-Forwarded-Proto came and BASE_URL starts with https
//     and names the host of the request, which covers proxies that send
//     no header, such as tailscale serve.
func (s *Server) isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" && s.protoTrusted(r) {
		first, _, _ := strings.Cut(proto, ",")
		return strings.EqualFold(strings.TrimSpace(first), "https")
	}
	return s.baseHost != "" && strings.EqualFold(r.Host, s.baseHost)
}

// protoTrusted reports whether X-Forwarded-Proto of r may be believed.
func (s *Server) protoTrusted(r *http.Request) bool {
	ap, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	a := ap.Addr().Unmap()
	if len(s.cfg.TrustedProxies) > 0 {
		return s.trusted(a)
	}
	return a.IsLoopback() || a.IsPrivate() || cgnat.Contains(a)
}

// checkPassword compares the app password under the login limiter. It
// returns the wait instead when the client is over the limit; then the
// password is not compared at all. It is the check before an action that
// asks for the app password again; the login uses checkLogin.
//
// A browser with a valid device cookie is counted on its own and never
// held by the global cap, so guessers on other addresses cannot lock the
// owner out of a browser that has logged in before.
func (s *Server) checkPassword(r *http.Request, password string) (ok bool, wait time.Duration) {
	return s.checkApp(r, func() bool { return auth.PasswordOK(s.cfg.Password, password) })
}

func (s *Server) checkApp(r *http.Request, check func() bool) (ok bool, wait time.Duration) {
	key, known := s.clientKey(r), false
	if id, ok := s.deviceID(r); ok {
		key, known = "device:"+id, true
	}
	return s.attempt(r, s.loginLimiter, key, known, check)
}

// checkLogin is the login check: the app password and, when TOTP_SECRET is
// set, the code, both under the login limiter. A device cookie does not
// skip the code. A code is used up only when the password is right too.
// The failure is logged as login, or as totp when only the code was wrong.
//
// A wrong code after a right password also counts in codeBackoff, across
// all clients: after 5 in a row no login is checked for a minute, then two,
// doubling to a day, until a right code. During that wait every login gets
// the wait back without any check, so a wrong and a right password answer
// alike; it is logged as totp.wait.
func (s *Server) checkLogin(r *http.Request, password, code string) (ok bool, wait time.Duration) {
	ok, wait, _ = s.checkLoginTried(r, password, code)
	return ok, wait
}

// checkLoginTried is checkLogin that also reports whether the password was
// compared at all: true for a wrong try that itself started the wait (the
// fifth), false for a try refused because a wait already held.
func (s *Server) checkLoginTried(r *http.Request, password, code string) (ok bool, wait time.Duration, tried bool) {
	if s.totp != nil {
		if wait := s.codeBackoff.Waiting(); wait > 0 {
			s.failed(r, "totp", wait)
			return false, wait, false
		}
	}
	codeWrong := false
	var codeWait time.Duration
	ok, wait = s.checkApp(r, func() bool {
		tried = true
		if !auth.PasswordOK(s.cfg.Password, password) {
			return false
		}
		if s.totp == nil {
			return true
		}
		// The code is checked and counted in one step, so logins that
		// arrive together check no more codes than one after another.
		okCode, w := s.codeBackoff.Check(func() bool {
			step, match := s.totp.Match(code)
			return match && s.totp.Use(step)
		})
		if !okCode {
			codeWrong, codeWait = true, w
		}
		return okCode
	})
	if ok {
		return true, 0, true
	}
	area := "login"
	if codeWrong {
		area = "totp"
	}
	wait = max(wait, codeWait)
	s.failed(r, area, wait)
	return false, wait, tried
}

// wrongLogin is the message for a refused login.
func (s *Server) wrongLogin() string {
	if s.totp != nil {
		return "Wrong password or code"
	}
	return "Wrong password"
}

// baseURL is BASE_URL when set. Only without it are the request's Host and
// X-Forwarded-Proto used.
func (s *Server) baseURL(r *http.Request) string {
	if s.cfg.BaseURL != "" {
		return strings.TrimRight(s.cfg.BaseURL, "/")
	}
	scheme := "http"
	if s.isHTTPS(r) {
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

// writeJSONGzip is writeJSON for the one large answer, /api/state (29 MB of JSON at
// 100000 links, refetched on every focus): gzipped when the client accepts it. That
// answer reflects nothing from the request, so compressing it gives an observer of
// its length nothing to probe its secrets with (BREACH).
func writeJSONGzip(w http.ResponseWriter, r *http.Request, status int, v any) {
	w.Header().Add("Vary", "Accept-Encoding")
	if !acceptsGzip(r.Header.Values("Accept-Encoding")) {
		writeJSON(w, status, v)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Del("Content-Length")
	w.WriteHeader(status)
	gz := gzipPool.Get().(*gzip.Writer)
	gz.Reset(w)
	_ = json.NewEncoder(gz).Encode(v) // as in writeJSON: a client that went away is not worth logging
	_ = gz.Close()
	gz.Reset(io.Discard)
	gzipPool.Put(gz)
}

// gzipPool keeps the compressors: each holds about a megabyte of tables.
var gzipPool = sync.Pool{New: func() any {
	gz, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed) // BestSpeed is a valid level, so no error
	return gz
}}

// acceptsGzip reads Accept-Encoding: gzip, or *, listed without q=0. gzip named
// on its own wins over *.
func acceptsGzip(headers []string) bool {
	star := false
	for _, h := range headers {
		for _, part := range strings.Split(h, ",") {
			name, params, _ := strings.Cut(part, ";")
			name = strings.ToLower(strings.TrimSpace(name))
			if name != "gzip" && name != "*" {
				continue
			}
			ok := true
			for _, p := range strings.Split(params, ";") {
				k, val, _ := strings.Cut(strings.TrimSpace(p), "=")
				if strings.EqualFold(strings.TrimSpace(k), "q") {
					if q, err := strconv.ParseFloat(strings.TrimSpace(val), 64); err != nil || q <= 0 {
						ok = false
					}
				}
			}
			if name == "gzip" {
				return ok
			}
			star = star || ok
		}
	}
	return star
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
