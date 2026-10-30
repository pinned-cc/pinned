package store

import (
	"bytes"
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// KeepBackups is how many copies from before a schema upgrade are kept next
// to the database. Older ones are removed after a new one is written.
const KeepBackups = 3

// backupTime is the clock for backup names. Tests replace it.
var backupTime = time.Now

// backupPath names the copy of the database at dbPath taken before an
// upgrade from schema version, for example bookmarks-schema6-2026-10-30-154210.db
// next to bookmarks.db. Tests replace it.
var backupPath = defaultBackupPath

func defaultBackupPath(dbPath string, version int, t time.Time) string {
	return filepath.Join(filepath.Dir(dbPath), fmt.Sprintf("%s-schema%d-%s.db", stem(dbPath), version, t.Format("2006-01-02-150405")))
}

func stem(dbPath string) string {
	base := filepath.Base(dbPath)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

type backupFile struct {
	name   string
	schema int
	mod    time.Time
}

// listBackups returns the upgrade copies of the database at dbPath: regular
// files named by backupPath's pattern, nothing else.
func listBackups(dbPath string) ([]backupFile, error) {
	re := regexp.MustCompile(`^` + regexp.QuoteMeta(stem(dbPath)) + `-schema(\d+)-\d{4}-\d{2}-\d{2}-\d{6}\.db$`)
	entries, err := os.ReadDir(filepath.Dir(dbPath))
	if err != nil {
		return nil, err
	}
	var out []backupFile
	for _, e := range entries {
		m := re.FindStringSubmatch(e.Name())
		if m == nil || !e.Type().IsRegular() {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		n, _ := strconv.Atoi(m[1])
		out = append(out, backupFile{e.Name(), n, fi.ModTime()})
	}
	return out, nil
}

// backupBeforeMigrate writes a copy of the database at schema version with
// VACUUM INTO, which reads one snapshot inside a transaction, so the copy is
// whole even while WAL holds recent writes, and returns its path. The file
// is created 0600 before SQLite fills it. An older copy of the same schema
// with the same bytes, as after an upgrade that failed and a restart, is
// removed, so failed starts do not push out other copies. Then the newest
// KeepBackups copies are kept, always including this one.
func backupBeforeMigrate(db *sql.DB, dbPath string, version int) (string, error) {
	dst := backupPath(dbPath, version, backupTime())
	// VACUUM INTO fills an empty file and keeps its mode. O_EXCL refuses a
	// name that is already taken.
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	f.Close()
	if _, err := db.Exec(`VACUUM INTO ?`, dst); err != nil {
		os.Remove(dst) // a partial file is no backup
		return "", err
	}
	dir := filepath.Dir(dbPath)
	if have, err := listBackups(dbPath); err == nil {
		for _, b := range have {
			if b.schema != version || b.name == filepath.Base(dst) {
				continue
			}
			if same, err := sameFile(dst, filepath.Join(dir, b.name)); err == nil && same {
				if err := os.Remove(filepath.Join(dir, b.name)); err != nil {
					log.Printf("database backup: %v", err)
				}
			}
		}
	}
	pruneBackups(dbPath, filepath.Base(dst))
	return dst, nil
}

// sameFile reports whether the files a and b hold the same bytes.
func sameFile(a, b string) (bool, error) {
	fa, err := os.Open(a)
	if err != nil {
		return false, err
	}
	defer fa.Close()
	fb, err := os.Open(b)
	if err != nil {
		return false, err
	}
	defer fb.Close()
	sa, err := fa.Stat()
	if err != nil {
		return false, err
	}
	sb, err := fb.Stat()
	if err != nil {
		return false, err
	}
	if sa.Size() != sb.Size() {
		return false, nil
	}
	ba, bb := make([]byte, 64<<10), make([]byte, 64<<10)
	for {
		na, ea := io.ReadFull(fa, ba)
		nb, eb := io.ReadFull(fb, bb)
		if na != nb || !bytes.Equal(ba[:na], bb[:nb]) {
			return false, nil
		}
		if ea == io.EOF || ea == io.ErrUnexpectedEOF {
			return eb == ea, nil
		}
		if ea != nil {
			return false, ea
		}
		if eb != nil {
			return false, eb
		}
	}
}

// pruneBackups removes all but the newest KeepBackups upgrade copies of the
// database at dbPath, newest by modification time. It never removes keep,
// the copy of this start, even when the clock is wrong. A file it cannot
// remove is logged and kept.
func pruneBackups(dbPath, keep string) {
	copies, err := listBackups(dbPath)
	if err != nil {
		log.Printf("database backup: %v", err)
		return
	}
	sort.Slice(copies, func(i, j int) bool {
		if copies[i].name == keep || copies[j].name == keep {
			return copies[i].name == keep
		}
		return copies[i].mod.After(copies[j].mod)
	})
	for _, c := range copies[min(len(copies), KeepBackups):] {
		if err := os.Remove(filepath.Join(filepath.Dir(dbPath), c.name)); err != nil {
			log.Printf("database backup: %v", err)
		}
	}
}
