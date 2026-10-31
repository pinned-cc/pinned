package favicon

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pinned-cc/pinned/internal/store"
)

// Raster icons are stored as a new PNG of what they show: bytes after the
// image, extra chunks and the original format do not survive.
func TestProcessReencodesRaster(t *testing.T) {
	img := square(8, color.White, color.RGBA{255, 0, 0, 255})
	payload := []byte("<script>alert(1)</script>")

	var j, g bytes.Buffer
	if err := jpeg.Encode(&j, img, nil); err != nil {
		t.Fatal(err)
	}
	if err := gif.Encode(&g, img, nil); err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"png with trailing bytes":  append(pngBytes(img), payload...),
		"jpeg with trailing bytes": append(j.Bytes(), payload...),
		"gif with trailing bytes":  append(g.Bytes(), payload...),
	}
	for name, data := range cases {
		icon, err := Process(data)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if icon.Ext != "png" || bytes.Contains(icon.Data, payload) || bytes.Equal(icon.Data, data) {
			t.Errorf("%s: kept as %s, payload kept %v", name, icon.Ext, bytes.Contains(icon.Data, payload))
		}
		out, err := png.Decode(bytes.NewReader(icon.Data))
		if err != nil || out.Bounds() != image.Rect(0, 0, 8, 8) {
			t.Errorf("%s: stored file is not the 8 px png: %v", name, err)
		}
		if icon.Tile == nil {
			t.Errorf("%s: no tile", name)
		}
	}
}

// SVG icons stored by an earlier version are checked once when the pool
// starts: one that fails is taken off its bookmark and deleted, one that
// passes stays as it is.
func TestPoolDropsStoredUnsafeSVG(t *testing.T) {
	dir := t.TempDir()
	st := newTestStore(t)
	bad, _, err := st.Create(store.NewBookmark{Title: "Bad", URL: "https://bad.example/"})
	if err != nil {
		t.Fatal(err)
	}
	good, _, err := st.Create(store.NewBookmark{Title: "Good", URL: "https://good.example/"})
	if err != nil {
		t.Fatal(err)
	}
	badSVG := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:meta http-equiv="refresh" content="0; url=https://evil.example/"/></svg>`
	goodSVG := realIcons[0]
	for _, f := range []struct {
		id        int64
		key, name string
		data      string
	}{{bad.ID, bad.URLKey, "1-aaaaaaaa.svg", badSVG}, {good.ID, good.URLKey, "2-bbbbbbbb.svg", goodSVG}} {
		if err := os.WriteFile(filepath.Join(dir, f.name), []byte(f.data), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := st.SetIcon(f.id, f.key, f.name, nil); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := NewPool(ctx, dir, st)
	cancel()
	p.Wait()

	if _, err := os.Stat(filepath.Join(dir, "1-aaaaaaaa.svg")); !os.IsNotExist(err) {
		t.Errorf("unsafe icon file kept: %v", err)
	}
	if b, _ := st.Bookmark(bad.ID); b.Icon != nil {
		t.Errorf("bookmark still points to %s", *b.Icon)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "2-bbbbbbbb.svg")); err != nil || string(data) != goodSVG {
		t.Errorf("good icon changed: %v", err)
	}
	if b, _ := st.Bookmark(good.ID); b.Icon == nil || *b.Icon != "2-bbbbbbbb.svg" {
		t.Errorf("good bookmark lost its icon: %+v", b.Icon)
	}
}

// Raster icons stored byte for byte by an earlier version are re-encoded
// once at start: the bookmark points to a new PNG, the old file stays for
// a way back to 0.1.10 with the database copy, a file that does not decode
// is dropped, and a second start leaves everything alone.
func TestPoolReencodesStoredRaster(t *testing.T) {
	dir := t.TempDir()
	st := newTestStore(t)
	img := square(8, color.White, color.RGBA{0, 0, 255, 255})
	payload := []byte("<script>alert(1)</script>")
	var j bytes.Buffer
	if err := jpeg.Encode(&j, img, nil); err != nil {
		t.Fatal(err)
	}
	files := []struct {
		name, url string
		data      []byte
	}{
		{"1-aaaaaaaa.png", "https://png.example/", append(pngBytes(img), payload...)},
		{"2-bbbbbbbb.jpg", "https://jpg.example/", append(j.Bytes(), payload...)},
		{"3-cccccccc.png", "https://broken.example/", []byte("\x89PNG\r\n\x1a\nbroken")},
	}
	ids := make([]int64, len(files))
	for i, f := range files {
		b, _, err := st.Create(store.NewBookmark{Title: f.name, URL: f.url})
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = b.ID
		if err := os.WriteFile(filepath.Join(dir, f.name), f.data, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := st.SetIcon(b.ID, b.URLKey, f.name, nil); err != nil {
			t.Fatal(err)
		}
	}
	start := func() {
		ctx, cancel := context.WithCancel(context.Background())
		p := NewPool(ctx, dir, st)
		cancel()
		p.Wait()
	}
	start()

	for i, f := range files[:2] {
		b, _ := st.Bookmark(ids[i])
		if b.Icon == nil || *b.Icon == f.name || filepath.Ext(*b.Icon) != ".png" || !strings.HasPrefix(*b.Icon, f.name[:2]) {
			t.Fatalf("%s: bookmark icon %v", f.name, b.Icon)
		}
		data, err := os.ReadFile(filepath.Join(dir, *b.Icon))
		if err != nil || bytes.Contains(data, payload) {
			t.Errorf("%s: new file %v, payload kept %v", f.name, err, bytes.Contains(data, payload))
		}
		if _, err := png.Decode(bytes.NewReader(data)); err != nil {
			t.Errorf("%s: new file is not a png: %v", f.name, err)
		}
		if data, err := os.ReadFile(filepath.Join(dir, f.name)); err != nil || !bytes.Equal(data, f.data) {
			t.Errorf("%s: old file not kept as it was: %v", f.name, err)
		}
		if st.IconInUse(f.name) {
			t.Errorf("%s: old file still named by a bookmark", f.name)
		}
	}
	if b, _ := st.Bookmark(ids[2]); b.Icon != nil {
		t.Errorf("broken icon still used: %s", *b.Icon)
	}
	if _, err := os.Stat(filepath.Join(dir, files[2].name)); !os.IsNotExist(err) {
		t.Error("broken icon file kept")
	}
	if !st.IconsReencoded() {
		t.Fatal("pass not recorded")
	}

	// A later start skips the pass: a file put back as it was stays.
	if err := os.WriteFile(filepath.Join(dir, "9-dddddddd.png"), files[0].data, 0o600); err != nil {
		t.Fatal(err)
	}
	start()
	if data, err := os.ReadFile(filepath.Join(dir, "9-dddddddd.png")); err != nil || !bytes.Equal(data, files[0].data) {
		t.Errorf("second start re-encoded again: %v", err)
	}
}
