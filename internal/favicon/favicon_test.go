package favicon

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	ico "github.com/sergeymakinen/go-ico"

	"github.com/pinned-cc/pinned/internal/store"
)

func TestChoose(t *testing.T) {
	base, _ := url.Parse("http://10.0.0.5:8080/app/page")
	cases := []struct {
		name string
		html string
		want Candidates
	}{
		{
			name: "nothing",
			html: `<html><head><title>x</title></head><body></body></html>`,
			want: Candidates{Apple: []string{}, Icons: []string{}},
		},
		{
			name: "apple sizes sorted largest first",
			html: `<link rel="apple-touch-icon" sizes="120x120" href="/a120.png">
			       <link rel="apple-touch-icon" sizes="180x180" href="/a180.png">
			       <link rel="apple-touch-icon-precomposed" href="a.png">`,
			want: Candidates{
				Apple: []string{"http://10.0.0.5:8080/a180.png", "http://10.0.0.5:8080/a120.png", "http://10.0.0.5:8080/app/a.png"},
				Icons: []string{},
			},
		},
		{
			name: "shortcut icon and sized icons, svg counts as largest",
			html: `<LINK REL="shortcut icon" HREF="/favicon.ico">
			       <link rel="icon" type="image/png" sizes="32x32" href="/i32.png">
			       <link rel="icon" type="image/svg+xml" href="/i.svg">
			       <link rel="icon" sizes="16x16 64x64" href="//cdn.example.com/i64.png">`,
			want: Candidates{
				Apple: []string{},
				Icons: []string{"http://10.0.0.5:8080/i.svg", "http://cdn.example.com/i64.png", "http://10.0.0.5:8080/i32.png", "http://10.0.0.5:8080/favicon.ico"},
			},
		},
		{
			name: "manifest and base href",
			html: `<base href="https://example.org/sub/"><link rel="manifest" href="site.webmanifest"><link rel="icon" href="f.png">`,
			want: Candidates{
				Apple:    []string{},
				Manifest: "https://example.org/sub/site.webmanifest",
				Icons:    []string{"https://example.org/sub/f.png"},
			},
		},
		{
			name: "data uris and links after body are ignored",
			html: `<link rel="icon" href="data:image/png;base64,AAAA"><body><link rel="icon" href="/late.png">`,
			want: Candidates{Apple: []string{}, Icons: []string{}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Choose(base, strings.NewReader(c.html))
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("got %#v\nwant %#v", got, c.want)
			}
		})
	}
}

func TestManifestIcons(t *testing.T) {
	base, _ := url.Parse("http://homelab:3000/manifest.json")
	data := []byte(`{"icons":[{"src":"/i192.png","sizes":"192x192"},{"src":"i512.png","sizes":"512x512"},{"src":""}]}`)
	got := ManifestIcons(base, data)
	want := []string{"http://homelab:3000/i512.png", "http://homelab:3000/i192.png"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
	if ManifestIcons(base, []byte("not json")) != nil {
		t.Error("bad json should give nil")
	}
}

// square returns a size by size image filled with fill and an edge ring of edge.
func square(size int, fill, edge color.Color) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			c := fill
			if x < 2 || y < 2 || x >= size-2 || y >= size-2 {
				c = edge
			}
			img.Set(x, y, c)
		}
	}
	return img
}

func pngBytes(img image.Image) []byte {
	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}

func TestEdgeColor(t *testing.T) {
	img := square(16, color.RGBA{255, 255, 255, 255}, color.RGBA{0x12, 0x34, 0x56, 255})
	if got := EdgeColor(img); got == nil || *got != "#123456" {
		t.Errorf("got %v", got)
	}
	clear := square(16, color.RGBA{255, 0, 0, 255}, color.RGBA{0, 0, 0, 0})
	if got := EdgeColor(clear); got != nil {
		t.Errorf("transparent edge should give nil, got %s", *got)
	}
}

func TestProcess(t *testing.T) {
	red := square(8, color.RGBA{255, 255, 255, 255}, color.RGBA{255, 0, 0, 255})

	icon, err := Process(pngBytes(red))
	if err != nil || icon.Ext != "png" || icon.Tile == nil || *icon.Tile != "#ff0000" {
		t.Errorf("png: %+v %v", icon, err)
	}

	var icoBuf bytes.Buffer
	small := square(16, color.RGBA{0, 0, 0, 255}, color.RGBA{0, 0, 255, 255})
	big := square(32, color.RGBA{0, 0, 0, 255}, color.RGBA{0, 255, 0, 255})
	if err := ico.EncodeAll(&icoBuf, []image.Image{small, big}); err != nil {
		t.Fatal(err)
	}
	icon, err = Process(icoBuf.Bytes())
	if err != nil || icon.Ext != "png" {
		t.Fatalf("ico: %+v %v", icon, err)
	}
	decoded, err := png.Decode(bytes.NewReader(icon.Data))
	if err != nil || decoded.Bounds().Dx() != 32 {
		t.Errorf("ico should become the 32 px frame as png, got %v %v", decoded.Bounds(), err)
	}
	if *icon.Tile != "#00ff00" {
		t.Errorf("ico tile %s", *icon.Tile)
	}

	icon, err = Process([]byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`))
	if err != nil || icon.Ext != "svg" || icon.Tile != nil {
		t.Errorf("svg: %+v %v", icon, err)
	}

	if _, err := Process([]byte("<html>login</html>")); err == nil {
		t.Error("html should not be an icon")
	}
}

func TestFindOrder(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<head><link rel="icon" href="/small.png"><link rel="apple-touch-icon" href="/missing.png"><link rel="manifest" href="/m.json"></head>`))
	})
	mux.HandleFunc("/m.json", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"icons":[{"src":"/big.png","sizes":"512x512"}]}`))
	})
	mux.HandleFunc("/big.png", func(w http.ResponseWriter, r *http.Request) {
		w.Write(pngBytes(square(8, color.White, color.RGBA{1, 2, 3, 255})))
	})
	mux.HandleFunc("/small.png", func(w http.ResponseWriter, r *http.Request) {
		w.Write(pngBytes(square(8, color.White, color.RGBA{9, 9, 9, 255})))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	icon, err := Find(context.Background(), srv.Client(), srv.URL+"/")
	if err != nil {
		t.Fatal(err)
	}
	// The apple icon is a 404, so the manifest icon wins over the link icon.
	if *icon.Tile != "#010203" {
		t.Errorf("wrong icon chosen, tile %s", *icon.Tile)
	}
}

func TestFindFallsBackToFaviconICO(t *testing.T) {
	var icoBuf bytes.Buffer
	ico.Encode(&icoBuf, square(16, color.White, color.RGBA{200, 100, 50, 255}))
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<title>no icons</title>")) })
	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) { w.Write(icoBuf.Bytes()) })
	srv := httptest.NewServer(mux)
	defer srv.Close()

	icon, err := Find(context.Background(), srv.Client(), srv.URL+"/deep/path")
	if err != nil || icon.Ext != "png" || *icon.Tile != "#c86432" {
		t.Errorf("got %+v %v", icon, err)
	}
}

func TestPoolRunStoresIcon(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		w.Write(pngBytes(square(8, color.White, color.RGBA{10, 20, 30, 255})))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	b, _, err := st.Create(store.NewBookmark{Title: "Local", URL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	// The real guarded client: the bookmark is on a loopback host, so
	// that host may be reached.
	p := &Pool{dir: dir, store: st}
	p.Run(b.ID)

	got, _ := st.Bookmark(b.ID)
	if got.Icon == nil || got.Tile == nil || *got.Tile != "#0a141e" {
		t.Fatalf("icon not stored: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, *got.Icon)); err != nil {
		t.Errorf("icon file missing: %v", err)
	}
}

func TestProcessRefusesHugeImages(t *testing.T) {
	// A few hundred bytes that declare a 20000 by 20000 image.
	huge := pngBytes(image.NewGray(image.Rect(0, 0, 20000, 1)))
	if _, err := Process(huge); err == nil {
		t.Error("20000 px wide png accepted")
	}
	tall := pngBytes(image.NewGray(image.Rect(0, 0, 4096, 4000)))
	if _, err := Process(tall); err == nil {
		t.Error("16.4 million pixel png accepted")
	}
	ok := pngBytes(image.NewGray(image.Rect(0, 0, 4000, 4000)))
	if _, err := Process(ok); err != nil {
		t.Errorf("16 million pixels refused: %v", err)
	}

	// An ICO whose PNG frame is too large is refused before decoding.
	frame := pngBytes(image.NewGray(image.Rect(0, 0, 5000, 2)))
	if _, err := Process(icoWith(frame)); err == nil {
		t.Error("ico with a 5000 px png frame accepted")
	}
	// A BMP frame declaring 9000 px is refused too.
	bmp := make([]byte, 40)
	binary.LittleEndian.PutUint32(bmp[0:4], 40)
	binary.LittleEndian.PutUint32(bmp[4:8], 9000)
	binary.LittleEndian.PutUint32(bmp[8:12], 32)
	if _, err := Process(icoWith(bmp)); err == nil {
		t.Error("ico with a 9000 px bmp frame accepted")
	}
	if _, err := Process([]byte{0, 0, 1, 0, 1, 0}); err == nil {
		t.Error("truncated ico accepted")
	}
}

// icoWith wraps one frame in an ICO directory.
func icoWith(frame []byte) []byte {
	head := make([]byte, 6+16)
	binary.LittleEndian.PutUint16(head[2:4], 1)
	binary.LittleEndian.PutUint16(head[4:6], 1)
	binary.LittleEndian.PutUint32(head[6+8:6+12], uint32(len(frame)))
	binary.LittleEndian.PutUint32(head[6+12:6+16], uint32(len(head)))
	return append(head, frame...)
}

// countingImage records which pixels EdgeColor reads.
type countingImage struct {
	image.Image
	reads int
}

func (c *countingImage) At(x, y int) color.Color {
	c.reads++
	return c.Image.At(x, y)
}

func TestEdgeColorReadsOnlyTheRing(t *testing.T) {
	img := &countingImage{Image: square(100, color.White, color.RGBA{1, 2, 3, 255})}
	if got := EdgeColor(img); got == nil || *got != "#010203" {
		t.Fatalf("got %v", got)
	}
	if ring := 100*100 - 96*96; img.reads != ring {
		t.Errorf("read %d pixels, the ring has %d", img.reads, ring)
	}
	narrow := &countingImage{Image: square(3, color.White, color.RGBA{9, 9, 9, 255})}
	EdgeColor(narrow)
	if narrow.reads != 9 {
		t.Errorf("3 by 3 read %d pixels", narrow.reads)
	}
}

func TestPoolStopsWithContext(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx, cancel := context.WithCancel(context.Background())
	p := NewPool(ctx, dir, st)
	p.Enqueue(999) // no such bookmark: returns at once
	cancel()
	done := make(chan struct{})
	go func() { p.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("workers did not stop")
	}
}
