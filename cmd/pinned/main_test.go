package main

import (
	"bytes"
	"database/sql"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/store"
)

func TestRefusesToStartWithoutPassword(t *testing.T) {
	t.Setenv("APP_PASSWORD", "")
	t.Setenv("DATA_DIR", t.TempDir())
	err := run()
	if err == nil || !strings.Contains(err.Error(), "APP_PASSWORD is not set") {
		t.Fatalf("want a clear error, got %v", err)
	}
}

func TestRefusesShortPassword(t *testing.T) {
	t.Setenv("APP_PASSWORD", "seven77")
	t.Setenv("DATA_DIR", t.TempDir())
	err := run()
	if err == nil || !strings.Contains(err.Error(), "shorter than 8 characters") {
		t.Fatalf("want a clear error, got %v", err)
	}
}

func TestRefusesBadSettings(t *testing.T) {
	t.Setenv("APP_PASSWORD", "long enough")
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("TRUSTED_PROXIES", "10.0.0.0/8, not a cidr")
	if err := run(); err == nil || !strings.Contains(err.Error(), "TRUSTED_PROXIES") {
		t.Fatalf("bad proxies: %v", err)
	}
	t.Setenv("TRUSTED_PROXIES", "")
	t.Setenv("SESSION_DAYS", "0")
	if err := run(); err == nil || !strings.Contains(err.Error(), "SESSION_DAYS") {
		t.Fatalf("bad session days: %v", err)
	}
	t.Setenv("SESSION_DAYS", "")
	t.Setenv("SESSION_MAX_DAYS", "forever")
	if err := run(); err == nil || !strings.Contains(err.Error(), "SESSION_MAX_DAYS") {
		t.Fatalf("bad session max days: %v", err)
	}
	t.Setenv("SESSION_MAX_DAYS", "")
	t.Setenv("HSTS", "yes please")
	if err := run(); err == nil || !strings.Contains(err.Error(), "HSTS") {
		t.Fatalf("bad hsts: %v", err)
	}
	t.Setenv("HSTS", "")
	t.Setenv("TOTP_SECRET", "JBSWY3DPEHPK3PXP")
	if err := run(); err == nil || !strings.Contains(err.Error(), "TOTP_SECRET") || !strings.Contains(err.Error(), "base32") {
		t.Fatalf("short totp secret: %v", err)
	}
	t.Setenv("TOTP_SECRET_FILE", "/nonexistent")
	if err := run(); err == nil || !strings.Contains(err.Error(), "both set") {
		t.Fatalf("totp secret twice: %v", err)
	}
	t.Setenv("TOTP_SECRET", "")
	t.Setenv("TOTP_SECRET_FILE", "")
}

func TestCheckHealth(t *testing.T) {
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
	}))
	defer srv.Close()
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	if err := checkHealth(port); err != nil {
		t.Errorf("healthy: %v", err)
	}
	status = http.StatusServiceUnavailable
	if err := checkHealth(port); err == nil {
		t.Error("503 counted as healthy")
	}
	srv.Close()
	if err := checkHealth(port); err == nil {
		t.Error("no server counted as healthy")
	}
}

func TestRunServesAndStops(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, port, _ := net.SplitHostPort(l.Addr().String())
	l.Close()
	t.Setenv("APP_PASSWORD", "long enough")
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("PORT", port)
	t.Setenv("SESSION_DAYS", "")
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1")
	errc := make(chan error, 1)
	go func() { errc <- run() }()
	deadline := time.Now().Add(10 * time.Second)
	for checkHealth(port) != nil {
		if time.Now().After(deadline) {
			t.Fatal("server did not come up")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-errc:
		if err != nil {
			t.Errorf("shutdown: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("run did not return after SIGTERM")
	}
}

func TestRefusesBadIconSettings(t *testing.T) {
	t.Setenv("APP_PASSWORD", "long enough")
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("ICONS", "maybe")
	if err := run(); err == nil || !strings.Contains(err.Error(), "ICONS must be on or off") {
		t.Fatalf("bad ICONS: %v", err)
	}
	t.Setenv("ICONS", "off")
	t.Setenv("ICON_HOSTS", "https://example.com")
	if err := run(); err == nil || !strings.Contains(err.Error(), "ICON_HOSTS") {
		t.Fatalf("bad ICON_HOSTS: %v", err)
	}
	for v, off := range map[string]bool{"": false, "on": false, "OFF": true, " off ": true} {
		if got, err := parseIcons(v); err != nil || got != off {
			t.Errorf("ICONS=%q: %v %v", v, got, err)
		}
	}
}

func TestLogLinesCarryUTC(t *testing.T) {
	var buf bytes.Buffer
	zone := time.FixedZone("CET", 3600)
	l := log.New(stampWriter{w: &buf, now: func() time.Time { return time.Date(2026, 10, 31, 9, 5, 0, 0, zone) }}, "", 0)
	l.Print("listening")
	if got := buf.String(); got != "2026-10-31T08:05:00Z listening\n" {
		t.Errorf("log line %q", got)
	}
}

func TestPasswordFromFile(t *testing.T) {
	dir := t.TempDir()
	file := dir + "/pw"
	os.WriteFile(file, []byte("from a file \n"), 0o600)
	t.Setenv("APP_PASSWORD", "")
	t.Setenv("APP_PASSWORD_FILE", file)
	if got, err := secretSetting("APP_PASSWORD"); err != nil || got != "from a file " {
		t.Errorf("got %q, %v: one trailing newline goes, the rest stays", got, err)
	}
	os.WriteFile(file, []byte("windows\r\n"), 0o600)
	if got, _ := secretSetting("APP_PASSWORD"); got != "windows" {
		t.Errorf("got %q", got)
	}
	t.Setenv("APP_PASSWORD", "long enough")
	t.Setenv("DATA_DIR", dir)
	if err := run(); err == nil || !strings.Contains(err.Error(), "both set") {
		t.Errorf("both set: %v", err)
	}
	t.Setenv("APP_PASSWORD", "")
	t.Setenv("APP_PASSWORD_FILE", dir+"/missing")
	if err := run(); err == nil || !strings.Contains(err.Error(), "APP_PASSWORD_FILE") {
		t.Errorf("missing file: %v", err)
	}
	os.WriteFile(file, []byte("\n"), 0o600)
	t.Setenv("APP_PASSWORD_FILE", file)
	if err := run(); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Errorf("empty file: %v", err)
	}
}

func TestPasswordStoredAsBcrypt(t *testing.T) {
	path := t.TempDir() + "/bookmarks.db"
	st, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("0123456789abcdef0123456789abcdef")
	setting := func(key string) string {
		var v string
		db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
		return v
	}
	cost := func() int {
		c, _ := bcrypt.Cost([]byte(setting("password_hash")))
		return c
	}

	// An install from before keeps an HMAC: the first start checks it and
	// replaces it with a bcrypt hash, without signing anyone out.
	db.Exec(`INSERT INTO settings (key, value) VALUES ('password_hmac', ?)`, auth.PasswordFingerprint(secret, "first password"))
	if changed, err := syncPassword(st, secret, "first password"); err != nil || changed {
		t.Fatalf("move: changed=%v err=%v", changed, err)
	}
	if setting("password_hmac") != "" || bcrypt.CompareHashAndPassword([]byte(setting("password_hash")), []byte(auth.AppPasswordKey("first password"))) != nil {
		t.Fatal("the HMAC was not replaced by a bcrypt hash of the password")
	}
	before := setting("password_hash")
	if changed, _ := syncPassword(st, secret, "first password"); changed || setting("password_hash") != before {
		t.Error("an unchanged password rewrote its hash")
	}
	if changed, _ := syncPassword(st, secret, "second password"); !changed {
		t.Error("a new password was not noticed")
	}

	// A hash below the current cost is replaced at the next start.
	weak, _ := bcrypt.GenerateFromPassword([]byte(auth.AppPasswordKey("second password")), bcrypt.MinCost)
	db.Exec(`UPDATE settings SET value = ? WHERE key = 'password_hash'`, string(weak))
	if changed, _ := syncPassword(st, secret, "second password"); changed || cost() != auth.BcryptCost {
		t.Errorf("weak hash: changed=%v cost=%d", changed, cost())
	}

	// An app password longer than bcrypt's 72 bytes still starts, and a
	// change after its 72nd byte is noticed.
	long := strings.Repeat("long password ", 8)
	if _, err := syncPassword(st, secret, long); err != nil {
		t.Fatalf("long password: %v", err)
	}
	if changed, err := syncPassword(st, secret, long+"x"); err != nil || !changed {
		t.Errorf("a change after byte 72: changed=%v err=%v", changed, err)
	}
}
