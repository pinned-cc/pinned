package server

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAcceptsGzip(t *testing.T) {
	for _, c := range []struct {
		h    []string
		want bool
	}{
		{nil, false},
		{[]string{""}, false},
		{[]string{"gzip"}, true},
		{[]string{"GZIP"}, true},
		{[]string{"gzip, deflate, br"}, true},
		{[]string{"br, gzip;q=0.5"}, true},
		{[]string{"gzip;q=0"}, false},
		{[]string{"gzip; q=0.000"}, false},
		{[]string{"gzip;q=bad"}, false},
		{[]string{"deflate, br"}, false},
		{[]string{"identity"}, false},
		{[]string{"*"}, true},
		{[]string{"*;q=0"}, false},
		{[]string{"*, gzip;q=0"}, false},
		{[]string{"gzip;q=0, *"}, false},
		{[]string{"br", "gzip"}, true},
		{[]string{"x-gzip"}, false},
	} {
		if got := acceptsGzip(c.h); got != c.want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", c.h, got, c.want)
		}
	}
}

// stateWith asks for /api/state with the given Accept-Encoding, sent as is: a
// header set by hand turns off the client's own transparent decompression.
func (e *env) stateWith(enc string) *http.Response {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/state", nil)
	if enc != "" {
		req.Header.Set("Accept-Encoding", enc)
	}
	tr := &http.Transport{DisableCompression: true}
	defer tr.CloseIdleConnections()
	c := &http.Client{Jar: e.client.Jar, Transport: tr}
	resp, err := c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	return resp
}

func TestStateGzip(t *testing.T) {
	e := newEnv(t, Config{})
	e.login()
	for i := 0; i < 50; i++ {
		e.expect("POST", "/api/bookmarks", map[string]any{"url": "https://example.com/page/" + itoa(int64(i)), "title": "A page with a long enough title"}, 201)
	}

	plainResp := e.stateWith("")
	plain := readAll(plainResp)
	if ce := plainResp.Header.Get("Content-Encoding"); ce != "" {
		t.Fatalf("no Accept-Encoding: Content-Encoding %q", ce)
	}
	if !strings.Contains(plainResp.Header.Get("Vary"), "Accept-Encoding") {
		t.Errorf("plain answer lacks Vary: Accept-Encoding: %q", plainResp.Header.Values("Vary"))
	}
	var want stateJSON
	if err := json.Unmarshal(plain, &want); err != nil || len(want.Bookmarks) != 50 {
		t.Fatalf("plain state: %v, %d bookmarks", err, len(want.Bookmarks))
	}

	resp := e.stateWith("gzip, deflate, br")
	body := readAll(resp)
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if ce := resp.Header.Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("Content-Encoding %q, want gzip", ce)
	}
	if !strings.Contains(resp.Header.Get("Vary"), "Accept-Encoding") {
		t.Errorf("Vary %q", resp.Header.Values("Vary"))
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type %q", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control %q", cc)
	}
	if len(body) >= len(plain) {
		t.Errorf("gzipped %d bytes, plain %d", len(body), len(plain))
	}
	zr, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	unzipped, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(unzipped, plain) {
		t.Errorf("gzipped state differs from the plain one")
	}

	// refused with q=0: plain again
	resp = e.stateWith("gzip;q=0")
	if ce := resp.Header.Get("Content-Encoding"); ce != "" {
		t.Errorf("gzip;q=0: Content-Encoding %q", ce)
	}
	if b := readAll(resp); !bytes.Equal(b, plain) {
		t.Errorf("gzip;q=0: body differs from the plain one")
	}

	// the pooled compressor is reused: a second gzipped answer reads the same
	resp = e.stateWith("gzip")
	zr, err = gzip.NewReader(bytes.NewReader(readAll(resp)))
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := io.ReadAll(zr); !bytes.Equal(again, plain) {
		t.Errorf("second gzipped state differs")
	}
}

func TestStateGzipNeedsLogin(t *testing.T) {
	e := newEnv(t, Config{})
	resp := e.stateWith("gzip")
	body := readAll(resp)
	if resp.StatusCode != 401 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if ce := resp.Header.Get("Content-Encoding"); ce != "" {
		t.Errorf("refusal is gzipped: %q", ce)
	}
	if !strings.Contains(string(body), "not logged in") {
		t.Errorf("body %q", body)
	}
}
