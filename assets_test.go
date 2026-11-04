package pinned

import (
	"io/fs"
	"path"
	"regexp"
	"strings"
	"testing"
)

// web/ is served as it is, so it holds no developer notes. The font
// licence is the one text file that ships on purpose.
func TestNoNotesInWeb(t *testing.T) {
	fs.WalkDir(Web, "web", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if ext := path.Ext(p); (ext == ".txt" || ext == ".md") && p != "web/fonts/OFL.txt" {
			t.Errorf("%s is embedded and served", p)
		}
		return nil
	})
}

// The not found page has the head of the other small pages and uses only
// classes app.css already has, so it brings no look of its own (spec S23.8).
func TestNotFoundPageUsesTheAppStyles(t *testing.T) {
	page, err := fs.ReadFile(Web, "web/404.html")
	if err != nil {
		t.Fatal(err)
	}
	css, err := fs.ReadFile(Web, "web/app.css")
	if err != nil {
		t.Fatal(err)
	}
	p := string(page)
	for _, want := range []string{
		`<link rel="stylesheet" href="/static/app.css">`,
		`<script src="/static/js/theme.js"></script>`,
		`<meta name="robots" content="noindex, nofollow">`,
		`<title>Not found</title>`,
		`<h2>This page does not exist.</h2>`,
		`<a class="save" href="/">Open Pinned</a>`,
	} {
		if !strings.Contains(p, want) {
			t.Errorf("404.html lacks %s", want)
		}
	}
	if strings.Contains(p, "<style") || strings.Contains(p, ` style="`) {
		t.Error("404.html carries styles of its own")
	}
	for _, m := range regexp.MustCompile(`class="([^"]+)"`).FindAllStringSubmatch(p, -1) {
		for _, c := range strings.Fields(m[1]) {
			if !regexp.MustCompile(`\.` + regexp.QuoteMeta(c) + `[\s{,:.]`).Match(css) {
				t.Errorf("404.html uses class %s, which app.css does not define", c)
			}
		}
	}
}
