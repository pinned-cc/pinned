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
// matches and the hash's cost is below auth.BcryptCost, save gets a new
// hash at the current cost.
func checkStored(hash, password string, save func(newHash string)) bool {
	ok, rehash := auth.CheckPasswordHash(hash, password)
	if ok && rehash {
		if h, err := auth.HashPassword(password); err == nil {
			save(h)
		}
	}
	return ok
}

// rehashLock stores a stronger hash of a folder's lock password.
func (s *Server) rehashLock(f *store.Folder, hash string) {
	if err := s.st.ReplaceLockHash(f.ID, hash); err != nil {
		log.Printf("rehash lock: %v", err)
		return
	}
	f.LockHash = &hash
}

// rehashShare stores a stronger hash of a share password.
func (s *Server) rehashShare(sh *store.Share, hash string) {
	if _, err := s.st.UpdateShare(sh.Token, true, &hash, false, nil); err != nil {
		log.Printf("rehash share: %v", err)
		return
	}
	sh.PasswordHash = &hash
}
