// Command pinned is a one user bookmarks app: one binary, one SQLite file.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
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
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "pinned:", err)
		os.Exit(1)
	}
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

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func run() error {
	password := os.Getenv("APP_PASSWORD")
	if password == "" {
		return errors.New("APP_PASSWORD is not set. Set it to the password you want to log in with, then start again")
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
	proxies, err := server.ParseProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return err
	}

	for _, dir := range []string{dataDir, filepath.Join(dataDir, "icons"), filepath.Join(dataDir, "export")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("cannot create %s: %w (check that DATA_DIR is writable)", dir, err)
		}
	}
	secret, err := auth.LoadSecret(dataDir)
	if err != nil {
		return fmt.Errorf("secret key: %w", err)
	}
	st, err := store.Open(filepath.Join(dataDir, "bookmarks.db"))
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer st.Close()
	changed, err := st.SyncPasswordFingerprint(auth.PasswordFingerprint(secret, password))
	if err != nil {
		return fmt.Errorf("check the password: %w", err)
	}
	if changed {
		log.Print("APP_PASSWORD changed since the last start: every session was signed out (API tokens stay)")
	}

	web, err := fs.Sub(pinned.Web, "web")
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	icons := favicon.NewPool(ctx, filepath.Join(dataDir, "icons"), st)
	// Bookmarks still showing a letter get another try at every start, so an
	// improved icon search reaches links that were saved before it.
	if all, err := st.Bookmarks(); err == nil {
		for _, b := range all {
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
		Version:        version,
		TrustedProxies: proxies,
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
