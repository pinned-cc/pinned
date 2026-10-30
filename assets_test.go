package pinned

import (
	"io/fs"
	"path"
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
