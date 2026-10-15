// Package urlkey turns a bookmark URL into the key that decides whether two
// bookmarks are the same. Host and port together are the identity: two URLs
// on one host with different ports are two bookmarks.
package urlkey

import (
	"errors"
	"net"
	"net/url"
	"strings"
)

// ErrInvalid is returned for anything that is not an http or https URL with a host.
var ErrInvalid = errors.New("url must start with http:// or https:// and have a host")

// Key returns the identity key for raw. The rule:
//   - scheme and host are lowercased
//   - :80 is removed for http and :443 for https
//   - the fragment is dropped
//   - an empty path becomes "/" (http://h and http://h/ are the same page)
//   - everything else (userinfo, path, query) is kept byte for byte
func Key(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if i := strings.IndexByte(raw, '#'); i >= 0 {
		raw = raw[:i]
	}
	schemeEnd := strings.Index(raw, "://")
	if schemeEnd <= 0 {
		return "", ErrInvalid
	}
	scheme := strings.ToLower(raw[:schemeEnd])
	if scheme != "http" && scheme != "https" {
		return "", ErrInvalid
	}
	rest := raw[schemeEnd+3:]
	authEnd := strings.IndexAny(rest, "/?")
	if authEnd < 0 {
		authEnd = len(rest)
	}
	authority, tail := rest[:authEnd], rest[authEnd:]

	userinfo := ""
	if at := strings.LastIndexByte(authority, '@'); at >= 0 {
		userinfo, authority = authority[:at+1], authority[at+1:]
	}
	hostport := strings.ToLower(authority)
	hostport = stripDefaultPort(scheme, hostport)
	if hostname(hostport) == "" {
		return "", ErrInvalid
	}
	if tail == "" || tail[0] == '?' {
		tail = "/" + tail
	}
	key := scheme + "://" + userinfo + hostport + tail
	if _, err := url.Parse(key); err != nil {
		return "", ErrInvalid
	}
	return key, nil
}

// Host returns the label shown next to a bookmark: host plus port, with the
// default port removed. An IP stays an IP. It returns "" for an invalid URL.
func Host(raw string) string {
	key, err := Key(raw)
	if err != nil {
		return ""
	}
	u, err := url.Parse(key)
	if err != nil {
		return ""
	}
	return u.Host
}

// Origin returns scheme://host[:port] of the key, used to find another
// bookmark on the same host and port.
func Origin(raw string) string {
	key, err := Key(raw)
	if err != nil {
		return ""
	}
	u, _ := url.Parse(key)
	return u.Scheme + "://" + u.Host
}

func stripDefaultPort(scheme, hostport string) string {
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		return hostport
	}
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		if strings.Contains(host, ":") {
			return "[" + host + "]"
		}
		return host
	}
	return hostport
}

func hostname(hostport string) string {
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return host
	}
	return strings.Trim(hostport, "[]")
}
