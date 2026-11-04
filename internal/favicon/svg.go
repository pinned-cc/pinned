package favicon

import (
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"image"
	_ "image/gif" // DecodeConfig of an embedded GIF
	_ "image/jpeg"
	_ "image/png"
	"io"
	"strings"
)

var errUnsafeSVG = errors.New("svg holds something outside the drawing allow list")

// Limits on what an SVG icon may embed and how large the rewritten file may
// be, so one saved link cannot store megabytes or slow every start.
const (
	maxEmbedded     = 8
	maxEmbeddedSide = 1024
	maxSVGOut       = 1 << 20
)

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

// svgElements are the drawing elements an icon may use, keyed in lower
// case, each with the spelling browsers know it by.
// There is no script, foreignObject, a, animation (set, animate and the
// rest), feImage, iframe or anything else that runs, links or loads.
var svgElements = set(`svg g defs title desc metadata symbol use switch
	path rect circle ellipse line polyline polygon text tspan textPath
	linearGradient radialGradient stop pattern clipPath mask marker image style
	filter feBlend feColorMatrix feComponentTransfer feFuncA feFuncB feFuncG
	feFuncR feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap
	feDistantLight feDropShadow feFlood feGaussianBlur feMerge feMergeNode
	feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile
	feTurbulence`)

// svgAttrs are the presentation, geometry and filter attributes an icon may
// use, keyed in lower case, each with the spelling browsers know it by.
// href is checked apart; data-* and aria-* are allowed.
var svgAttrs = set(`id class style lang version baseProfile x y x1 y1 x2 y2
	cx cy r rx ry fx fy fr d points width height viewBox preserveAspectRatio
	transform transform-origin transform-box fill fill-opacity fill-rule stroke
	stroke-width stroke-linecap stroke-linejoin stroke-miterlimit
	stroke-dasharray stroke-dashoffset stroke-opacity opacity color display
	visibility overflow clip clip-path clip-rule mask filter offset stop-color
	stop-opacity gradientUnits gradientTransform spreadMethod clipPathUnits
	maskUnits maskContentUnits patternUnits patternContentUnits
	patternTransform filterUnits primitiveUnits in in2 result stdDeviation dx
	dy flood-color flood-opacity lighting-color operator k1 k2 k3 k4 values
	type mode tableValues slope intercept amplitude exponent offset
	baseFrequency numOctaves seed stitchTiles scale xChannelSelector
	yChannelSelector radius order kernelMatrix divisor bias targetX targetY
	edgeMode preserveAlpha surfaceScale diffuseConstant specularConstant
	specularExponent azimuth elevation z pointsAtX pointsAtY pointsAtZ
	limitingConeAngle kernelUnitLength color-interpolation
	color-interpolation-filters color-rendering shape-rendering text-rendering
	image-rendering font-family font-size font-size-adjust font-weight
	font-style font-variant font-stretch text-anchor text-decoration
	dominant-baseline alignment-baseline baseline-shift letter-spacing
	word-spacing writing-mode direction unicode-bidi textLength lengthAdjust
	rotate startOffset method spacing side marker-start marker-mid marker-end
	markerWidth markerHeight markerUnits refX refY orient pathLength
	vector-effect paint-order mix-blend-mode isolation enable-background
	solid-color solid-opacity focusable role tabindex xmlns
	requiredFeatures requiredExtensions systemLanguage`)

// inertAttrs only name or label things.
var inertAttrs = set(`id class lang role focusable tabindex`)

// nameSet maps each name in lower case to its spelling.
type nameSet map[string]string

// has reports whether name, in lower case, is in the set.
func (n nameSet) has(name string) bool { return n[name] != "" }

func set(words string) nameSet {
	m := nameSet{}
	for _, w := range strings.Fields(words) {
		m[strings.ToLower(w)] = w
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
			if !editor && (t.Name.Space != "" && t.Name.Space != svgNS || !svgElements.has(name)) {
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
	case inertAttrs.has(name), strings.HasPrefix(name, "data-"), strings.HasPrefix(name, "aria-"):
		return true // names and labels; nothing reads them as style or address
	case svgAttrs.has(name):
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
// javascript: address. The text is read once the way a browser reads it
// (see cssScan): comments are taken out, so "url/**/(" is read as url(, and
// what sits inside a string is only text. An unclosed string, comment or
// url() is refused. A backslash is refused: CSS escapes could spell any of
// these in other letters.
func safeCSS(s string) bool {
	if strings.ContainsRune(s, '\\') {
		return false
	}
	t, v, ok := cssScan(s)
	if !ok {
		return false
	}
	if sq := squash(string(t)); strings.Contains(sq, "javascript:") || strings.Contains(sq, "vbscript:") {
		return false
	}
	for i := 0; i < len(v); i++ {
		switch v[i] {
		case '@':
			j := i + 1
			for j < len(v) && cssName(v[j]) {
				j++
			}
			if !cssAtRules.has(string(v[i+1 : j])) {
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
					// The address is read from the text with its strings.
					ref := strings.TrimLeft(squash(string(t[i+1:])), `"'`)
					if !strings.HasPrefix(ref, "#") && !rasterData(ref) {
						return false
					}
				case cssFunctions.has(fn):
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
			if j > 0 && v[j-1] == '@' && cssAtRules.has(string(v[j:end])) || j < end && cssBlockWords.has(string(v[j:end])) {
				continue
			}
			return false
		}
	}
	return true
}

// cssScan reads s once, in lower case, the way a browser splits it: a
// comment opener inside a string is only text, and inside an unquoted url()
// nothing is a comment either. It returns the text without its comments,
// and the same text with what sits inside strings and unquoted url() turned
// into spaces, so the brackets and at rules are checked only where they
// count. Both have the same length and control characters as spaces. ok is
// false for an unclosed comment, string or url(), a line break inside a
// string, or a quote or bracket inside an unquoted url().
func cssScan(s string) (text, blank []byte, ok bool) {
	s = strings.ToLower(s)
	text = make([]byte, 0, len(s))
	blank = make([]byte, 0, len(s))
	put := func(c byte, hide bool) {
		if c < ' ' || c == 0x7f {
			c = ' '
		}
		text = append(text, c)
		if hide {
			c = ' '
		}
		blank = append(blank, c)
	}
	for i := 0; i < len(s); {
		c := s[i]
		switch {
		case c == '/' && i+1 < len(s) && s[i+1] == '*':
			end := strings.Index(s[i+2:], "*/")
			if end < 0 {
				return nil, nil, false
			}
			i += 2 + end + 2
		case c == '"' || c == '\'':
			put(c, false)
			for i++; ; i++ {
				if i >= len(s) || s[i] == '\n' || s[i] == '\r' || s[i] == '\f' {
					return nil, nil, false
				}
				if s[i] == c {
					put(c, false)
					i++
					break
				}
				put(s[i], true)
			}
		case c == '(' && urlBefore(text):
			put(c, false)
			i++
			j := i
			for j < len(s) && (s[j] == ' ' || s[j] == '\t' || s[j] == '\n' || s[j] == '\r' || s[j] == '\f') {
				j++
			}
			if j < len(s) && (s[j] == '"' || s[j] == '\'') {
				continue // url("..."): the string is read as any other
			}
			// An unquoted url runs to its closing bracket.
			for ; ; i++ {
				if i >= len(s) || s[i] == '"' || s[i] == '\'' || s[i] == '(' {
					return nil, nil, false
				}
				if s[i] == ')' {
					break
				}
				put(s[i], true)
			}
		default:
			put(c, false)
			i++
		}
	}
	return text, blank, true
}

// urlBefore reports whether text ends with the name url, with no other name
// letter before it.
func urlBefore(text []byte) bool {
	n := len(text)
	return n >= 3 && string(text[n-3:]) == "url" && (n == 3 || !cssName(text[n-4]))
}

// cssName reports whether c can be part of a CSS name. Bytes of letters
// outside ASCII count too, so a longer name that only ends in url is not
// taken for url(.
func cssName(c byte) bool {
	return c == '-' || c == '_' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c >= 0x80
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

// textElements are the elements whose text is kept: what is drawn or read
// out (text, tspan, textPath, title, desc) and the style sheet. Text
// anywhere else draws nothing and is dropped.
var textElements = set(`text tspan textPath title desc style`)

// rewriteSVG writes a new SVG from data, which checkSVG has accepted, so
// what is stored and served is never the bytes a site sent. It keeps only
// the elements and attributes on the allow lists, spelled the way browsers
// know them, all in the SVG namespace with one xmlns on the root and no
// prefixes. It leaves out the XML declaration, DOCTYPE, comments,
// processing instructions, metadata, the elements and attributes of
// drawing programs with everything inside them, every other namespace
// declaration, xml:base, xlink:title, data-* attributes and text outside
// the elements in textElements. Entities and CDATA come out as plain text,
// escaped again. href (or xlink:href, written as href) keeps only an #id in
// the file; on image, an embedded PNG, JPEG or GIF is decoded and written
// again as a new PNG, and an image whose picture cannot be read that way
// is left out. Attributes are kept only when safeAttr accepts them and a
// style sheet only when safeCSS does, so the rewrite holds on its own too.
// A second rewrite gives the same bytes.
func rewriteSVG(data []byte) ([]byte, error) {
	// a page of embedded pictures is not an icon: each is decoded and
	// written again, so their number is bounded (audit 4, F-150)
	if bytes.Count(bytes.ToLower(data), []byte("data:image")) > maxEmbedded {
		return nil, errUnsafeSVG
	}
	d := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))
	d.Strict = true
	d.Entity = xml.HTMLEntity
	var out bytes.Buffer
	pictures := 0 // embedded pictures decoded so far
	type frame struct {
		name string // spelling written
		text bool   // its text is kept
		open bool   // the start tag is closed with ">", so it has content
		mark int    // where the element starts in out
		// parentOpen is the parent's open before this element began.
		parentOpen bool
		sheet      *strings.Builder // the text of a style element, checked at its end
	}
	var stack []frame
	skip := 0     // depth inside an element that is left out with all it holds
	done := false // the root has closed; anything after it is left out
	closeStart := func() {
		if n := len(stack); n > 0 && !stack[n-1].open {
			out.WriteByte('>')
			stack[n-1].open = true
		}
	}
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, errUnknownFormat
		}
		// Comments, processing instructions and directives are left out.
		switch t := tok.(type) {
		case xml.StartElement:
			if skip > 0 {
				skip++
				continue
			}
			if done {
				skip = 1
				continue
			}
			if n := len(stack); n > 0 && stack[n-1].sheet != nil {
				skip = 1 // nothing may split a style sheet
				continue
			}
			lower := strings.ToLower(t.Name.Local)
			if editorNS[t.Name.Space] || t.Name.Space != "" && t.Name.Space != svgNS || !svgElements.has(lower) || lower == "metadata" {
				if len(stack) == 0 {
					return nil, errUnknownFormat
				}
				skip = 1
				continue
			}
			attrs, ok := rewriteAttrs(lower, t.Attr, &pictures)
			if pictures > maxEmbedded {
				return nil, errUnsafeSVG // counted as decoded, whatever the spelling in the file
			}
			if !ok {
				skip = 1 // an image whose picture cannot be kept
				continue
			}
			name := svgElements[lower]
			f := frame{name: name, text: textElements.has(lower), mark: out.Len()}
			if n := len(stack); n > 0 {
				f.parentOpen = stack[n-1].open
			}
			closeStart()
			if lower == "style" {
				f.sheet = &strings.Builder{}
			}
			out.WriteByte('<')
			out.WriteString(name)
			if len(stack) == 0 {
				out.WriteString(` xmlns="` + svgNS + `"`)
			}
			for _, a := range attrs {
				out.WriteByte(' ')
				out.WriteString(a.Name.Local)
				out.WriteString(`="`)
				escape(&out, a.Value)
				out.WriteByte('"')
			}
			stack = append(stack, f)
		case xml.EndElement:
			if skip > 0 {
				skip--
				continue
			}
			if len(stack) == 0 {
				return nil, errUnknownFormat
			}
			f := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if f.sheet != nil && !safeCSS(f.sheet.String()) {
				out.Truncate(f.mark) // the style sheet is left out whole
				if n := len(stack); n > 0 {
					stack[n-1].open = f.parentOpen
				}
				continue
			}
			if f.open {
				out.WriteString("</" + f.name + ">")
			} else {
				out.WriteString("/>")
			}
			done = len(stack) == 0
		case xml.CharData:
			if skip > 0 || len(stack) == 0 || !stack[len(stack)-1].text || len(t) == 0 {
				continue
			}
			if sh := stack[len(stack)-1].sheet; sh != nil {
				sh.Write(t)
			}
			closeStart()
			escape(&out, string(t))
		}
	}
	if out.Len() == 0 || len(stack) != 0 {
		return nil, errUnknownFormat
	}
	// Pictures in a style url() are not counted above, and one written
	// data&#58;image comes out plain. They are counted on what is written,
	// as a browser reads it, so white space inside data:image counts too
	// and the stored file passes the count at the top again (spec S23.21).
	if writtenPictures(out.Bytes()) > maxEmbedded {
		return nil, errUnsafeSVG
	}
	return out.Bytes(), nil
}

// writtenPictures counts data:image in an SVG rewriteSVG wrote, in each
// attribute value and each run of text between tags, with character
// references decoded and read through squash: a browser's URL parser drops
// tabs and new lines, and a data URL the space before its type. It counts
// at least what a count of the raw bytes counts.
func writtenPictures(svg []byte) int {
	d := xml.NewDecoder(bytes.NewReader(svg))
	n := 0
	var run strings.Builder
	flush := func() {
		n += strings.Count(squash(run.String()), "data:image")
		run.Reset()
	}
	for {
		tok, err := d.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			flush()
			for _, a := range t.Attr {
				n += strings.Count(squash(a.Value), "data:image")
			}
		case xml.EndElement:
			flush()
		case xml.CharData:
			run.Write(t)
		}
	}
	flush()
	return n
}

// rewriteAttrs returns the attributes of element (lower case) that are
// kept, each once, spelled as browsers know them. ok is false when element
// is an image with an embedded picture that cannot be written again.
func rewriteAttrs(element string, in []xml.Attr, pictures *int) (attrs []xml.Attr, ok bool) {
	seen := map[string]bool{}
	add := func(name, value string) {
		if !seen[name] {
			seen[name] = true
			attrs = append(attrs, xml.Attr{Name: xml.Name{Local: name}, Value: value})
		}
	}
	// A plain href wins over xlink:href, as in browsers.
	var href *string
	for _, a := range in {
		if strings.ToLower(a.Name.Local) != "href" || a.Name.Space != "" && a.Name.Space != xlinkNS || !safeAttr(element, a) {
			continue
		}
		if href == nil || a.Name.Space == "" {
			v := a.Value
			href = &v
		}
	}
	for _, a := range in {
		lower := strings.ToLower(a.Name.Local)
		switch {
		case !safeAttr(element, a):
		case a.Name.Space == xmlNS:
			add("xml:"+lower, a.Value) // space or lang; xml needs no declaration
		case a.Name.Space != "", lower == "xmlns", lower == "href", strings.HasPrefix(lower, "data-"):
			// Namespace declarations, xlink:title and drawing programs'
			// attributes are left out; href is written below.
		case strings.HasPrefix(lower, "aria-"):
			add(lower, a.Value)
		case svgAttrs.has(lower):
			add(svgAttrs[lower], a.Value)
		}
	}
	if href != nil {
		v := strings.TrimSpace(*href)
		switch {
		case strings.HasPrefix(v, "#"):
			add("href", v)
		case element == "image":
			if *pictures++; *pictures > maxEmbedded {
				return nil, false
			}
			png, err := embeddedPNG(v)
			if err != nil {
				return nil, false
			}
			add("href", png)
		}
	}
	return attrs, true
}

// embeddedPNG decodes a base64 data: address of a PNG, JPEG or GIF image,
// checks and decodes the picture the way a fetched icon is, and returns a
// data: address of a new PNG of it. WebP and addresses not in base64 are
// refused.
func embeddedPNG(v string) (string, error) {
	head, body, found := strings.Cut(v, ",")
	if !found || !rasterData(squash(head+",")) || !strings.HasSuffix(squash(head), ";base64") {
		return "", errUnsafeSVG
	}
	body = strings.Map(func(r rune) rune {
		if r <= ' ' || r == 0x7f {
			return -1 // white space; base64 is case sensitive, so no squash
		}
		return r
	}, body)
	raw, err := base64.StdEncoding.DecodeString(body)
	if err != nil || looksLikeSVG(raw) {
		return "", errUnsafeSVG
	}
	// an icon's embedded picture is small; a large one would be stored as a
	// much larger PNG and decoded again at every start (audit 4, F-150)
	if c, _, err := image.DecodeConfig(bytes.NewReader(raw)); err != nil || c.Width > maxEmbeddedSide || c.Height > maxEmbeddedSide {
		return "", errUnsafeSVG
	}
	icon, err := Process(raw)
	if err != nil || icon.Ext != "png" {
		return "", errUnsafeSVG
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(icon.Data), nil
}

// escape writes s escaped for XML text or a double quoted attribute: &, <,
// >, both quotes, tab and line breaks as character references.
func escape(out *bytes.Buffer, s string) {
	_ = xml.EscapeText(out, []byte(s))
}
