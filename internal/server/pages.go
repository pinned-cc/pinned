package server

import (
	"encoding/json"
	"fmt"
	"html"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// page serves an HTML file from web/. The text {{BASE_URL}} in the file is
// replaced with the base URL, so the bookmarklet code points back here.
func (s *Server) page(name string, needLogin bool) http.HandlerFunc {
	h := func(w http.ResponseWriter, r *http.Request) {
		data, err := fs.ReadFile(s.web, name)
		if err != nil {
			http.Error(w, "page missing", http.StatusInternalServerError)
			return
		}
		body := strings.ReplaceAll(string(data), "{{BASE_URL}}", html.EscapeString(s.baseURL(r)))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write([]byte(body))
	}
	if needLogin {
		return s.requirePage(h)
	}
	return h
}

// safeNext keeps redirects on this site. next must parse as a URL with no
// scheme and no host, its path must start with a single "/" (not "//" and
// not "/\"), and it must hold no control characters, which browsers strip
// before they resolve a URL. Anything else becomes "/".
func safeNext(next string) string {
	for _, c := range next {
		if c < 0x20 || c == 0x7f {
			return "/"
		}
	}
	u, err := url.Parse(next)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil || u.Opaque != "" {
		return "/"
	}
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, "/\\") {
		return "/"
	}
	return next
}

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	if s.loggedIn(w, r) {
		http.Redirect(w, r, safeNext(r.URL.Query().Get("next")), http.StatusSeeOther)
		return
	}
	s.page("login.html", false)(w, r)
}

// loginForm handles the plain HTML form. On failure it goes back to
// /login?error=1 (wrong password) or /login?error=wait (rate limited).
func (s *Server) loginForm(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/login?error=1", http.StatusSeeOther)
		return
	}
	next := safeNext(r.PostForm.Get("next"))
	if next == "/" {
		next = safeNext(r.URL.Query().Get("next"))
	}
	ok, wait := s.checkPassword(r, r.PostForm.Get("password"))
	if !ok {
		reason := "1"
		if wait > 0 {
			reason = "wait"
		}
		http.Redirect(w, r, "/login?error="+reason+"&next="+url.QueryEscape(next), http.StatusSeeOther)
		return
	}
	if err := s.startSession(w, r); err != nil {
		http.Error(w, "could not start a session", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, next, http.StatusSeeOther)
}

var urlInText = regexp.MustCompile(`https?://[^\s<>"]+`)

// savePage serves the save page. Android's share target sends the link in
// text; when url is empty and text holds a URL, redirect with url filled in.
func (s *Server) savePage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("url") == "" {
		if found := urlInText.FindString(q.Get("text")); found != "" {
			title := q.Get("title")
			if title == "" {
				title = strings.TrimSpace(strings.Replace(q.Get("text"), found, "", 1))
			}
			v := url.Values{"url": {found}}
			if title != "" {
				v.Set("title", title)
			}
			http.Redirect(w, r, "/save?"+v.Encode(), http.StatusSeeOther)
			return
		}
	}
	s.page("save.html", true)(w, r)
}

// search is the OpenSearch target: the app reads the query from the hash.
func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/#q="+url.QueryEscape(r.URL.Query().Get("q")), http.StatusSeeOther)
}

func (s *Server) openSearch(w http.ResponseWriter, r *http.Request) {
	base := html.EscapeString(s.baseURL(r))
	w.Header().Set("Content-Type", "application/opensearchdescription+xml; charset=utf-8")
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Pinned</ShortName>
  <Description>Search bookmarks</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image type="image/svg+xml">%[1]s/favicon.svg</Image>
  <Url type="text/html" method="get" template="%[1]s/search?q={searchTerms}"/>
</OpenSearchDescription>
`, base)
}

func (s *Server) manifest(w http.ResponseWriter, r *http.Request) {
	m := map[string]any{
		"name":             "Pinned",
		"short_name":       "Pinned",
		"start_url":        "/",
		"scope":            "/",
		"display":          "standalone",
		"background_color": "#0a0a0b",
		"theme_color":      "#0a0a0b",
		"icons": []map[string]string{
			{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
			{"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
		},
		"share_target": map[string]any{
			"action": "/save",
			"method": "GET",
			"params": map[string]string{"title": "title", "text": "text", "url": "url"},
		},
	}
	w.Header().Set("Content-Type", "application/manifest+json")
	json.NewEncoder(w).Encode(m)
}

// health answers {"ok":true} to anyone, and adds the bookmark count and the
// version for a logged in session. 503 when the database fails.
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	n, err := s.st.CountLive()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false})
		return
	}
	if !s.loggedIn(nil, r) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bookmarks": n, "version": s.cfg.Version})
}

// appIcon serves one of the app's own icons from web/icons/.
func (s *Server) appIcon(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := fs.ReadFile(s.web, "icons/"+name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(data)
	}
}

// siteIcon serves a fetched favicon from DATA_DIR/icons. File names carry a
// content hash, so they can be cached for a long time.
func (s *Server) siteIcon(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if name == "" || name != filepath.Base(name) || strings.HasPrefix(name, ".") {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	// SVG icons come from other sites: never let them run script here.
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	http.ServeFile(w, r, filepath.Join(s.cfg.DataDir, "icons", name))
}

// static serves web/ under /static/, without directory listings.
func (s *Server) static() http.Handler {
	files := http.FileServerFS(s.web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "" || strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
}
