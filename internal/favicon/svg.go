package favicon

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"strings"
)

var errUnsafeSVG = errors.New("svg holds something outside the drawing allow list")

// looksLikeSVG reports whether data starts like an XML document, after an
// optional byte order mark and white space, so only those are parsed.
func looksLikeSVG(data []byte) bool {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	data = bytes.TrimLeft(data, " \t\r\n")
	return bytes.HasPrefix(data, []byte("<"))
}

const (
	svgNS   = "http://www.w3.org/2000/svg"
	xlinkNS = "http://www.w3.org/1999/xlink"
	xmlNS   = "http://www.w3.org/XML/1998/namespace"
)

// editorNS are the namespaces drawing programs write their notes in.
// Browsers draw and run nothing in them, so their elements and attributes
// are let through; every element inside is still checked on its own.
var editorNS = map[string]bool{
	"http://www.inkscape.org/namespaces/inkscape":            true,
	"http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd":     true,
	"http://www.w3.org/1999/02/22-rdf-syntax-ns#":            true,
	"http://creativecommons.org/ns#":                         true,
	"http://purl.org/dc/elements/1.1/":                       true,
	"http://web.resource.org/cc/":                            true,
	"http://ns.adobe.com/AdobeIllustrator/10.0/":             true,
	"http://ns.adobe.com/Extensibility/1.0/":                 true,
	"http://ns.adobe.com/Graphs/1.0/":                        true,
	"http://ns.adobe.com/SaveForWeb/1.0/":                    true,
	"http://ns.adobe.com/Variables/1.0/":                     true,
	"http://www.bohemiancoding.com/sketch/ns":                true,
	"http://www.serif.com/":                                  true,
	"http://schemas.microsoft.com/visio/2003/SVGExtensions/": true,
}

// svgElements are the drawing elements an icon may use, in lower case.
// There is no script, foreignObject, a, animation (set, animate and the
// rest), feImage, iframe or anything else that runs, links or loads.
var svgElements = set(`svg g defs title desc metadata symbol use switch
	path rect circle ellipse line polyline polygon text tspan textpath
	lineargradient radialgradient stop pattern clippath mask marker image style
	filter feblend fecolormatrix fecomponenttransfer fefunca fefuncb fefuncg
	fefuncr fecomposite feconvolvematrix fediffuselighting fedisplacementmap
	fedistantlight fedropshadow feflood fegaussianblur femerge femergenode
	femorphology feoffset fepointlight fespecularlighting fespotlight fetile
	feturbulence`)

// svgAttrs are the presentation, geometry and filter attributes an icon may
// use, in lower case. href is checked apart; data-* and aria-* are allowed.
var svgAttrs = set(`id class style lang version baseprofile x y x1 y1 x2 y2
	cx cy r rx ry fx fy fr d points width height viewbox preserveaspectratio
	transform transform-origin transform-box fill fill-opacity fill-rule stroke
	stroke-width stroke-linecap stroke-linejoin stroke-miterlimit
	stroke-dasharray stroke-dashoffset stroke-opacity opacity color display
	visibility overflow clip clip-path clip-rule mask filter offset stop-color
	stop-opacity gradientunits gradienttransform spreadmethod clippathunits
	maskunits maskcontentunits patternunits patterncontentunits
	patterntransform filterunits primitiveunits in in2 result stddeviation dx
	dy flood-color flood-opacity lighting-color operator k1 k2 k3 k4 values
	type mode tablevalues slope intercept amplitude exponent offset
	basefrequency numoctaves seed stitchtiles scale xchannelselector
	ychannelselector radius order kernelmatrix divisor bias targetx targety
	edgemode preservealpha surfacescale diffuseconstant specularconstant
	specularexponent azimuth elevation z pointsatx pointsaty pointsatz
	limitingconeangle kernelunitlength color-interpolation
	color-interpolation-filters color-rendering shape-rendering text-rendering
	image-rendering font-family font-size font-size-adjust font-weight
	font-style font-variant font-stretch text-anchor text-decoration
	dominant-baseline alignment-baseline baseline-shift letter-spacing
	word-spacing writing-mode direction unicode-bidi textlength lengthadjust
	rotate startoffset method spacing side marker-start marker-mid marker-end
	markerwidth markerheight markerunits refx refy orient pathlength
	vector-effect paint-order mix-blend-mode isolation enable-background
	solid-color solid-opacity focusable role tabindex xmlns
	requiredfeatures requiredextensions systemlanguage`)

// inertAttrs only name or label things.
var inertAttrs = set(`id class lang role focusable tabindex`)

func set(words string) map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(words) {
		m[w] = true
	}
	return m
}

// checkSVG accepts data only when it is a whole XML document whose root
// element is svg and everything in it is on an allow list of drawing
// elements and attributes: no script, no links, no animation, no other
// namespace (XHTML included) apart from drawing programs' notes, href only
// to an #id in the file or to an embedded PNG, JPEG, GIF or WebP image,
// style only with url() to an #id or such an embedded image, known CSS
// functions and no @import. The icon is
// shown only through img and served with a sandbox, so this is a second
// line; anything not on the list is refused and the bookmark keeps its
// letter mark.
func checkSVG(data []byte) error {
	d := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))
	d.Strict = true
	d.Entity = xml.HTMLEntity
	root := false
	// A style element is checked as the one sheet a browser joins from all
	// its text and CDATA, so nothing inside may split it: no comment, no
	// processing instruction, no child element.
	inStyle := false
	var sheet strings.Builder
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
			if t.Target != "xml" || inStyle {
				return errUnsafeSVG
			}
		case xml.Comment:
			if inStyle {
				return errUnsafeSVG
			}
		case xml.Directive:
			// A DOCTYPE with an internal subset can define entities.
			if bytes.ContainsRune(t, '[') || inStyle {
				return errUnsafeSVG
			}
		case xml.StartElement:
			if inStyle {
				return errUnsafeSVG
			}
			name := strings.ToLower(t.Name.Local)
			if !root {
				if name != "svg" || (t.Name.Space != "" && t.Name.Space != svgNS) {
					return errUnknownFormat
				}
				root = true
			}
			editor := editorNS[t.Name.Space]
			if !editor && (t.Name.Space != "" && t.Name.Space != svgNS || !svgElements[name]) {
				return errUnsafeSVG
			}
			if name == "style" && !editor {
				inStyle = true
				sheet.Reset()
			}
			for _, a := range t.Attr {
				// An editor's element is drawn by nothing, so its own
				// plain attributes do nothing either.
				if editor && a.Name.Space == "" {
					continue
				}
				if !safeAttr(name, a) {
					return errUnsafeSVG
				}
			}
		case xml.EndElement:
			if inStyle {
				// Nothing can open inside style, so this closes it.
				inStyle = false
				if !safeCSS(sheet.String()) {
					return errUnsafeSVG
				}
			}
		case xml.CharData:
			if !root {
				if len(bytes.TrimSpace(t)) > 0 {
					return errUnknownFormat
				}
				continue
			}
			if inStyle {
				sheet.Write(t)
			}
		}
	}
}

// safeAttr reports whether attribute a may sit on element (lower case).
func safeAttr(element string, a xml.Attr) bool {
	name := strings.ToLower(a.Name.Local)
	switch {
	case a.Name.Space == "xmlns":
		return true // a namespace declaration; what uses it is checked
	case a.Name.Space == xmlNS:
		return name == "space" || name == "lang" // never xml:base
	case editorNS[a.Name.Space]:
		return true
	case a.Name.Space == xlinkNS:
		if name == "href" {
			return safeHref(element, a.Value)
		}
		return name == "title"
	case a.Name.Space != "":
		return false
	case name == "href":
		return safeHref(element, a.Value)
	case inertAttrs[name], strings.HasPrefix(name, "data-"), strings.HasPrefix(name, "aria-"):
		return true // names and labels; nothing reads them as style or address
	case svgAttrs[name]:
		return safeCSS(a.Value)
	}
	return false
}

// safeHref allows an #id in the file, and on image an embedded raster
// image.
func safeHref(element, v string) bool {
	v = squash(v)
	if strings.HasPrefix(v, "#") {
		return true
	}
	return element == "image" && rasterData(v)
}

// rasterData reports whether v (squashed) is a data: address of a PNG,
// JPEG, GIF or WebP image.
func rasterData(v string) bool {
	for _, p := range []string{"data:image/png", "data:image/jpeg", "data:image/jpg", "data:image/gif", "data:image/webp"} {
		if rest, ok := strings.CutPrefix(v, p); ok && (strings.HasPrefix(rest, ";") || strings.HasPrefix(rest, ",")) {
			return true
		}
	}
	return false
}

// cssFunctions are the CSS functions (and pseudo classes and media query
// words written before a bracket) a style may use. None of them loads
// anything; url() is checked apart, and image-set(), image(), src(),
// cross-fade(), element() and expression() are not here.
var cssFunctions = set(`rgb rgba hsl hsla hwb lab lch oklab oklch color
	color-mix light-dark var calc min max clamp translate translatex
	translatey translate3d rotate rotatex rotatey rotatez scale scalex scaley
	skew skewx skewy matrix linear-gradient radial-gradient conic-gradient
	drop-shadow blur brightness contrast grayscale invert saturate sepia
	hue-rotate opacity cubic-bezier steps media supports and or not only is
	where has nth-child nth-of-type nth-last-child prefers-color-scheme
	prefers-reduced-motion min-width max-width lang`)

// cssAtRules are the at rules a style element may hold.
var cssAtRules = set(`media supports keyframes -webkit-keyframes`)

// cssBlockWords may stand before a plain bracket with a space between, as
// in "@media screen and (prefers-color-scheme: dark)".
var cssBlockWords = set(`and or not only`)

// safeCSS accepts a style sheet or attribute value only when every bracket
// opens a function on the list above, with its name written right before
// it, or is a plain bracket after a media query word, an opening bracket or
// a comma; every url() points to an #id or an embedded raster image, every
// at rule is on the list (no @import, no @font-face) and there is no
// javascript: address. CSS comments are taken out first, so "url/**/(" is
// read as url(. A backslash is refused: CSS escapes could spell any of
// these in other letters.
func safeCSS(s string) bool {
	if strings.ContainsRune(s, '\\') {
		return false
	}
	s = dropCSSComments(s)
	if v := squash(s); strings.Contains(v, "javascript:") || strings.Contains(v, "vbscript:") {
		return false
	}
	v := []byte(strings.ToLower(s))
	for i, c := range v {
		if c < ' ' || c == 0x7f {
			v[i] = ' '
		}
	}
	for i := 0; i < len(v); i++ {
		switch v[i] {
		case '@':
			j := i + 1
			for j < len(v) && cssName(v[j]) {
				j++
			}
			if !cssAtRules[string(v[i+1:j])] {
				return false
			}
		case '(':
			if i > 0 && cssName(v[i-1]) {
				// A function: its name sits right before the bracket.
				j := i
				for j > 0 && cssName(v[j-1]) {
					j--
				}
				if j > 0 && v[j-1] == '@' {
					continue // @media(...): checked as an at rule
				}
				switch fn := string(v[j:i]); {
				case fn == "url":
					ref := strings.TrimLeft(squash(string(v[i+1:])), `"'`)
					if !strings.HasPrefix(ref, "#") && !rasterData(ref) {
						return false
					}
				case cssFunctions[fn]:
				default:
					return false
				}
				continue
			}
			// A plain bracket: only after a media query word, an at
			// rule, an opening bracket or a comma.
			j := i
			for j > 0 && v[j-1] == ' ' {
				j--
			}
			if j == 0 || v[j-1] == '(' || v[j-1] == ',' {
				continue
			}
			end := j
			for j > 0 && cssName(v[j-1]) {
				j--
			}
			if j > 0 && v[j-1] == '@' && cssAtRules[string(v[j:end])] || j < end && cssBlockWords[string(v[j:end])] {
				continue
			}
			return false
		}
	}
	return true
}

// dropCSSComments removes /* ... */ comments, an unclosed one to the end.
func dropCSSComments(s string) string {
	var b strings.Builder
	for {
		i := strings.Index(s, "/*")
		if i < 0 {
			b.WriteString(s)
			return b.String()
		}
		b.WriteString(s[:i])
		end := strings.Index(s[i+2:], "*/")
		if end < 0 {
			return b.String()
		}
		s = s[i+2+end+2:]
	}
}

func cssName(c byte) bool {
	return c == '-' || c == '_' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9'
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

// svgStoredOK reports whether the stored icon file at path passes the
// current check. A file that cannot be read counts as passing: it is not
// served either way, and a read error must not drop icons.
func svgStoredOK(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return true
	}
	return checkSVG(data) == nil
}
