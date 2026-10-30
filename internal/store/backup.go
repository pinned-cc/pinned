package store

import (
	"database/sql"
	"fmt"
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

// backupBeforeMigrate writes a consistent copy of the database with VACUUM
// INTO, which reads one snapshot inside a transaction, so the copy is whole
// even while WAL holds recent writes. It then keeps the newest KeepBackups
// copies. It returns the path of the copy.
func backupBeforeMigrate(db *sql.DB, dbPath string, version int) (string, error) {
	dst := backupPath(dbPath, version, backupTime())
	if _, err := os.Stat(dst); err == nil {
		return "", fmt.Errorf("%s already exists", dst)
	}
	if _, err := db.Exec(`VACUUM INTO ?`, dst); err != nil {
		os.Remove(dst) // a partial file is no backup
		return "", err
	}
	if err := os.Chmod(dst, 0o600); err != nil {
		log.Printf("database backup: %v", err)
	}
	pruneBackups(dbPath)
	return dst, nil
}

// pruneBackups removes all but the newest KeepBackups upgrade copies of the
// database at dbPath. It only touches files named by backupPath's pattern.
// A file it cannot remove is logged and kept.
func pruneBackups(dbPath string) {
	dir := filepath.Dir(dbPath)
	re := regexp.MustCompile(`^` + regexp.QuoteMeta(stem(dbPath)) + `-schema(\d+)-(\d{4}-\d{2}-\d{2}-\d{6})\.db$`)
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("database backup: %v", err)
		return
	}
	type backupFile struct {
		name, when string
		schema     int
	}
	var copies []backupFile
	for _, e := range entries {
		m := re.FindStringSubmatch(e.Name())
		if m == nil || !e.Type().IsRegular() {
			continue
		}
		n, _ := strconv.Atoi(m[1])
		copies = append(copies, backupFile{e.Name(), m[2], n})
	}
	// Newest first: by time in the name, then by schema.
	sort.Slice(copies, func(i, j int) bool {
		if copies[i].when != copies[j].when {
			return copies[i].when > copies[j].when
		}
		return copies[i].schema > copies[j].schema
	})
	for _, c := range copies[min(len(copies), KeepBackups):] {
		if err := os.Remove(filepath.Join(dir, c.name)); err != nil {
			log.Printf("database backup: %v", err)
		}
	}
}
