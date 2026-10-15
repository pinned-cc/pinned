package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
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
