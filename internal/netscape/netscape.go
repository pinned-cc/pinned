// Package netscape reads and writes the Netscape bookmark file format, the
// HTML file every browser exports and imports.
//
// The format is loose HTML: a folder is an <H3> followed by a <DL> that holds
// its children, a bookmark is an <A HREF> inside a <DT>. Browsers rarely close
// <DT> and <p>, so the reader walks tokens instead of building a DOM.
package netscape

import (
	"bufio"
	"fmt"
	"html"
	"io"
	"strconv"
	"strings"

	nethtml "golang.org/x/net/html"
)

// Folder is one folder of the file. The file itself is the root folder,
// which has no name.
type Folder struct {
	Name    string
	AddDate int64
	Folders []*Folder
	Links   []Link
}

// Link is one bookmark.
type Link struct {
	Title   string
	URL     string
	AddDate int64
}

// Parse reads a Netscape bookmark file and returns its root folder.
func Parse(r io.Reader) (*Folder, error) {
	root := &Folder{}
	stack := []*Folder{} // folders whose <DL> is open
	var pending *Folder  // folder named by the last <H3>, waiting for its <DL>
	sawDL := false

	z := nethtml.NewTokenizer(r)
	for {
		tt := z.Next()
		switch tt {
		case nethtml.ErrorToken:
			if z.Err() == io.EOF {
				if !sawDL {
					return nil, fmt.Errorf("not a bookmark file: no <DL> list found")
				}
				return root, nil
			}
			return nil, z.Err()

		case nethtml.StartTagToken, nethtml.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			attrs := readAttrs(z, hasAttr)
			switch string(name) {
			case "dl":
				sawDL = true
				switch {
				case pending != nil:
					stack = append(stack, pending)
					pending = nil
				case len(stack) == 0:
					stack = append(stack, root)
				default:
					// A <DL> without a heading: keep its items in the current folder.
					stack = append(stack, stack[len(stack)-1])
				}
			case "h3":
				f := &Folder{Name: readText(z, "h3"), AddDate: parseDate(attrs["add_date"])}
				parent := root
				if len(stack) > 0 {
					parent = stack[len(stack)-1]
				}
				parent.Folders = append(parent.Folders, f)
				pending = f
			case "a":
				href := strings.TrimSpace(attrs["href"])
				title := readText(z, "a")
				if href == "" {
					continue
				}
				parent := root
				if len(stack) > 0 {
					parent = stack[len(stack)-1]
				}
				parent.Links = append(parent.Links, Link{Title: title, URL: href, AddDate: parseDate(attrs["add_date"])})
			}

		case nethtml.EndTagToken:
			name, _ := z.TagName()
			if string(name) == "dl" && len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
}

func readAttrs(z *nethtml.Tokenizer, more bool) map[string]string {
	attrs := map[string]string{}
	for more {
		var k, v []byte
		k, v, more = z.TagAttr()
		attrs[string(k)] = string(v)
	}
	return attrs
}

// readText collects the text up to the closing tag and returns it trimmed.
// The tokenizer already decodes entities such as &amp;.
func readText(z *nethtml.Tokenizer, tag string) string {
	var b strings.Builder
	for {
		tt := z.Next()
		switch tt {
		case nethtml.ErrorToken:
			return strings.TrimSpace(b.String())
		case nethtml.TextToken:
			b.Write(z.Text())
		case nethtml.EndTagToken:
			if name, _ := z.TagName(); string(name) == tag {
				return strings.TrimSpace(b.String())
			}
		}
	}
}

func parseDate(s string) int64 {
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	// Some exporters write microseconds or milliseconds.
	for n > 1e11 {
		n /= 1000
	}
	return n
}

// maxIndent caps the indentation. Without a cap every line of a deeply
// nested file carries its depth in spaces, and the file grows with the
// square of the depth.
const maxIndent = 32

// Write writes root as a Netscape bookmark file. Links at the root come first,
// then each folder as an <H3> followed by its own <DL>. The output is
// streamed and its size is linear in the number of links and folders.
func Write(w io.Writer, root *Folder) error {
	b := bufio.NewWriter(w)
	b.WriteString("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n")
	b.WriteString("<!-- This is an automatically generated file. It will be read and overwritten. -->\n")
	b.WriteString(`<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">` + "\n")
	b.WriteString("<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n")
	writeList(b, root, 0)
	return b.Flush()
}

var spaces = strings.Repeat("    ", maxIndent+1)

func indent(depth int) string {
	return spaces[:4*min(depth, maxIndent)]
}

func writeList(b *bufio.Writer, f *Folder, depth int) {
	in, inner := indent(depth), indent(depth+1)
	b.WriteString(in + "<DL><p>\n")
	for _, l := range f.Links {
		fmt.Fprintf(b, "%s<DT><A HREF=\"%s\"%s>%s</A>\n", inner, html.EscapeString(l.URL), dateAttr(l.AddDate), html.EscapeString(l.Title))
	}
	for _, sub := range f.Folders {
		fmt.Fprintf(b, "%s<DT><H3%s>%s</H3>\n", inner, dateAttr(sub.AddDate), html.EscapeString(sub.Name))
		writeList(b, sub, depth+1)
	}
	b.WriteString(in + "</DL><p>\n")
}

func dateAttr(t int64) string {
	if t <= 0 {
		return ""
	}
	return fmt.Sprintf(` ADD_DATE="%d"`, t)
}

// Count returns the number of links and folders below f.
func (f *Folder) Count() (links, folders int) {
	links = len(f.Links)
	for _, sub := range f.Folders {
		l, fo := sub.Count()
		links += l
		folders += fo + 1
	}
	return links, folders
}
