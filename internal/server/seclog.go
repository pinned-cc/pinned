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
	var b strings.Builder
	b.WriteString("security event=")
	b.WriteString(event)
	if r != nil {
		ip := r.RemoteAddr
		if a := s.clientAddr(r); a.IsValid() {
			ip = a.String()
		}
		b.WriteString(" ip=")
		b.WriteString(logValue(ip))
	}
	for i := 0; i+1 < len(kv); i += 2 {
		fmt.Fprintf(&b, " %v=%s", kv[i], logValue(fmt.Sprint(kv[i+1])))
	}
	s.log.Print(b.String())
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
	key := area + "|" + s.clientKey(r)
	now := s.st.Now()
	s.waitMu.Lock()
	for k, until := range s.waitLogged {
		if !now.Before(until) {
			delete(s.waitLogged, k)
		}
	}
	_, seen := s.waitLogged[key]
	if !seen {
		s.waitLogged[key] = now.Add(wait)
	}
	s.waitMu.Unlock()
	if !seen {
		s.security(r, area+".wait", append(kv, "seconds", int(wait.Seconds()+0.999))...)
	}
}

// logged logs event when err is nil and returns err, for one line call
// sites such as s.done(w, s.logged(r, "share.delete", err)).
func (s *Server) logged(r *http.Request, event string, err error, kv ...any) error {
	if err == nil {
		s.security(r, event, kv...)
	}
	return err
}
