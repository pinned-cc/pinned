package server

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// security writes one log line for a security event, for example
//
//	security event=login.fail ip=192.0.2.7
//
// with the client address and then the fields in kv, given as name, value
// pairs. Never pass a secret: no password, code, token, cookie or hash.
func (s *Server) security(r *http.Request, event string, kv ...any) {
	if r != nil {
		ip := r.RemoteAddr
		if a := s.clientAddr(r); a.IsValid() {
			ip = a.String()
		}
		kv = append([]any{"ip", ip}, kv...)
	}
	s.log.Print(SecurityLine(event, kv...))
}

// SecurityLine is the text of a security log line, for events outside a
// request too, such as icon.fail from the icon fetches: the event, then the
// fields in kv as name, value pairs, quoted where needed.
func SecurityLine(event string, kv ...any) string {
	var b strings.Builder
	b.WriteString("security event=")
	b.WriteString(event)
	for i := 0; i+1 < len(kv); i += 2 {
		fmt.Fprintf(&b, " %v=%s", kv[i], logValue(fmt.Sprint(kv[i+1])))
	}
	return b.String()
}

// logValue quotes a value that holds spaces, quotes, an equals sign or
// anything unprintable, so a name chosen by the user cannot forge fields
// or lines.
func logValue(v string) string {
	if v == "" {
		return `""`
	}
	for _, c := range v {
		if c <= ' ' || c == '"' || c == '=' || !unicode.IsPrint(c) {
			return strconv.Quote(v)
		}
	}
	return v
}

// failed logs a failed check in area: area.fail, or area.wait when the
// client now has to wait. A wait is logged once per client and area while
// it lasts, so a client hammering during its wait cannot flood the log.
func (s *Server) failed(r *http.Request, area string, wait time.Duration, kv ...any) {
	if wait <= 0 {
		s.security(r, area+".fail", kv...)
		return
	}
	if s.firstIn(area+"|"+s.clientKey(r), wait) {
		s.security(r, area+".wait", append(kv, "seconds", int(wait.Seconds()+0.999))...)
	}
}

// firstIn reports whether key was not seen within the last d, and if so
// remembers it for d. It bounds lines a client can make the log write.
func (s *Server) firstIn(key string, d time.Duration) bool {
	now := s.st.Now()
	s.waitMu.Lock()
	defer s.waitMu.Unlock()
	for k, until := range s.waitLogged {
		if !now.Before(until) {
			delete(s.waitLogged, k)
		}
	}
	if _, seen := s.waitLogged[key]; seen {
		return false
	}
	s.waitLogged[key] = now.Add(d)
	return true
}

// logged logs event when err is nil and returns err, for one line call
// sites such as s.done(w, s.logged(r, "share.delete", err)).
func (s *Server) logged(r *http.Request, event string, err error, kv ...any) error {
	if err == nil {
		s.security(r, event, kv...)
	}
	return err
}
