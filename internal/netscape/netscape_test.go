package netscape

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func parseFile(t *testing.T, name string) *Folder {
	t.Helper()
	f, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	root, err := Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestParseFlat(t *testing.T) {
	root := parseFile(t, "testdata/flat.html")
	if len(root.Folders) != 0 {
		t.Fatalf("want no folders, got %d", len(root.Folders))
	}
	if len(root.Links) != 8 {
		t.Fatalf("want 8 links, got %d", len(root.Links))
	}
	l := root.Links[5]
	if l.Title != "Photos (home)" || l.URL != "http://10.0.0.5:2283" || l.AddDate != 1759569433 {
		t.Errorf("unexpected link %+v", l)
	}
}

func TestParseBraveNested(t *testing.T) {
	root := parseFile(t, "testdata/brave.html")
	if len(root.Links) != 0 || len(root.Folders) != 2 {
		t.Fatalf("root: %d links, %d folders", len(root.Links), len(root.Folders))
	}
	bar := root.Folders[0]
	if bar.Name != "Bookmarks bar" || bar.AddDate != 1759400000 {
		t.Errorf("bar = %+v", bar)
	}
	if len(bar.Links) != 1 || len(bar.Folders) != 2 {
		t.Fatalf("bar: %d links, %d folders", len(bar.Links), len(bar.Folders))
	}
	work := bar.Folders[0]
	if work.Name != "Work" || len(work.Links) != 1 || work.Links[0].Title != "Docs & notes" {
		t.Errorf("work = %+v", work)
	}
	if work.Links[0].URL != "https://example.org/docs?a=1&b=2" {
		t.Errorf("entity in href not decoded: %q", work.Links[0].URL)
	}
	if len(work.Folders) != 1 || work.Folders[0].Name != "Reading" || len(work.Folders[0].Links) != 1 {
		t.Errorf("reading folder wrong: %+v", work.Folders)
	}
	lab := bar.Folders[1]
	if lab.Name != "Home lab" || len(lab.Links) != 3 {
		t.Errorf("home lab = %+v", lab)
	}
	other := root.Folders[1]
	if other.Name != "Other bookmarks" || len(other.Links) != 2 {
		t.Errorf("other = %+v", other)
	}
	links, folders := root.Count()
	if links != 8 || folders != 5 {
		t.Errorf("count = %d links %d folders", links, folders)
	}
}

func TestParseRejectsNonBookmarkFile(t *testing.T) {
	if _, err := Parse(strings.NewReader("hello world")); err == nil {
		t.Error("want an error for a file without a list")
	}
}

func TestParseMillisecondDates(t *testing.T) {
	in := `<DL><p><DT><A HREF="https://example.com" ADD_DATE="1759569433000">x</A></DL>`
	root, err := Parse(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	if root.Links[0].AddDate != 1759569433 {
		t.Errorf("got %d", root.Links[0].AddDate)
	}
}

func TestWriteRoundTrip(t *testing.T) {
	root := parseFile(t, "testdata/brave.html")
	var buf bytes.Buffer
	if err := Write(&buf, root); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.HasPrefix(out, "<!DOCTYPE NETSCAPE-Bookmark-file-1>") {
		t.Error("missing doctype")
	}
	if !strings.Contains(out, `HREF="https://example.org/docs?a=1&amp;b=2"`) {
		t.Error("href not escaped")
	}
	again, err := Parse(&buf)
	if err != nil {
		t.Fatal(err)
	}
	l1, f1 := root.Count()
	l2, f2 := again.Count()
	if l1 != l2 || f1 != f2 {
		t.Errorf("round trip changed counts: %d/%d to %d/%d", l1, f1, l2, f2)
	}
	if again.Folders[0].Folders[0].Folders[0].Links[0].AddDate != 1759400700 {
		t.Error("ADD_DATE lost in round trip")
	}
}

func TestWriteDeepTreeIsLinear(t *testing.T) {
	// The review measured 572 MB for this tree before the indent was capped.
	root := &Folder{Name: "Bookmarks"}
	f := root
	for i := 0; i < 10000; i++ {
		sub := &Folder{Name: "n", Links: []Link{{Title: "x", URL: "https://example.com/"}}}
		f.Folders = append(f.Folders, sub)
		f = sub
	}
	var buf bytes.Buffer
	start := time.Now()
	if err := Write(&buf, root); err != nil {
		t.Fatal(err)
	}
	if took := time.Since(start); took > 2*time.Second {
		t.Errorf("export took %v", took)
	}
	if buf.Len() > 20<<20 {
		t.Errorf("export is %d bytes", buf.Len())
	}
	// Normal depths keep their four space indent.
	small := &Folder{Folders: []*Folder{{Name: "A", Links: []Link{{Title: "a", URL: "https://a.example/"}}}}}
	buf.Reset()
	Write(&buf, small)
	if !strings.Contains(buf.String(), "\n        <DT><A HREF=\"https://a.example/\">a</A>\n") {
		t.Errorf("indent changed:\n%s", buf.String())
	}
}

func nested(levels int) string {
	return "<DL><p>" + strings.Repeat("<DT><H3>f</H3><DL><p>", levels) + `<DT><A HREF="https://example.com/">x</A>` + strings.Repeat("</DL><p>", levels+1)
}

func TestParseNestingLimit(t *testing.T) {
	root, err := Parse(strings.NewReader(nested(MaxNesting)))
	if err != nil {
		t.Fatalf("%d levels refused: %v", MaxNesting, err)
	}
	if links, folders := root.Count(); links != 1 || folders != MaxNesting {
		t.Errorf("got %d links, %d folders", links, folders)
	}
	if _, err := Parse(strings.NewReader(nested(MaxNesting + 1))); !errors.Is(err, ErrTooDeep) {
		t.Errorf("%d levels: %v", MaxNesting+1, err)
	}
	// The file from the audit of 2026-10-29 (F-2): unclosed folders, about
	// 1.5 million levels in 19.5 MB.
	evil := "<DL>" + strings.Repeat("<H3></H3><DL>", 1_500_000)
	if _, err := Parse(strings.NewReader(evil)); !errors.Is(err, ErrTooDeep) {
		t.Errorf("audit file: %v", err)
	}
	// Lists without a heading do not add a level.
	flat := "<DL><p>" + strings.Repeat("<DL><p>", 10_000) + `<DT><A HREF="https://example.com/">x</A>`
	if root, err := Parse(strings.NewReader(flat)); err != nil || len(root.Links) != 1 {
		t.Errorf("headless lists: %v", err)
	}
}
