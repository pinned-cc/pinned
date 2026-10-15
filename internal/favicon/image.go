package favicon

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"sort"

	ico "github.com/sergeymakinen/go-ico"
)

var errUnknownFormat = errors.New("not a png, jpeg, ico or svg image")

// Icon is a downloaded icon ready to store.
type Icon struct {
	Ext  string  // "png", "jpg" or "svg"
	Data []byte  // file contents
	Tile *string // "#rrggbb" for raster icons with an opaque edge, else nil
}

// Limits on a raster icon, checked from its header before it is decoded,
// because a small file can declare a huge image.
const (
	maxSide   = 4096
	maxPixels = 16_000_000
)

var errTooLarge = errors.New("image is too large")

func checkSize(w, h int) error {
	if w <= 0 || h <= 0 || w > maxSide || h > maxSide || w*h > maxPixels {
		return errTooLarge
	}
	return nil
}

// Process checks what data is and turns it into an Icon. ICO files are
// decoded and stored as a PNG of their largest frame. Raster images are
// measured with DecodeConfig first and refused above 4096 by 4096 pixels or
// 16 million pixels in total.
func Process(data []byte) (Icon, error) {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		if err := checkConfig(png.DecodeConfig, data); err != nil {
			return Icon{}, err
		}
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			return Icon{}, err
		}
		return Icon{Ext: "png", Data: data, Tile: EdgeColor(img)}, nil
	case bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		if err := checkConfig(jpeg.DecodeConfig, data); err != nil {
			return Icon{}, err
		}
		img, err := jpeg.Decode(bytes.NewReader(data))
		if err != nil {
			return Icon{}, err
		}
		return Icon{Ext: "jpg", Data: data, Tile: EdgeColor(img)}, nil
	case bytes.HasPrefix(data, []byte{0, 0, 1, 0}):
		if err := checkICO(data); err != nil {
			return Icon{}, err
		}
		frames, err := ico.DecodeAll(bytes.NewReader(data))
		if err != nil || len(frames) == 0 {
			return Icon{}, fmt.Errorf("ico: %v", err)
		}
		img := largest(frames)
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			return Icon{}, err
		}
		return Icon{Ext: "png", Data: buf.Bytes(), Tile: EdgeColor(img)}, nil
	case isSVG(data):
		return Icon{Ext: "svg", Data: data}, nil
	}
	return Icon{}, errUnknownFormat
}

func checkConfig(decode func(io.Reader) (image.Config, error), data []byte) error {
	cfg, err := decode(bytes.NewReader(data))
	if err != nil {
		return err
	}
	return checkSize(cfg.Width, cfg.Height)
}

// checkICO reads the ICO directory and measures every frame before any is
// decoded: a PNG frame by its own header, a BMP frame by its DIB header.
func checkICO(data []byte) error {
	if len(data) < 6 {
		return errUnknownFormat
	}
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	if count == 0 || len(data) < 6+16*count {
		return errUnknownFormat
	}
	total := 0
	for i := 0; i < count; i++ {
		e := data[6+16*i : 6+16*(i+1)]
		size := int64(binary.LittleEndian.Uint32(e[8:12]))
		off := int64(binary.LittleEndian.Uint32(e[12:16]))
		if off < 0 || size <= 0 || off+size > int64(len(data)) {
			return errUnknownFormat
		}
		frame := data[off : off+size]
		var w, h int
		if bytes.HasPrefix(frame, []byte("\x89PNG\r\n\x1a\n")) {
			cfg, err := png.DecodeConfig(bytes.NewReader(frame))
			if err != nil {
				return err
			}
			w, h = cfg.Width, cfg.Height
		} else {
			if len(frame) < 12 {
				return errUnknownFormat
			}
			w = int(int32(binary.LittleEndian.Uint32(frame[4:8])))
			h = int(int32(binary.LittleEndian.Uint32(frame[8:12])))
			if h < 0 {
				h = -h
			}
			h /= 2 // the height counts the colour and the mask rows
		}
		if err := checkSize(w, h); err != nil {
			return err
		}
		total += w * h
		if total > maxPixels {
			return errTooLarge
		}
	}
	return nil
}

func largest(frames []image.Image) image.Image {
	best := frames[0]
	for _, f := range frames[1:] {
		if f.Bounds().Dx()*f.Bounds().Dy() > best.Bounds().Dx()*best.Bounds().Dy() {
			best = f
		}
	}
	return best
}

func isSVG(data []byte) bool {
	head := data
	if len(head) > 1024 {
		head = head[:1024]
	}
	return bytes.Contains(bytes.ToLower(head), []byte("<svg"))
}

// EdgeColor returns the median colour of the outer 2 pixel ring of img as
// #rrggbb. Only the ring is read. Mostly transparent pixels are ignored; if
// the whole ring is transparent it returns nil and the UI uses its dark tile.
func EdgeColor(img image.Image) *string {
	b := img.Bounds()
	var rs, gs, bs []int
	add := func(x, y int) {
		r, g, bl, a := img.At(x, y).RGBA()
		if a < 0x8000 {
			return
		}
		// Undo premultiplied alpha so a half transparent red stays red.
		rs = append(rs, int(r*0xffff/a)>>8)
		gs = append(gs, int(g*0xffff/a)>>8)
		bs = append(bs, int(bl*0xffff/a)>>8)
	}
	for y := b.Min.Y; y < b.Max.Y; y++ {
		if y < b.Min.Y+2 || y >= b.Max.Y-2 {
			for x := b.Min.X; x < b.Max.X; x++ { // top and bottom rows
				add(x, y)
			}
			continue
		}
		for x := b.Min.X; x < b.Max.X && x < b.Min.X+2; x++ { // left columns
			add(x, y)
		}
		for x := max(b.Max.X-2, b.Min.X+2); x < b.Max.X; x++ { // right columns
			add(x, y)
		}
	}
	if len(rs) == 0 {
		return nil
	}
	s := fmt.Sprintf("#%02x%02x%02x", median(rs), median(gs), median(bs))
	return &s
}

func median(v []int) int {
	sort.Ints(v)
	return v[len(v)/2]
}
