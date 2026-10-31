package server

import (
	"log"
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

// checkStored checks password against a stored bcrypt hash. When it
// matches, the hash's cost is below auth.BcryptCost and save is not nil,
// save gets a new hash at the current cost.
func checkStored(hash, password string, save func(newHash string)) bool {
	ok, rehash := auth.CheckPasswordHash(hash, password)
	if ok && rehash && save != nil {
		if h, err := auth.HashPassword(password); err == nil {
			save(h)
		}
	}
	return ok
}

// lockRehash is what checkStored saves a stronger hash of f's lock password
// with, or nil for a lock set before schema 11: it has no stamp, its
// unlock cookies sign the hash, and a new hash would end them. Every
// release before 0.1.11 hashed at cost 10, the cost used now.
func (s *Server) lockRehash(f *store.Folder) func(string) {
	if f.LockStamp == nil {
		return nil
	}
	return func(h string) { s.rehashLock(f, h) }
}

// shareRehash is lockRehash for a share password.
func (s *Server) shareRehash(sh *store.Share) func(string) {
	if sh.PasswordStamp == nil {
		return nil
	}
	return func(h string) { s.rehashShare(sh, h) }
}

// rehashLock stores a stronger hash of a folder's lock password. Unlock
// cookies sign the lock's stamp, which stays, so they keep working.
func (s *Server) rehashLock(f *store.Folder, hash string) {
	if err := s.st.ReplaceLockHash(f.ID, hash); err != nil {
		log.Printf("rehash lock: %v", err)
		return
	}
	if nf, err := s.st.Folder(f.ID); err == nil {
		*f = nf
	}
}

// rehashShare stores a stronger hash of a share password, keeping its
// stamp and so the unlock cookies of other browsers.
func (s *Server) rehashShare(sh *store.Share, hash string) {
	if err := s.st.ReplaceShareHash(sh.Token, hash); err != nil {
		log.Printf("rehash share: %v", err)
		return
	}
	if nsh, err := s.st.ShareByToken(sh.Token); err == nil {
		*sh = nsh
	}
}
