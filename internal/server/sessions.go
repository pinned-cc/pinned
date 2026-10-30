package server

import (
	"net/http"
	"strings"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
)

// The signed in browsers: a short list in the app, with a way to sign out
// one of them or every other one. These routes need a session; a token is
// refused like on every route outside tokenRoutes.

type sessionJSON struct {
	ID        int64  `json:"id"`
	Browser   string `json:"browser"`
	CreatedAt int64  `json:"created_at"`
	UsedAt    int64  `json:"used_at"`
	Current   bool   `json:"current"`
}

// currentSession returns the session of r's cookie.
func (s *Server) currentSession(r *http.Request) (store.Session, string, bool) {
	c, _ := s.sessionCookie(r)
	if c == nil {
		return store.Session{}, "", false
	}
	hash := auth.HashToken(s.secret, c.Value)
	sess, ok := s.st.Session(hash)
	return sess, hash, ok
}

func (s *Server) apiSessions(w http.ResponseWriter, r *http.Request) {
	list, err := s.st.Sessions()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	cur, _, _ := s.currentSession(r)
	now := s.st.Now()
	out := make([]sessionJSON, 0, len(list))
	for _, x := range list {
		if !s.sessionLive(x, now) {
			continue
		}
		out = append(out, sessionJSON{ID: x.ID, Browser: x.Agent, CreatedAt: x.CreatedAt, UsedAt: x.UsedAt, Current: x.ID == cur.ID})
	}
	writeJSON(w, http.StatusOK, out)
}

// apiEndSession signs out one browser. Ending this browser's own session
// is a logout.
func (s *Server) apiEndSession(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if cur, _, ok := s.currentSession(r); ok && cur.ID == id {
		s.endSession(w, r)
		s.security(r, "logout")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.done(w, s.logged(r, "session.end", s.st.DeleteSessionByID(id), "session", id))
}

// apiEndOtherSessions signs out every browser but this one.
func (s *Server) apiEndOtherSessions(w http.ResponseWriter, r *http.Request) {
	_, hash, ok := s.currentSession(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not logged in")
		return
	}
	n, err := s.st.DeleteOtherSessions(hash)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.security(r, "session.end_others", "ended", n)
	writeJSON(w, http.StatusOK, map[string]int64{"ended": n})
}

// browserName makes a short label such as "Firefox on macOS" from a
// User-Agent, for the list of signed in browsers. It is a hint for the
// owner, not a check of anything.
func browserName(ua string) string {
	has := func(s string) bool { return strings.Contains(ua, s) }
	browser := ""
	switch {
	case has("Edg/") || has("EdgA/") || has("EdgiOS/"):
		browser = "Edge"
	case has("OPR/") || has("Opera"):
		browser = "Opera"
	case has("Firefox/") || has("FxiOS/"):
		browser = "Firefox"
	case has("SamsungBrowser/"):
		browser = "Samsung Internet"
	case has("Chrome/") || has("CriOS/") || has("Chromium/"):
		browser = "Chrome"
	case has("Safari/") || (has("AppleWebKit/") && (has("iPhone") || has("iPad"))):
		browser = "Safari"
	}
	system := ""
	switch {
	case has("iPhone"):
		system = "iPhone"
	case has("iPad"):
		system = "iPad"
	case has("Android"):
		system = "Android"
	case has("CrOS"):
		system = "ChromeOS"
	case has("Mac OS X") || has("Macintosh"):
		system = "macOS"
	case has("Windows"):
		system = "Windows"
	case has("Linux"):
		system = "Linux"
	}
	switch {
	case browser != "" && system != "":
		return browser + " on " + system
	case browser != "":
		return browser
	case system != "":
		return "A browser on " + system
	}
	return ""
}
