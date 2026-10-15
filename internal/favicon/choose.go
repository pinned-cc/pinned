// Package favicon finds, downloads and stores a site's icon, and picks a
// tile colour from the icon's edge.
package favicon

import (
	"encoding/json"
	"io"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// Candidates are the icon links found in a page, each list largest first.
type Candidates struct {
	Apple    []string // <link rel="apple-touch-icon">
	Manifest string   // <link rel="manifest">
	Icons    []string // <link rel="icon">
}

type sized struct {
	url  string
	size int
}

// Choose reads an HTML page and returns its icon links as absolute URLs.
// base is the URL the page was served from; a <base href> in the page wins.
func Choose(base *url.URL, page io.Reader) Candidates {
	var apple, icons []sized
	var manifest string
	z := html.NewTokenizer(page)
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		name, hasAttr := z.TagName()
		tag := string(name)
		if tag == "body" {
			break // icons live in <head>
		}
		if tag != "link" && tag != "base" {
			continue
		}
		attrs := map[string]string{}
		for hasAttr {
			var k, v []byte
			k, v, hasAttr = z.TagAttr()
			attrs[string(k)] = string(v)
		}
		if tag == "base" {
			if u, err := base.Parse(attrs["href"]); err == nil && attrs["href"] != "" {
				base = u
			}
			continue
		}
		href := strings.TrimSpace(attrs["href"])
		if href == "" || strings.HasPrefix(href, "data:") {
			continue
		}
		u, err := base.Parse(href)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			continue
		}
		rels := strings.Fields(strings.ToLower(attrs["rel"]))
		size := parseSizes(attrs["sizes"])
		switch {
		case has(rels, "apple-touch-icon") || has(rels, "apple-touch-icon-precomposed"):
			apple = append(apple, sized{u.String(), size})
		case has(rels, "manifest"):
			if manifest == "" {
				manifest = u.String()
			}
		case has(rels, "icon"):
			if size == 0 && strings.Contains(strings.ToLower(attrs["type"]), "svg") {
				size = anySize
			}
			icons = append(icons, sized{u.String(), size})
		}
	}
	return Candidates{Apple: largestFirst(apple), Manifest: manifest, Icons: largestFirst(icons)}
}

// ManifestIcons reads a web app manifest and returns its icons, largest first.
func ManifestIcons(base *url.URL, data []byte) []string {
	var m struct {
		Icons []struct {
			Src   string `json:"src"`
			Sizes string `json:"sizes"`
			Type  string `json:"type"`
		} `json:"icons"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	var list []sized
	for _, ic := range m.Icons {
		u, err := base.Parse(strings.TrimSpace(ic.Src))
		if err != nil || ic.Src == "" || (u.Scheme != "http" && u.Scheme != "https") {
			continue
		}
		list = append(list, sized{u.String(), parseSizes(ic.Sizes)})
	}
	return largestFirst(list)
}

// anySize ranks sizes="any" (usually SVG) above every pixel size.
const anySize = 1 << 16

// parseSizes returns the largest width in a sizes attribute like "16x16 32x32".
func parseSizes(s string) int {
	best := 0
	for _, f := range strings.Fields(strings.ToLower(s)) {
		if f == "any" {
			return anySize
		}
		w, _, ok := strings.Cut(f, "x")
		if !ok {
			continue
		}
		if n, err := strconv.Atoi(w); err == nil && n > best {
			best = n
		}
	}
	return best
}

func largestFirst(list []sized) []string {
	sort.SliceStable(list, func(i, j int) bool { return list[i].size > list[j].size })
	out := make([]string, 0, len(list))
	for _, s := range list {
		out = append(out, s.url)
	}
	return out
}

func has(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
