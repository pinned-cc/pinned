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

// deviceMAC signs id together with the app password's fingerprint, so a
// password change ends every device cookie at once.
func (s *Server) deviceMAC(id string) string {
	return auth.HashToken(s.secret, "device\x00"+auth.PasswordFingerprint(s.secret, s.cfg.Password)+"\x00"+id)
}

// deviceID returns the id of r's device cookie when its signature holds.
func (s *Server) deviceID(r *http.Request) (string, bool) {
	id, _, ok := s.deviceCookieID(r)
	return id, ok
}

// deviceCookieID is deviceID that also says whether the valid cookie is the
// unprefixed one.
func (s *Server) deviceCookieID(r *http.Request) (id string, plain, ok bool) {
	for _, name := range []string{hostPrefix + deviceCookie, deviceCookie} {
		c, err := r.Cookie(name)
		if err != nil {
			continue
		}
		id, mac, ok := strings.Cut(signedPayload(c.Value), ".")
		if ok && id != "" && hmac.Equal([]byte(mac), []byte(s.deviceMAC(id))) {
			return id, name == deviceCookie, true
		}
	}
	return "", false, false
}

// rememberDevice gives r's browser a device cookie unless it has one. It
// is called only after the right app password: a session alone never
// mints one, so a stolen session cannot collect cookies to spread guesses.
// A valid unprefixed cookie arriving over HTTPS is upgraded.
func (s *Server) rememberDevice(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := s.deviceCookieID(r); ok {
		s.upgradeDevice(w, r)
		return
	}
	id, err := auth.NewToken()
	if err != nil {
		return
	}
	s.setDeviceCookie(w, r, id)
}

// upgradeDevice reissues a valid unprefixed device cookie that arrives over
// HTTPS, set over plain HTTP or by an older version, under the __Host-
// name, with the same id, and clears the old one. It mints nothing.
func (s *Server) upgradeDevice(w http.ResponseWriter, r *http.Request) {
	id, plain, ok := s.deviceCookieID(r)
	if !ok || !plain || !s.isHTTPS(r) {
		return
	}
	s.setDeviceCookie(w, r, id)
	http.SetCookie(w, &http.Cookie{Name: deviceCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: true})
}

func (s *Server) setDeviceCookie(w http.ResponseWriter, r *http.Request, id string) {
	secure := s.isHTTPS(r)
	name := deviceCookie
	if secure {
		name = hostPrefix + deviceCookie
	}
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: signedVersion + id + "." + s.deviceMAC(id), Path: "/",
		MaxAge: int(deviceTTL.Seconds()), HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure,
	})
}
