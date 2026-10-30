package favicon

import (
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
	}
	for _, s := range good {
		icon, err := Process([]byte(s))
		if err != nil || icon.Ext != "svg" || string(icon.Data) != s {
			t.Errorf("refused %q: %v", s, err)
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
