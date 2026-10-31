package store

import "testing"

// A password stamp changes when the password is set, changed or removed,
// and stays when the hash is only replaced. Rows from before schema 11
// have none: their key is the hash, as before, and a replaced hash gives
// them a stamp. A replace whose old hash no longer matches does nothing.
func TestPasswordStamps(t *testing.T) {
	s := open(t)
	f, _ := s.CreateFolder("Work", nil)
	key := func() string { got, _ := s.Folder(f.ID); return got.PasswordKey() }
	if key() != "" {
		t.Fatal("an open folder has a key")
	}
	if err := s.SetLock(f.ID, "hash1"); err != nil {
		t.Fatal(err)
	}
	k1 := key()
	if err := s.ReplaceLockHash(f.ID, "other", "hash2"); err != ErrNotFound {
		t.Errorf("rehash from a hash that is not stored: %v", err)
	}
	if err := s.ReplaceLockHash(f.ID, "hash1", "hash2"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Folder(f.ID); key() != k1 || *got.LockHash != "hash2" {
		t.Error("a rehash changed the lock's key")
	}
	if err := s.SetLock(f.ID, "hash3"); err != nil {
		t.Fatal(err)
	}
	if key() == k1 {
		t.Error("a new password kept the key")
	}
	s.db.Exec(`UPDATE folders SET lock_stamp = NULL WHERE id = ?`, f.ID)
	if key() != "hash3" {
		t.Errorf("a lock from before schema 11: key %q", key())
	}
	if err := s.ReplaceLockHash(f.ID, "hash3", "hash4"); err != nil {
		t.Errorf("rehash of a lock without a stamp: %v", err)
	}
	if got, _ := s.Folder(f.ID); got.LockStamp == nil || *got.LockHash != "hash4" || key() == "hash3" {
		t.Errorf("a rehash of a lock without a stamp: key %q", key())
	}
	if err := s.RemoveLock(f.ID); err != nil || key() != "" {
		t.Errorf("removed lock: key %q, %v", key(), err)
	}

	g, _ := s.CreateFolder("Shared", nil)
	h := "share1"
	sh, err := s.CreateShare(g.ID, "tok", &h, nil)
	if err != nil || sh.PasswordStamp == nil {
		t.Fatalf("share with a password has no stamp: %+v %v", sh, err)
	}
	k1 = sh.PasswordKey()
	s.ReplaceShareHash("tok", "share1", "share2")
	if sh, _ = s.ShareByToken("tok"); sh.PasswordKey() != k1 || *sh.PasswordHash != "share2" {
		t.Error("a rehash changed the share's key")
	}
	h = "share3"
	if sh, _ = s.UpdateShare("tok", true, &h, false, nil); sh.PasswordKey() == k1 {
		t.Error("a new share password kept the key")
	}
	if sh, _ = s.UpdateShare("tok", true, nil, false, nil); sh.PasswordStamp != nil || sh.PasswordKey() != "" {
		t.Errorf("a removed share password left a key: %+v", sh)
	}
	if err := s.ReplaceShareHash("tok", "share3", "x"); err != ErrNotFound {
		t.Errorf("rehash of a share without a password: %v", err)
	}
	h = "share4"
	s.UpdateShare("tok", true, &h, false, nil)
	s.db.Exec(`UPDATE shares SET password_stamp = NULL WHERE token = 'tok'`)
	if err := s.ReplaceShareHash("tok", "share4", "share5"); err != nil {
		t.Errorf("rehash of a share password without a stamp: %v", err)
	}
	if sh, _ = s.ShareByToken("tok"); sh.PasswordStamp == nil || *sh.PasswordHash != "share5" {
		t.Errorf("a rehash of a share password without a stamp: %+v", sh)
	}
}
