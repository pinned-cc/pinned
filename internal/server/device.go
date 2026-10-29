package server

import (
	"crypto/hmac"
	"net/http"
	"strings"
	"time"

	"github.com/pinned-cc/pinned/internal/auth"
)

// deviceCookie marks a browser that has logged in before. It is not a
// login: it only lets the password check count that browser on its own,
// outside the global cap that guessers on other addresses can fill (the
// device cookie defence OWASP describes against lockout). Over HTTPS it
// carries the __Host- prefix like the session cookie.
const deviceCookie = "pinned_device"

// deviceTTL is the longest a browser keeps a cookie (400 days in Chrome).
const deviceTTL = 400 * 24 * time.Hour

func (s *Server) deviceMAC(id string) string {
	return auth.HashToken(s.secret, "device\x00"+id)
}

// deviceID returns the id of r's device cookie when its signature holds.
func (s *Server) deviceID(r *http.Request) (string, bool) {
	for _, name := range []string{hostPrefix + deviceCookie, deviceCookie} {
		c, err := r.Cookie(name)
		if err != nil {
			continue
		}
		id, mac, ok := strings.Cut(c.Value, ".")
		if ok && id != "" && hmac.Equal([]byte(mac), []byte(s.deviceMAC(id))) {
			return id, true
		}
	}
	return "", false
}

// rememberDevice gives r's browser a device cookie unless it has one. It
// is called only for a browser that logged in or holds a session.
func (s *Server) rememberDevice(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.deviceID(r); ok {
		return
	}
	id, err := auth.NewToken()
	if err != nil {
		return
	}
	secure := s.isHTTPS(r)
	name := deviceCookie
	if secure {
		name = hostPrefix + deviceCookie
	}
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: id + "." + s.deviceMAC(id), Path: "/",
		MaxAge: int(deviceTTL.Seconds()), HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure,
	})
}
