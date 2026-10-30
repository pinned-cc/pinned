// Command pinned is a one user bookmarks app: one binary, one SQLite file.
package main

import (
	"context"
	"crypto/hmac"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/pinned-cc/pinned"
	"github.com/pinned-cc/pinned/internal/auth"
	"github.com/pinned-cc/pinned/internal/favicon"
	"github.com/pinned-cc/pinned/internal/jobs"
	"github.com/pinned-cc/pinned/internal/server"
	"github.com/pinned-cc/pinned/internal/store"
)

// version is set at build time with -ldflags "-X main.version=v1.2.3".
var version = "dev"

// minPassword is the shortest APP_PASSWORD the app starts with.
const minPassword = 8

func main() {
	showVersion := flag.Bool("version", false, "print the version and exit")
	healthcheck := flag.Bool("healthcheck", false, "check http://127.0.0.1:$PORT/health and exit 0 when it answers 200, 1 otherwise")
	flag.Parse()
	switch {
	case *showVersion:
		fmt.Println(version)
		return
	case *healthcheck:
		if err := checkHealth(env("PORT", "8080")); err != nil {
			fmt.Fprintln(os.Stderr, "pinned: unhealthy:", err)
			os.Exit(1)
		}
		return
	}
	log.SetFlags(0)
	log.SetOutput(stampWriter{w: os.Stderr, now: time.Now})
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "pinned:", err)
		os.Exit(1)
	}
}

// stampWriter starts every log line with the time in UTC as RFC 3339, so
// lines read the same whatever TZ the container has. The log package calls
// Write once per line.
type stampWriter struct {
	w   io.Writer
	now func() time.Time
}

func (s stampWriter) Write(p []byte) (int, error) {
	line := append([]byte(s.now().UTC().Format(time.RFC3339)+" "), p...)
	if _, err := s.w.Write(line); err != nil {
		return 0, err
	}
	return len(p), nil
}

// checkHealth is the container health check: the scratch image has no shell
// and no curl, so the binary asks itself.
func checkHealth(port string) error {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}

// parseIcons reads ICONS: on (the default) or off.
func parseIcons(v string) (off bool, err error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "on":
		return false, nil
	case "off":
		return true, nil
	}
	return false, fmt.Errorf("ICONS must be on or off, not %q", v)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// secretSetting reads a secret setting from the environment, or from the
// file named by name_FILE, the way Docker and compose secrets pass them.
// One trailing newline of the file is dropped. Setting both is an error.
func secretSetting(name string) (string, error) {
	v, file := os.Getenv(name), os.Getenv(name+"_FILE")
	if file == "" {
		return v, nil
	}
	if v != "" {
		return "", fmt.Errorf("%s and %s_FILE are both set. Set only one of them, then start again", name, name)
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return "", fmt.Errorf("%s_FILE: %w", name, err)
	}
	s := strings.TrimSuffix(strings.TrimSuffix(string(b), "\n"), "\r")
	if s == "" {
		return "", fmt.Errorf("%s_FILE names an empty file: %s", name, file)
	}
	return s, nil
}

// syncPassword checks APP_PASSWORD against the bcrypt hash stored at the
// last start, moving the HMAC record of older versions to a hash, and
// reports whether the password changed.
func syncPassword(st *store.Store, secret []byte, password string) (changed bool, err error) {
	return st.SyncPassword(func(stored string, legacy bool) (same, rehash bool) {
		if legacy {
			return hmac.Equal([]byte(stored), []byte(auth.PasswordFingerprint(secret, password))), true
		}
		return auth.CheckAppPassword(stored, password)
	}, func() (string, error) { return auth.HashAppPassword(password) })
}

func run() error {
	password, err := secretSetting("APP_PASSWORD")
	if err != nil {
		return err
	}
	if password == "" {
		return errors.New("APP_PASSWORD is not set. Set it, or APP_PASSWORD_FILE, to the password you want to log in with, then start again")
	}
	if utf8.RuneCountInString(password) < minPassword {
		return fmt.Errorf("APP_PASSWORD is shorter than %d characters. Choose a longer password, then start again", minPassword)
	}
	dataDir := env("DATA_DIR", "/data")
	port := env("PORT", "8080")
	sessionDays, err := strconv.Atoi(env("SESSION_DAYS", strconv.Itoa(server.DefaultSessionDays)))
	if err != nil || sessionDays <= 0 {
		return fmt.Errorf("SESSION_DAYS must be a positive number of days")
	}
	sessionMaxDays, err := strconv.Atoi(env("SESSION_MAX_DAYS", strconv.Itoa(server.DefaultSessionMaxDays)))
	if err != nil || sessionMaxDays <= 0 {
		return fmt.Errorf("SESSION_MAX_DAYS must be a positive number of days")
	}
	proxies, err := server.ParseProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return err
	}
	hstsMaxAge, err := server.ParseHSTS(os.Getenv("HSTS"))
	if err != nil {
		return err
	}
	iconsOff, err := parseIcons(os.Getenv("ICONS"))
	if err != nil {
		return err
	}
	iconHosts, err := favicon.ParseHosts(os.Getenv("ICON_HOSTS"))
	if err != nil {
		return err
	}
	totpSecret, err := secretSetting("TOTP_SECRET")
	if err != nil {
		return err
	}
	var totpKey []byte
	if totpSecret != "" {
		if totpKey, err = auth.ParseTOTPSecret(totpSecret); err != nil {
			return fmt.Errorf("TOTP_SECRET: %v. It takes 20 random bytes in base32, for example from: head -c 20 /dev/urandom | base32", err)
		}
	}

	privateUmask()
	for _, dir := range []string{dataDir, filepath.Join(dataDir, "icons"), filepath.Join(dataDir, "export")} {
		if err := os.MkdirAll(dir, dirMode); err != nil {
			return fmt.Errorf("cannot create %s: %w (check that DATA_DIR is writable)", dir, err)
		}
	}
	tightenModes(dataDir)
	secret, err := auth.LoadSecret(dataDir)
	if err != nil {
		return fmt.Errorf("secret key: %w", err)
	}
	st, err := store.Open(filepath.Join(dataDir, "bookmarks.db"))
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer st.Close()
	changed, err := syncPassword(st, secret, password)
	if err != nil {
		return fmt.Errorf("check the password: %w", err)
	}
	if changed {
		log.Print("security event=password.changed sessions=ended tokens=revoked")
		log.Print("APP_PASSWORD changed since the last start: every session was signed out and every API token revoked")
	}

	web, err := fs.Sub(pinned.Web, "web")
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	icons := favicon.NewPool(ctx, filepath.Join(dataDir, "icons"), st)
	icons.Configure(iconsOff, iconHosts)
	// Bookmarks still showing a letter get another try at start, so an
	// improved icon search reaches links that were saved before it. A link
	// whose icon failed store.IconGiveUp times is left alone until the next
	// version, or until it is saved, edited or refetched.
	if err := st.ResetIconFailures(version); err != nil {
		log.Printf("icon failures: %v", err)
	}
	givenUp, err := st.IconsGivenUp()
	if err != nil {
		log.Printf("icon failures: %v", err)
	}
	if all, err := st.Bookmarks(); err == nil {
		for _, b := range all {
			if key, ok := givenUp[b.ID]; ok && key == b.URLKey {
				continue
			}
			if b.Icon == nil && b.DeletedAt == nil {
				icons.Enqueue(b.ID)
			}
		}
	}
	var background sync.WaitGroup
	background.Add(1)
	go func() {
		defer background.Done()
		jobs.Run(ctx, st, dataDir)
	}()
	// Runs before st.Close: nothing in the background touches a closed store.
	defer func() {
		stop()
		icons.Wait()
		background.Wait()
	}()

	srv := server.New(server.Config{
		Password:       password,
		DataDir:        dataDir,
		BaseURL:        os.Getenv("BASE_URL"),
		SessionDays:    sessionDays,
		SessionMaxDays: sessionMaxDays,
		Version:        version,
		Changelog:      pinned.Changelog,
		TrustedProxies: proxies,
		HSTSMaxAge:     hstsMaxAge,
		TOTPKey:        totpKey,
	}, st, web, icons, secret)

	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- httpServer.ListenAndServe() }()
	log.Printf("pinned %s listening on :%s, data in %s", version, port, dataDir)
	if totpKey != nil {
		log.Print("the login asks for a code from an authenticator app (TOTP_SECRET is set)")
	}

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Print("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}
