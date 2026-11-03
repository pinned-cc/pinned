package favicon

import (
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"image/color"
	"image/png"
	"io"
	"slices"
	"strings"
	"testing"
)

func TestSVGAcceptsPlainIcons(t *testing.T) {
	good := []string{
		`<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
		"\xef\xbb\xbf\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n<!-- logo -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 16 16\">" +
			`<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>` +
			`<style>.a{fill:url(#g)}</style><path class="a" d="M0 0h16v16H0z" style="fill: url('#g')"/>` +
			`<use xlink:href="#g"/><image href="data:image/png;base64,iVBORw0KGgo="/><text>&copy;</text></svg>`,
		// What sits inside a string is only text, and a comment inside an
		// unquoted url() is part of the address.
		`<svg xmlns="http://www.w3.org/2000/svg"><style>text{font-family:"a (b) @x /* c"}svg{background:"x" url(#a)}</style><rect style="fill:url(#a/*x*/)"/></svg>`,
	}
	good = append(good, realIcons...)
	for _, s := range good {
		icon, err := Process([]byte(s))
		if err != nil || icon.Ext != "svg" {
			t.Errorf("refused %q: %v", s, err)
			continue
		}
		checkRewrite(t, s, icon.Data)
	}
}

// checkRewrite fails unless out, the stored form of in, is a whole SVG
// document in the SVG namespace that the check accepts, keeps every path's
// d, and comes out the same when it is rewritten again.
func checkRewrite(t *testing.T, in string, out []byte) {
	t.Helper()
	if !strings.HasPrefix(string(out), `<svg xmlns="http://www.w3.org/2000/svg"`) {
		t.Errorf("%q: rewrite does not start with the svg root: %q", in, out)
	}
	if err := checkSVG(out); err != nil {
		t.Errorf("%q: rewrite fails the check: %v: %q", in, err, out)
	}
	again, err := rewriteSVG(out)
	if err != nil || !bytes.Equal(again, out) {
		t.Errorf("%q: second rewrite differs: %v\n%q\n%q", in, err, out, again)
	}
	d := xml.NewDecoder(bytes.NewReader(out))
	d.Strict = true
	var paths []string
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Errorf("%q: rewrite does not parse: %v", in, err)
			return
		}
		if se, ok := tok.(xml.StartElement); ok {
			if se.Name.Space != svgNS {
				t.Errorf("%q: element %v outside the svg namespace", in, se.Name)
			}
			if se.Name.Local == "path" {
				for _, a := range se.Attr {
					if a.Name.Local == "d" {
						paths = append(paths, a.Value)
					}
				}
			}
		}
	}
	for _, p := range pathData(in) {
		if !slices.Contains(paths, p) {
			t.Errorf("%q: path %q lost in %q", in, p, out)
		}
	}
}

// pathData returns the d of every path in s.
func pathData(s string) []string {
	var out []string
	d := xml.NewDecoder(strings.NewReader(strings.TrimPrefix(s, "\xef\xbb\xbf")))
	d.Strict = true
	d.Entity = xml.HTMLEntity
	for {
		tok, err := d.Token()
		if err != nil {
			return out
		}
		if se, ok := tok.(xml.StartElement); ok && strings.EqualFold(se.Name.Local, "path") {
			for _, a := range se.Attr {
				if a.Name.Local == "d" {
					out = append(out, a.Value)
				}
			}
		}
	}
}

// What is stored is written from the parsed tree: comments, the XML
// declaration, DOCTYPE, CDATA, entities, drawing programs' notes, data-*
// attributes, other namespace declarations and prefixes are gone, names
// have the spelling browsers know, and href points only into the file.
func TestSVGStoredFormIsRewritten(t *testing.T) {
	for _, s := range realIcons {
		icon, err := Process([]byte(s))
		if err != nil {
			t.Fatalf("refused %q: %v", s, err)
		}
		out := string(icon.Data)
		for _, gone := range []string{"<!", "<?", "CDATA", "-->", "&copy;", "inkscape", "sodipodi", "rdf", "xmlns:", "xlink", "data-name", "metadata", "Generator"} {
			if strings.Contains(out, gone) {
				t.Errorf("%q kept in %q", gone, out)
			}
		}
	}
	const open = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
	const root = `<svg xmlns="http://www.w3.org/2000/svg"`
	cases := map[string]string{
		`<svg xmlns="http://www.w3.org/2000/svg" VIEWBOX="0 0 1 1"><LINEARGRADIENT id="g"/></svg>`:          root + ` viewBox="0 0 1 1"><linearGradient id="g"/></svg>`,
		`<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:rect width="1"/></s:svg>`:                           root + `><rect width="1"/></svg>`,
		open + `<use xlink:href=" #a " href="#b"/><use xlink:href="#c" xlink:title="t"/></svg>`:             root + `><use href="#b"/><use href="#c"/></svg>`,
		open + `<text>a &amp; &lt;b&gt; &copy; "q"</text><g>stray text</g></svg>`:                           root + `><text>a &amp; &lt;b&gt; © &#34;q&#34;</text><g/></svg>`,
		open + `<style><![CDATA[a>b{fill:red}]]></style><rect style="fill:&quot;x&quot;"/></svg>`:           root + `><style>a&gt;b{fill:red}</style><rect style="fill:&#34;x&#34;"/></svg>`,
		open + `<rect width="1&#10;2"/></svg>`:                                                              root + `><rect width="1&#xA;2"/></svg>`,
		open + `<image href="data:image/webp;base64,UklGRg=="/><rect/></svg>`:                               root + `><rect/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" xml:lang="en"><text> a </text></svg>`: root + ` xml:space="preserve" xml:lang="en"><text> a </text></svg>`,
	}
	for in, want := range cases {
		icon, err := Process([]byte(in))
		if err != nil {
			t.Errorf("refused %q: %v", in, err)
			continue
		}
		if string(icon.Data) != want {
			t.Errorf("%q\n got %q\nwant %q", in, icon.Data, want)
		}
		checkRewrite(t, in, icon.Data)
	}
}

// An embedded picture is decoded and written again as a new PNG, so what a
// site hid in it is gone; the picture still shows.
func TestSVGEmbeddedPictureReencoded(t *testing.T) {
	img := square(4, color.White, color.RGBA{0, 128, 0, 255})
	payload := []byte("<script>alert(1)</script>")
	raw := append(pngBytes(img), payload...)
	in := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image width="4" height="4" xlink:href="data:image/png;base64,` + base64.StdEncoding.EncodeToString(raw) + `"/></svg>`
	icon, err := Process([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	checkRewrite(t, in, icon.Data)
	_, b64, ok := strings.Cut(string(icon.Data), `href="data:image/png;base64,`)
	if !ok {
		t.Fatalf("picture lost: %q", icon.Data)
	}
	b64, _, _ = strings.Cut(b64, `"`)
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || bytes.Contains(data, payload) {
		t.Fatalf("picture not re-encoded: %v", err)
	}
	if out, err := png.Decode(bytes.NewReader(data)); err != nil || out.Bounds().Dx() != 4 {
		t.Errorf("picture does not decode: %v", err)
	}
}

// The rewrite holds on its own, without the check before it: what could
// run, link or load never reaches its output, or it refuses the file.
func TestSVGRewriteDropsHostile(t *testing.T) {
	const open = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
	hostile := []string{
		open + `<script>alert(1)</script><rect/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>`,
		open + `<rect onclick="alert(1)"/></svg>`,
		open + `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><rect/></svg>`,
		open + `<image href="https://evil.example/p.png"/><rect/></svg>`,
		open + `<use href="https://evil.example/a.svg#x"/><rect/></svg>`,
		open + `<a xlink:href="javascript:alert(1)"><rect/></a></svg>`,
		open + `<use xlink:href="javascript:alert(1)"/><rect/></svg>`,
		open + `<style><![CDATA[rect{fill:url(https://evil.example/x.svg#a)}]]></style><rect/></svg>`,
		open + `<style>@import url(https://evil.example/a.css);</style><rect/></svg>`,
		open + `<rect style="fill:url(https://evil.example/x.svg#a)"/></svg>`,
		open + `<rect fill="url(https://evil.example/x.svg#a)"/></svg>`,
		`<!DOCTYPE svg [<!ENTITY x "evil.example">]>` + open + `<text>&x;</text></svg>`,
		`<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>` + open + `<text>&b;</text></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://evil.example/"><use href="#a"/></svg>`,
		`<?xml-stylesheet href="https://evil.example/a.css"?>` + open + `<rect/></svg>`,
		open + `<set attributeName="href" to="javascript:alert(1)"/><animate attributeName="href" values="https://evil.example/"/><rect/></svg>`,
		open + `<h:meta xmlns:h="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="0; url=https://evil.example/"/><rect/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:i="http://www.inkscape.org/namespaces/inkscape"><i:x><script>alert(1)</script></i:x><rect i:onload="alert(1)"/></svg>`,
		open + `<style>rect{fill:red}<g/>svg{background:url(https://evil.example/)}</style><rect/></svg>`,
		open + `<rect/></svg><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
		open + `<!-- <script>alert(1)</script> --><rect/></svg>`,
	}
	markers := []string{"script", "onload", "onclick", "foreignObject", "evil.example", "javascript", "CDATA", "xml:base", "ENTITY", "aaaaaaaaaa", "<!", "<?", "@import", "<set", "animate", "meta", "https:"}
	for _, s := range hostile {
		out, err := rewriteSVG([]byte(s))
		if err != nil {
			continue // refused whole
		}
		for _, m := range markers {
			if strings.Contains(string(out), m) {
				t.Errorf("%q: %q kept in %q", s, m, out)
			}
		}
	}
}

// Anything that could run or load something is refused, and so is a page
// that only holds an svg somewhere: the letter mark stays.
func TestSVGRefusesScriptAndReferences(t *testing.T) {
	const open = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
	bad := []string{
		`<html><body><svg></svg></body></html>`,
		`<!DOCTYPE html><html><svg></svg></html>`,
		`hello <svg></svg>`,
		`<svg><path></svg>`,
		`<x:svg xmlns:x="urn:other"></x:svg>`,
		open + `<script>alert(1)</script></svg>`,
		open + `<SCRIPT>alert(1)</SCRIPT></svg>`,
		open + `<foreignObject><div/></foreignObject></svg>`,
		open + `<handler/></svg>`,
		`<svg onload="alert(1)"></svg>`,
		open + `<rect ONCLICK="x()"/></svg>`,
		open + `<a href="javascript:alert(1)"><rect/></a></svg>`,
		open + `<a xlink:href="jav&#x61;script:alert(1)"><rect/></a></svg>`,
		open + `<a href="java&#10;script:x"><rect/></a></svg>`,
		open + `<set attributeName="href" to="javascript:x"/></svg>`,
		open + `<image href="https://tracker.example/p.png"/></svg>`,
		open + `<image href="//tracker.example/p.png"/></svg>`,
		open + `<image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>`,
		open + `<use xlink:href="other.svg#a"/></svg>`,
		open + `<rect fill="url(https://x.example/a.svg#p)"/></svg>`,
		open + `<rect style="fill:URL ( 'http://x.example/' )"/></svg>`,
		open + `<rect style="fill:\75rl(http://x.example/)"/></svg>`,
		open + `<style>@import "http://x.example/a.css";</style></svg>`,
		open + `<style><![CDATA[rect{fill:url(http://x.example/)}]]></style></svg>`,
		`<?xml-stylesheet href="http://x.example/a.css"?>` + open + `</svg>`,
		`<!DOCTYPE svg [<!ENTITY x "a">]>` + open + `<text>&x;</text></svg>`,
		open + `<text>&undefined;</text></svg>`,
		// Found by the release audit of 2026-10-31: XHTML inside the svg,
		// other URL attributes, image-set(), animation of href, xml:base.
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:meta http-equiv="refresh" content="0; url=https://evil.example/"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:img srcset="https://evil.example/x.png 1x"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:video poster="https://e"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:a ping="https://evil.example/p"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:form action="https://evil.example/f"/></svg>`,
		open + `<g><div xmlns="http://www.w3.org/1999/xhtml"/></g></svg>`,
		open + `<h:meta http-equiv="refresh"/></svg>`,
		open + `<rect style="fill:image-set('https://evil.example/x.png' 1x)"/></svg>`,
		open + `<rect style="fill:-webkit-image-set('https://evil.example/x.png' 1x)"/></svg>`,
		open + `<style>rect{fill:image-set("https://evil.example/x.png" 1x)}</style></svg>`,
		open + `<style>@font-face{font-family:x;src:url(#a)}</style></svg>`,
		open + `<style>rect{background:image("https://evil.example/x.png")}</style></svg>`,
		open + `<set attributeName="href" to="https://evil.example/a.svg#x"/></svg>`,
		open + `<animate attributeName="href" values="#a;https://evil.example/x.svg#b"/></svg>`,
		open + `<animate attributeName="fill" values="red;blue"/></svg>`,
		open + `<animateTransform attributeName="transform" type="rotate"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://evil.example/a.svg"><use href="#a"/></svg>`,
		open + `<feImage href="#a"/></svg>`,
		open + `<a href="#a"><rect/></a></svg>`,
		open + `<rect ping="https://evil.example/p"/></svg>`,
		open + `<rect src="https://evil.example/p"/></svg>`,
		open + `<use href="data:image/png;base64,iVBORw0KGgo="/></svg>`,
		open + `<image href="data:image/pngx;base64,AAAA"/></svg>`,
		open + `<rect fill="url(data:image/svg+xml,x)"/></svg>`,
		open + `<rect xlink:show="new"/></svg>`,
		open + `<x:rect xmlns:x="urn:other"/></svg>`,
		open + `<rect fill="expression(alert(1))"/></svg>`,
		// Found by the release delta audit of 2026-10-31: a style split by
		// a comment, CDATA or a child element, which browsers join, and a
		// bracket with no function name before it.
		open + `<style>rect{fill:url<!---->(https://evil.example/x.svg#a)}</style></svg>`,
		open + `<style>rect{fill:url<![CDATA[(https://evil.example/x.svg#a)]]>}</style></svg>`,
		open + `<style>rect{fill:url<g/>(https://evil.example/x.svg#a)}</style></svg>`,
		open + `<style>rect{fill:image-set<!---->("https://evil.example/x.png" 1x)}</style></svg>`,
		open + `<style>rect{fill:url<?x y?>(https://evil.example/x.svg#a)}</style></svg>`,
		open + `<style>rect{fill:#000}<!-- note --></style></svg>`,
		open + `<style><![CDATA[rect{fill:url]]><![CDATA[(https://evil.example/x.svg#a)}]]></style></svg>`,
		open + `<style>rect{fill:url/**/(https://evil.example/x.svg#a)}</style></svg>`,
		open + `<style>rect{fill:url (https://evil.example/x.svg#a)}</style></svg>`,
		open + `<style>rect{fill:image-set ("https://evil.example/x.png" 1x)}</style></svg>`,
		open + `<style>rect{fill:("https://evil.example/x.png")}</style></svg>`,
		open + `<rect style="fill:url/**/(https://evil.example/x.svg#a)"/></svg>`,
		open + `<rect style="fill:x (https://evil.example/)"/></svg>`,
		// Found by the release verification of 2026-10-31: a comment
		// opener inside a string or an unquoted url() hid a real url()
		// from the check.
		open + `<style>rect{fill:"/*"}svg{background-image:url(https://evil.example/x.png)}a{b:"*/"}</style></svg>`,
		open + `<style>rect{fill:'/*'}svg{background-image:url(https://evil.example/x.png)}x{y:'*/'}</style></svg>`,
		open + `<rect style='fill:"/*";background-image:url(https://evil.example/x.png);stroke:"*/"'/></svg>`,
		open + `<rect style="fill:url(#a/*);mask:url(https://evil.example/m.svg#m);stroke:url(#b*/)"/></svg>`,
		open + `<style>rect{fill:url(#a/*)}svg{background-image:url(https://evil.example/x.png)}x{y:url(#b*/)}</style></svg>`,
		open + `<style>a{b:"/*"}@font-face{font-family:q;src:url(https://evil.example/x.png)}c{d:"*/"}</style></svg>`,
		open + `<style>@media x{a{b:"/*"}}@import url(https://evil.example/x.css);c{d:"*/"}</style></svg>`,
		open + `<style>a{b:"/*"}svg{background:url(javascript:alert(1))}c{d:"*/"}</style></svg>`,
		open + `<rect style="fill:red/* "/></svg>`,
		open + `<rect style="fill:'red"/></svg>`,
		open + `<style>a{b:"x` + "\n" + `"}</style></svg>`,
		open + `<rect style="fill:url(#a"/></svg>`,
		open + `<rect style="fill:url(#a'b)"/></svg>`,
		open + `<rect style="fill:url(#a(b)"/></svg>`,
	}
	for _, s := range bad {
		if icon, err := Process([]byte(s)); err == nil {
			t.Errorf("accepted %q as %s", s, icon.Ext)
		}
	}
	if _, err := Process([]byte(open + strings.Repeat("<g>", 10000) + "</svg>")); err == nil {
		t.Error("accepted broken nesting")
	}
}

// realIcons are shaped like the SVG favicons big sites and drawing programs
// write: a dark mode media query, an Inkscape file with its metadata, an
// Illustrator export, a mask and filter, a symbol with use.
var realIcons = []string{
	`<svg width="32" height="32" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><style>path{fill:#24292f}@media (prefers-color-scheme: dark){path{fill:#fff}}</style><path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8z"/></svg>`,
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><style><![CDATA[/* brand */ .a{fill:url(#g)}]]>` + "\n" + `<![CDATA[@media (min-width: 0) and (prefers-color-scheme: dark){.a{width:calc((100% - 1px) / 2)}}]]></style><rect class="a" width="16" height="16" fill="url( 'data:image/png;base64,iVBORw0KGgo=' )"/></svg>`,
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>@media screen and (prefers-color-scheme: dark) { .a { fill: rgb(255 255 255 / 80%) } }</style><circle class="a" cx="16" cy="16" r="14" transform="translate(0 0) rotate(45 16 16) scale(1)"/></svg>`,
	"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n<!-- Created with Inkscape (http://www.inkscape.org/) -->\n" +
		`<svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="16mm" height="16mm" viewBox="0 0 16 16" version="1.1" id="svg8" inkscape:version="1.0" sodipodi:docname="icon.svg">` +
		`<sodipodi:namedview id="base" pagecolor="#ffffff" inkscape:zoom="1"/><metadata id="metadata5"><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/><dc:title></dc:title></cc:Work></rdf:RDF></metadata>` +
		`<g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1"><rect style="fill:#ff6600;fill-opacity:1;stroke:none;stroke-width:0.26" id="rect10" width="16" height="16" x="0" y="0" ry="3"/></g></svg>`,
	"<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!-- Generator: Adobe Illustrator 24.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n" +
		`<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 16 16" style="enable-background:new 0 0 16 16;" xml:space="preserve">` +
		`<style type="text/css">.st0{fill:#E10600;}</style><g data-name="Layer 2 (copy)"><polygon class="st0" points="0,0 16,0 16,16 0,16"/></g></svg>`,
	`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64" role="img" aria-label="Logo"><title>Logo</title><desc>Mark</desc><defs>` +
		`<radialGradient id="r" cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="#fff" stop-opacity=".9"/><stop offset="100%" stop-color="hsl(210 50% 40%)"/></radialGradient>` +
		`<mask id="m" maskUnits="userSpaceOnUse"><rect width="64" height="64" fill="#fff"/></mask><clipPath id="c"><circle cx="32" cy="32" r="30"/></clipPath>` +
		`<filter id="f" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="1"/><feOffset dy="1" result="o"/><feFlood flood-color="#000" flood-opacity=".3"/><feComposite in2="o" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
		`<symbol id="s" viewBox="0 0 10 10"><path d="M0 0L10 10"/></symbol></defs>` +
		`<g clip-path="url(#c)" mask="url(#m)" filter="url(#f)"><rect width="64" height="64" fill="url(#r)"/><use xlink:href="#s" width="20" height="20"/><use href="#s" x="20"/>` +
		`<ellipse cx="32" cy="40" rx="10" ry="4"/><line x1="0" y1="0" x2="64" y2="64" stroke="currentColor" stroke-linecap="round"/><polyline points="1 2 3 4" fill="none"/>` +
		`<text x="32" y="36" font-family="Helvetica, Arial" font-size="20" text-anchor="middle">P</text>` +
		`<image width="8" height="8" xlink:href="data:image/jpeg;base64,/9j/4AAQ"/></g></svg>`,
}
