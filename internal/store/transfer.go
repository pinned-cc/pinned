package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pinned-cc/pinned/internal/netscape"
	"github.com/pinned-cc/pinned/internal/urlkey"
)

// ImportResult says what an import did. AddedIDs lists the new bookmarks so
// the caller can fetch their icons.
type ImportResult struct {
	Added    int     `json:"added"`
	Skipped  int     `json:"skipped"`
	Folders  int     `json:"folders"`
	AddedIDs []int64 `json:"-"`
}

// MaxImportName caps folder names read from an import file, in characters.
const MaxImportName = 200

// Import adds the bookmarks of a parsed file. Folders are matched by name
// under the same parent and created when missing. Links whose identity is
// already saved outside hidden, that are not http or https, or whose address
// is longer than urlkey.MaxLen are skipped. Links at the root of the file
// land in Inbox.
//
// Import never writes into a locked folder: a file folder whose name matches
// a locked folder becomes a new folder beside it, named "<name> (imported)".
// Folders deeper than MaxDepth are flattened into the folder at MaxDepth.
//
// The work is committed in batches of about importBatch each, so saves and
// sign ins made during a long import wait for one batch, not for the whole
// file. If a folder the import writes into is deleted or locked between two
// batches, the import stops with ErrImportChanged; what came in before stays,
// and importing the same file again adds the rest.
//
// A tree deeper than netscape.MaxNesting is refused with netscape.ErrTooDeep
// before anything is written; Parse never returns one.
func (s *Store) Import(root *netscape.Folder, hidden Hidden) (ImportResult, error) {
	if treeDepth(root) > netscape.MaxNesting {
		return ImportResult{}, netscape.ErrTooDeep
	}
	imp := &importer{s: s, now: s.now(), hidden: hidden}
	if err := imp.begin(); err != nil {
		return ImportResult{}, err
	}
	if err := imp.folder(root, nil, 0); err != nil {
		if imp.tx != nil {
			imp.tx.Rollback()
			imp.tx = nil
			s.wmu.Unlock()
		}
		return imp.res, err
	}
	return imp.res, imp.commit()
}

// treeDepth returns how deep folders nest below root, walking with a list
// instead of recursion so any depth is safe to measure.
func treeDepth(root *netscape.Folder) int {
	type item struct {
		f     *netscape.Folder
		depth int
	}
	deepest := 0
	todo := []item{{root, 0}}
	for len(todo) > 0 {
		it := todo[len(todo)-1]
		todo = todo[:len(todo)-1]
		deepest = max(deepest, it.depth)
		for _, sub := range it.f.Folders {
			todo = append(todo, item{sub, it.depth + 1})
		}
	}
	return deepest
}

// ErrImportChanged means a folder the import was writing into was deleted or
// locked while the import ran.
var ErrImportChanged = errors.New("a folder changed during the import; import the file again to add the rest")

// importBatch is how long one import transaction may run before it commits
// and lets other writes in. Tests shorten it.
var importBatch = 100 * time.Millisecond

// betweenBatches, when set, runs after each batch commits. Tests use it to
// write between two batches.
var betweenBatches func()

// importer carries the state of one import. The next positions and the
// folder names of each level are read once and then counted up in memory, so
// an import costs the same per link however full a folder is. They are read
// again in a batch that follows other writes.
type importer struct {
	s *Store
	// hidden are the folders the importing caller cannot see; a link
	// saved only in them is imported again.
	hidden Hidden
	tx     *sql.Tx
	now    int64
	start  time.Time
	res    ImportResult
	// pending counts what the open batch added; it moves into res when the
	// batch commits, so res only ever reports what is saved.
	pending        int
	pendingIDs     []int64
	pendingFolders int

	next       map[int64]int64 // next bookmark position per folder, 0 for Inbox
	nextFolder map[int64]int64 // next folder position per parent, 0 for the top
	names      map[int64]map[string]folderMatch
	checked    map[int64]bool // folders checked as still there and unlocked
	writes     uint64         // Store.writes when the caches were filled
}

// folderMatch is the folder an import uses for a name at one level.
type folderMatch struct {
	id     int64
	locked bool
}

func key0(id *int64) int64 {
	if id == nil {
		return 0
	}
	return *id
}

// begin takes the write lock and opens a batch. The caches are emptied when
// anything else wrote since they were filled.
func (imp *importer) begin() error {
	imp.s.wmu.Lock()
	tx, err := imp.s.db.Begin()
	if err != nil {
		imp.tx = nil
		imp.s.wmu.Unlock()
		return err
	}
	imp.tx, imp.start = tx, time.Now()
	if imp.next != nil && imp.writes == imp.s.writes {
		return nil
	}
	imp.writes = imp.s.writes
	imp.next = map[int64]int64{}
	imp.nextFolder = map[int64]int64{}
	imp.names = map[int64]map[string]folderMatch{}
	imp.checked = map[int64]bool{}
	return nil
}

// tick commits the batch when it has run long enough and opens the next.
func (imp *importer) tick() error {
	if time.Since(imp.start) < importBatch {
		return nil
	}
	if err := imp.commit(); err != nil {
		return err
	}
	if betweenBatches != nil {
		betweenBatches()
	}
	return imp.begin()
}

// commit ends the batch, releases the write lock and counts what it added.
func (imp *importer) commit() error {
	err := imp.tx.Commit()
	imp.tx = nil
	imp.s.wmu.Unlock()
	if err != nil {
		return err
	}
	imp.res.Added += imp.pending
	imp.res.AddedIDs = append(imp.res.AddedIDs, imp.pendingIDs...)
	imp.res.Folders += imp.pendingFolders
	imp.pending, imp.pendingIDs, imp.pendingFolders = 0, nil, 0
	return nil
}

// usable makes sure that folder id still exists and that neither it nor a
// folder above it is locked, once and again after other writes.
func (imp *importer) usable(id *int64) error {
	if id == nil || imp.checked[*id] {
		return nil
	}
	var n, locked int
	err := imp.tx.QueryRow(`WITH RECURSIVE up(id, parent_id, lock_hash) AS (
			SELECT id, parent_id, lock_hash FROM folders WHERE id = ?
			UNION ALL SELECT f.id, f.parent_id, f.lock_hash FROM folders f JOIN up ON f.id = up.parent_id)
		SELECT COUNT(*), COUNT(lock_hash) FROM up`, *id).Scan(&n, &locked)
	if err != nil {
		return err
	}
	if n == 0 || locked > 0 {
		return ErrImportChanged
	}
	imp.checked[*id] = true
	return nil
}

// folder adds f's links and subfolders into parentID, which sits at depth
// (0 for the root and Inbox).
func (imp *importer) folder(f *netscape.Folder, parentID *int64, depth int) error {
	for _, l := range f.Links {
		if err := imp.link(l, parentID); err != nil {
			return err
		}
	}
	for _, sub := range f.Folders {
		if depth >= MaxDepth {
			// Too deep: the folder's contents land in this folder.
			if err := imp.folder(sub, parentID, depth); err != nil {
				return err
			}
			continue
		}
		id, err := imp.target(sub, parentID)
		if err != nil {
			return err
		}
		if err := imp.folder(sub, &id, depth+1); err != nil {
			return err
		}
	}
	return nil
}

func (imp *importer) link(l netscape.Link, parentID *int64) error {
	key, err := urlkey.Key(l.URL)
	if err == nil {
		err = urlkey.CheckLen(l.URL)
	}
	// A skipped link ends a batch by time too, so a file of links that
	// are all saved already lets other writes in as often as any other.
	if err != nil {
		imp.res.Skipped++
		return imp.tick()
	}
	if _, err := liveByKey(imp.tx, key, imp.hidden); err == nil {
		imp.res.Skipped++
		return imp.tick()
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	if err := imp.usable(parentID); err != nil {
		return err
	}
	created := l.AddDate
	if created <= 0 {
		created = imp.now
	}
	title := clip(l.Title, MaxTitle)
	if title == "" {
		title = urlkey.Host(l.URL)
	}
	k := key0(parentID)
	pos, ok := imp.next[k]
	if !ok {
		if pos, err = nextPosition(imp.tx, parentID); err != nil {
			return err
		}
	}
	r, err := imp.tx.Exec(`INSERT INTO bookmarks (folder_id, title, url, url_key, position, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, nullable(parentID), title, strings.TrimSpace(l.URL), key, pos, created, imp.now)
	if err != nil {
		return err
	}
	imp.next[k] = pos + 1
	id, err := r.LastInsertId()
	if err != nil {
		return err
	}
	imp.pending++
	imp.pendingIDs = append(imp.pendingIDs, id)
	return imp.tick()
}

// target finds or creates the folder that a file folder imports into. An
// unlocked folder of the same name under parentID is reused; when the only
// match is locked, the name gets " (imported)" and the search repeats.
func (imp *importer) target(sub *netscape.Folder, parentID *int64) (int64, error) {
	name := strings.TrimSpace(sub.Name)
	if name == "" {
		name = "Imported"
	}
	if utf8.RuneCountInString(name) > MaxImportName {
		name = strings.TrimSpace(string([]rune(name)[:MaxImportName]))
	}
	if err := imp.usable(parentID); err != nil {
		return 0, err
	}
	names, err := imp.level(parentID)
	if err != nil {
		return 0, err
	}
	for {
		m, ok := names[name]
		switch {
		case ok && !m.locked:
			return m.id, nil
		case ok:
			name += " (imported)"
			continue
		}
		created := sub.AddDate
		if created <= 0 {
			created = imp.now
		}
		k := key0(parentID)
		pos, ok := imp.nextFolder[k]
		if !ok {
			if pos, err = nextFolderPosition(imp.tx, parentID); err != nil {
				return 0, err
			}
		}
		r, err := imp.tx.Exec(`INSERT INTO folders (parent_id, name, position, created_at) VALUES (?, ?, ?, ?)`,
			nullable(parentID), name, pos, created)
		if err != nil {
			return 0, err
		}
		id, err := r.LastInsertId()
		if err != nil {
			return 0, err
		}
		imp.nextFolder[k] = pos + 1
		names[name] = folderMatch{id: id}
		imp.checked[id] = true
		imp.pendingFolders++
		return id, imp.tick()
	}
}

// level returns the folders under parentID by name, read once per batch. For
// a name used twice the unlocked one comes first, then the first by position,
// as the app shows them.
func (imp *importer) level(parentID *int64) (map[string]folderMatch, error) {
	k := key0(parentID)
	if m, ok := imp.names[k]; ok {
		return m, nil
	}
	rows, err := imp.tx.Query(`SELECT id, name, lock_hash IS NOT NULL FROM folders WHERE parent_id IS ?
		ORDER BY lock_hash IS NOT NULL, position, id`, nullable(parentID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]folderMatch{}
	for rows.Next() {
		var id int64
		var name string
		var locked bool
		if err := rows.Scan(&id, &name, &locked); err != nil {
			return nil, err
		}
		if _, ok := m[name]; !ok {
			m[name] = folderMatch{id: id, locked: locked}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	imp.names[k] = m
	return m, nil
}

// ExportTree returns the live bookmarks as a tree for the Netscape writer.
// Inbox bookmarks sit at the root; Trash is left out.
func (s *Store) ExportTree() (*netscape.Folder, error) { return s.ExportTreeSkipping(nil) }

// ExportTreeSkipping is ExportTree without the folders for which skip
// returns true, and their bookmarks; skip must also return true for every
// folder below such a folder. A nil skip keeps everything.
func (s *Store) ExportTreeSkipping(skip func(folderID int64) bool) (*netscape.Folder, error) {
	folders, err := s.Folders()
	if err != nil {
		return nil, err
	}
	bookmarks, err := queryBookmarks(s.db, `WHERE deleted_at IS NULL ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	root := &netscape.Folder{Name: "Bookmarks"}
	byID := map[int64]*netscape.Folder{}
	kept := folders[:0:0]
	for _, f := range folders {
		if skip != nil && skip(f.ID) {
			continue
		}
		kept = append(kept, f)
		byID[f.ID] = &netscape.Folder{Name: f.Name, AddDate: f.CreatedAt}
	}
	for _, f := range kept { // already ordered by position
		parent := root
		if f.ParentID != nil {
			if p, ok := byID[*f.ParentID]; ok {
				parent = p
			}
		}
		parent.Folders = append(parent.Folders, byID[f.ID])
	}
	for _, b := range bookmarks {
		if b.FolderID != nil && skip != nil && skip(*b.FolderID) {
			continue
		}
		parent := root
		if b.FolderID != nil {
			if p, ok := byID[*b.FolderID]; ok {
				parent = p
			}
		}
		parent.Links = append(parent.Links, netscape.Link{Title: b.Title, URL: b.URL, AddDate: b.CreatedAt})
	}
	return root, nil
}
