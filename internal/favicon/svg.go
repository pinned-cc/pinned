package favicon

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"strings"
)

var errUnsafeSVG = errors.New("svg holds script, event handlers or external references")

// looksLikeSVG reports whether data starts like an XML document, after an
// optional byte order mark and white space, so only those are parsed.
func looksLikeSVG(data []byte) bool {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	data = bytes.TrimLeft(data, " \t\r\n")
	return bytes.HasPrefix(data, []byte("<"))
}

// unsafeElements run script, embed other documents or react to events.
var unsafeElements = map[string]bool{
	"script": true, "foreignobject": true, "handler": true, "listener": true,
	"iframe": true, "embed": true, "object": true,
}

// checkSVG accepts data only when it is a whole XML document whose root
// element is svg, and nothing in it can run script or load anything: no
// script, foreignObject or similar element, no on* attribute, no
// javascript: address, and every reference (href, url(), @import) points
// inside the file or to an embedded raster image. The icon is shown only
// through img and served with a sandbox, so this is a second line; anything
// it is unsure of is refused and the bookmark keeps its letter mark.
func checkSVG(data []byte) error {
	d := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))
	d.Strict = true
	d.Entity = xml.HTMLEntity
	root := false
	inStyle := 0
	for {
		tok, err := d.Token()
		if err == io.EOF {
			if !root {
				return errUnknownFormat
			}
			return nil
		}
		if err != nil {
			return errUnknownFormat
		}
		switch t := tok.(type) {
		case xml.ProcInst:
			// Only the XML declaration: xml-stylesheet loads a style sheet.
			if t.Target != "xml" {
				return errUnsafeSVG
			}
		case xml.Directive:
			// A DOCTYPE with an internal subset can define entities.
			if bytes.ContainsRune(t, '[') {
				return errUnsafeSVG
			}
		case xml.StartElement:
			name := strings.ToLower(t.Name.Local)
			if !root {
				if name != "svg" || (t.Name.Space != "" && t.Name.Space != "http://www.w3.org/2000/svg") {
					return errUnknownFormat
				}
				root = true
			}
			if unsafeElements[name] {
				return errUnsafeSVG
			}
			if name == "style" {
				inStyle++
			}
			for _, a := range t.Attr {
				if !safeAttr(a) {
					return errUnsafeSVG
				}
			}
		case xml.EndElement:
			if strings.EqualFold(t.Name.Local, "style") && inStyle > 0 {
				inStyle--
			}
		case xml.CharData:
			if !root {
				if len(bytes.TrimSpace(t)) > 0 {
					return errUnknownFormat
				}
				continue
			}
			if inStyle > 0 && !safeCSS(string(t)) {
				return errUnsafeSVG
			}
		}
	}
}

func safeAttr(a xml.Attr) bool {
	name := strings.ToLower(a.Name.Local)
	if strings.HasPrefix(name, "on") {
		return false
	}
	v := squash(a.Value)
	if strings.Contains(v, "javascript:") || strings.Contains(v, "vbscript:") {
		return false
	}
	if name == "href" || name == "src" {
		return localRef(v)
	}
	return safeCSS(a.Value)
}

// safeCSS refuses @import and any url() that leaves the file. A backslash
// is refused too: CSS escapes could spell url( in other letters.
func safeCSS(s string) bool {
	if strings.ContainsRune(s, '\\') {
		return false
	}
	v := squash(s)
	if strings.Contains(v, "@import") || strings.Contains(v, "javascript:") {
		return false
	}
	for {
		i := strings.Index(v, "url(")
		if i < 0 {
			return true
		}
		v = v[i+4:]
		ref := strings.TrimLeft(v, `"'`)
		if !localRef(ref) {
			return false
		}
	}
}

// localRef reports whether the reference v (already squashed) points inside
// the file or is an embedded raster image.
func localRef(v string) bool {
	if v == "" || strings.HasPrefix(v, "#") {
		return true
	}
	for _, p := range []string{"data:image/png", "data:image/jpeg", "data:image/gif", "data:image/webp"} {
		if strings.HasPrefix(v, p) {
			return true
		}
	}
	return false
}

// squash lowercases s and drops white space and control characters, so
// "Java Script:" and "url ( x )" are seen as written out.
func squash(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r <= ' ' || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}
