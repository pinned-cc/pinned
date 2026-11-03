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
	"net/netip"
	"net/url"
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
	licenses := flag.Bool("licenses", false, "print the licences of the third party parts in the binary and exit")
	flag.Parse()
	switch {
	case *showVersion:
		fmt.Println(version)
		return
	case *licenses:
		fmt.Print(thirdPartyNotices())
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

// thirdPartyNotices is every licence notice a third party part of the binary
// asks to travel with it: the common and breached password lists (SecLists,
// MIT) and the Geist fonts (SIL Open Font License, also served as
// /static/fonts/OFL.txt).
func thirdPartyNotices() string {
	fonts, err := fs.ReadFile(pinned.Web, "web/fonts/OFL.txt")
	if err != nil {
		fonts = []byte("web/fonts/OFL.txt is missing from this build\n")
	}
	return "Pinned is under the GNU Affero General Public License, version 3 only (LICENSE). It holds these third party parts:\n\n" +
		"== Common and breached passwords (internal/auth/common-passwords.txt, internal/auth/breached) ==\n\n" + auth.CommonListNotice +
		"\n== Geist and Geist Mono fonts (web/fonts) ==\n\n" + string(fonts)
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
//
// An easy password (see easyAppPassword) is refused on a new install and
// when it replaces another password. When the same password already ran
// under an earlier version it is kept, so an upgrade still starts, and
// kept reports that; the caller then warns.
func syncPassword(st *store.Store, secret []byte, password string, easy bool) (changed, kept bool, err error) {
	same := false
	changed, err = st.SyncPassword(func(stored string, legacy bool) (bool, bool) {
		var rehash bool
		if legacy {
			same, rehash = hmac.Equal([]byte(stored), []byte(auth.PasswordFingerprint(secret, password))), true
		} else {
			same, rehash = auth.CheckAppPassword(stored, password)
		}
		return same, rehash
	}, func() (string, error) {
		if easy && !same {
			return "", errEasyPassword
		}
		return auth.HashAppPassword(password)
	})
	if errors.Is(err, errEasyPassword) {
		return false, false, err
	}
	return changed, easy && err == nil, err
}

var errEasyPassword = errors.New("APP_PASSWORD is too easy to guess: it is a common password, or made of words like pinned, password or your host name. Choose another one, then start again")

// easyAppPassword reports whether the app password is common or made of
// the app's own words or the host name of BASE_URL or of this machine.
func easyAppPassword(password, baseURL string) bool {
	var hosts []string
	if u, err := url.Parse(baseURL); err == nil && u.Host != "" {
		hosts = append(hosts, u.Host)
	}
	if h, err := os.Hostname(); err == nil {
		hosts = append(hosts, h)
	}
	return auth.CommonPassword(password, auth.HostWords(hosts...)...)
}

// settings is what run reads from the environment before it touches the
// data folder.
type settings struct {
	password       string
	dataDir        string
	port           string
	sessionDays    int
	sessionMaxDays int
	proxies        []netip.Prefix
	hstsMaxAge     int
	iconsOff       bool
	iconHosts      favicon.Hosts
	totpKey        []byte
	easy           bool
}

// readSettings reads and checks every setting, and says what to fix when
// one is wrong.
func readSettings() (c settings, err error) {
	if c.password, err = secretSetting("APP_PASSWORD"); err != nil {
		return c, err
	}
	if c.password == "" {
		return c, errors.New("APP_PASSWORD is not set. Set it, or APP_PASSWORD_FILE, to the password you want to log in with, then start again")
	}
	if utf8.RuneCountInString(c.password) < minPassword {
		return c, fmt.Errorf("APP_PASSWORD is shorter than %d characters. Choose a longer password, then start again", minPassword)
	}
	// An easy password is refused in run, unless it already ran before.
	c.easy = easyAppPassword(c.password, os.Getenv("BASE_URL"))
	c.dataDir = env("DATA_DIR", "/data")
	c.port = env("PORT", "8080")
	c.sessionDays, err = strconv.Atoi(env("SESSION_DAYS", strconv.Itoa(server.DefaultSessionDays)))
	if err != nil || c.sessionDays <= 0 {
		return c, fmt.Errorf("SESSION_DAYS must be a positive number of days")
	}
	c.sessionMaxDays, err = strconv.Atoi(env("SESSION_MAX_DAYS", strconv.Itoa(server.DefaultSessionMaxDays)))
	if err != nil || c.sessionMaxDays <= 0 {
		return c, fmt.Errorf("SESSION_MAX_DAYS must be a positive number of days")
	}
	if c.proxies, err = server.ParseProxies(os.Getenv("TRUSTED_PROXIES")); err != nil {
		return c, err
	}
	if c.hstsMaxAge, err = server.ParseHSTS(os.Getenv("HSTS")); err != nil {
		return c, err
	}
	if c.iconsOff, err = parseIcons(os.Getenv("ICONS")); err != nil {
		return c, err
	}
	if c.iconHosts, err = favicon.ParseHosts(os.Getenv("ICON_HOSTS")); err != nil {
		return c, err
	}
	totpSecret, err := secretSetting("TOTP_SECRET")
	if err != nil {
		return c, err
	}
	if totpSecret != "" {
		if c.totpKey, err = auth.ParseTOTPSecret(totpSecret); err != nil {
			return c, fmt.Errorf("TOTP_SECRET: %v. It takes 20 random bytes in base32, for example from: head -c 20 /dev/urandom | base32", err)
		}
	}
	return c, nil
}

// prepareDataDir makes the data folder and its icons and export folders and
// checks that a file can be written there. A folder owned by another user,
// as when Docker made a missing ./data as root, gets a message that names
// the user Pinned runs as and the chown that fixes it.
func prepareDataDir(dataDir string) error {
	for _, dir := range []string{dataDir, filepath.Join(dataDir, "icons"), filepath.Join(dataDir, "export")} {
		if err := os.MkdirAll(dir, dirMode); err != nil {
			return dataDirError(dataDir, dir, os.Getuid(), err)
		}
	}
	f, err := os.CreateTemp(dataDir, ".write-check-*")
	if err != nil {
		return dataDirError(dataDir, dataDir, os.Getuid(), err)
	}
	f.Close()
	return os.Remove(f.Name())
}

func dataDirError(dataDir, dir string, uid int, err error) error {
	if errors.Is(err, fs.ErrPermission) {
		return fmt.Errorf("cannot write to %s as user %d, the user Pinned runs as. On the host, give the folder you mount at %s to that user, for example: sudo chown -R %d:%d ./data. Then start again", dir, uid, dataDir, uid, uid)
	}
	return fmt.Errorf("cannot create %s: %w (check that DATA_DIR is writable)", dir, err)
}

func run() error {
	c, err := readSettings()
	if err != nil {
		return err
	}
	password, dataDir, port, totpKey := c.password, c.dataDir, c.port, c.totpKey

	privateUmask()
	if err := prepareDataDir(dataDir); err != nil {
		return err
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
	changed, easyKept, err := syncPassword(st, secret, password, c.easy)
	if errors.Is(err, errEasyPassword) {
		return err
	}
	if err != nil {
		return fmt.Errorf("check the password: %w", err)
	}
	if easyKept {
		log.Print("security event=password.easy action=warned")
		log.Print("WARNING: APP_PASSWORD is too easy to guess: it is a common password, or made of words like pinned, password or your host name. Pinned starts anyway because it ran with it before. Set a stronger APP_PASSWORD and restart")
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
	icons.Configure(c.iconsOff, c.iconHosts)
	icons.SetLog(func(event string, kv ...any) { log.Print(server.SecurityLine(event, kv...)) })
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
		SessionDays:    c.sessionDays,
		SessionMaxDays: c.sessionMaxDays,
		Version:        version,
		Changelog:      pinned.Changelog,
		TrustedProxies: c.proxies,
		HSTSMaxAge:     c.hstsMaxAge,
		TOTPKey:        totpKey,
		EasyPassword:   easyKept,
	}, st, web, icons, secret)

	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    64 << 10,
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
