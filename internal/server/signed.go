package server

import (
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
)

// signedVersion marks the format of a signed cookie value (device and
// unlock cookies): "v1." and then the value. A later format can take
// another marker and still read this one. Values from before the marker
// carry none and are read as v1; neither format can start with "v1." by
// accident, since both begin with a number or a base64url id without dots.
const signedVersion = "v1."

// signedPayload returns a signed cookie value without its version marker.
func signedPayload(v string) string { return strings.TrimPrefix(v, signedVersion) }

// checkStored checks a lock or share password against its stored hash
// (see auth.CheckKeyedPassword). When it matches and the hash is from
// before 0.1.11 or its cost is below auth.BcryptCost, save gets a new hash
// in the current form at the current cost; save may be nil.
func (s *Server) checkStored(hash, password string, save func(oldHash, newHash string)) bool {
	ok, rehash := auth.CheckKeyedPassword(s.secret, hash, password)
	if ok && rehash && save != nil {
		if h, err := auth.HashKeyedPassword(s.secret, password); err == nil {
			save(hash, h)
		}
	}
	return ok
}

// hashPassword is the stored hash of a new lock or share password.
func (s *Server) hashPassword(password string) (string, error) {
	return auth.HashKeyedPassword(s.secret, password)
}

// easyPassword reports whether a new lock or share password is common or
// made of the app's own words or its host name (see auth.CommonPassword).
func (s *Server) easyPassword(r *http.Request, password string) bool {
	hosts := []string{r.Host}
	if s.cfg.BaseURL != "" {
		if u, err := url.Parse(s.cfg.BaseURL); err == nil {
			hosts = append(hosts, u.Host)
		}
	}
	return auth.CommonPassword(password, auth.HostWords(hosts...)...)
}

// errEasyPassword is the answer to a password easyPassword refuses.
const errEasyPassword = "This password is too easy to guess. Choose another one."

// lockRehash stores a new hash of f's lock password through rehashLock.
func (s *Server) lockRehash(f *store.Folder) func(string, string) {
	return func(oldHash, h string) { s.rehashLock(f, oldHash, h) }
}

// shareRehash is lockRehash for a share password.
func (s *Server) shareRehash(sh *store.Share) func(string, string) {
	return func(oldHash, h string) { s.rehashShare(sh, oldHash, h) }
}

// rehashLock stores a new hash of a folder's lock password. Unlock cookies
// sign the lock's stamp, which stays, so they keep working. A lock set
// before schema 11 has no stamp and its cookies signed the hash: it gets a
// stamp now, so other browsers unlock it once more.
func (s *Server) rehashLock(f *store.Folder, oldHash, hash string) {
	if err := s.st.ReplaceLockHash(f.ID, oldHash, hash); err != nil {
		log.Printf("rehash lock: %v", err)
		return
	}
	if nf, err := s.st.Folder(f.ID); err == nil {
		*f = nf
	}
}

// rehashShare is rehashLock for a share password.
func (s *Server) rehashShare(sh *store.Share, oldHash, hash string) {
	if err := s.st.ReplaceShareHash(sh.Token, oldHash, hash); err != nil {
		log.Printf("rehash share: %v", err)
		return
	}
	if nsh, err := s.st.ShareByToken(sh.Token); err == nil {
		*sh = nsh
	}
}
