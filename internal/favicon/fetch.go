package favicon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/pinned-cc/pinned/internal/store"
)

const (
	budget      = 6 * time.Second // total time for one bookmark
	maxPage     = 512 << 10
	maxIcon     = 2 << 20
	maxTries    = 8
	workers     = 4
	userAgent   = "Mozilla/5.0 (compatible; Pinned bookmarks; favicon fetch)"
	queueLength = 4096
)

// Find fetches pageURL and returns the first icon that downloads and decodes,
// trying apple touch icons, then the manifest, then link icons, then the
// home page's icons when the page has none, then /favicon.ico and /favicon.svg.
func Find(ctx context.Context, client *http.Client, pageURL string) (Icon, error) {
	page, err := url.Parse(pageURL)
	if err != nil {
		return Icon{}, err
	}
	var c Candidates
	if body, final, err := get(ctx, client, pageURL, maxPage); err == nil {
		page = final
		c = Choose(final, bytes.NewReader(body))
	}

	var list []string
	list = append(list, c.Apple...)
	if c.Manifest != "" {
		if data, final, err := get(ctx, client, c.Manifest, maxPage); err == nil {
			list = append(list, ManifestIcons(final, data)...)
		}
	}
	list = append(list, c.Icons...)
	root := page.Scheme + "://" + page.Host
	// A deep link (a dashboard, a sign in page) often declares no icon of its
	// own; the site's home page does.
	if len(c.Apple)+len(c.Icons) == 0 && c.Manifest == "" && page.Path != "" && page.Path != "/" {
		if body, final, err := get(ctx, client, root+"/", maxPage); err == nil {
			h := Choose(final, bytes.NewReader(body))
			list = append(list, h.Apple...)
			list = append(list, h.Icons...)
		}
	}
	list = append(list, root+"/favicon.ico", root+"/favicon.svg")

	seen := map[string]bool{}
	tries := 0
	for _, u := range list {
		if seen[u] || tries >= maxTries || ctx.Err() != nil {
			continue
		}
		seen[u] = true
		tries++
		data, _, err := get(ctx, client, u, maxIcon)
		if err != nil {
			continue
		}
		if icon, err := Process(data); err == nil {
			return icon, nil
		}
	}
	return Icon{}, errors.New("no icon found")
}

func get(ctx context.Context, client *http.Client, u string, limit int64) ([]byte, *url.URL, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	return data, resp.Request.URL, err
}

// Store is the part of the store the worker pool needs.
type Store interface {
	Bookmark(id int64) (store.Bookmark, error)
	SetIcon(id int64, forKey, icon string, tile *string) (*string, error)
	IconInUse(icon string) bool
}

// Pool fetches icons in the background, at most four at a time.
type Pool struct {
	dir   string
	store Store
	// client replaces the guarded client NewClient builds per bookmark;
	// tests set it.
	client *http.Client
	jobs   chan int64
	ctx    context.Context
	wg     sync.WaitGroup
}

// NewPool starts the workers. Icons are written to dir. The workers stop,
// and fetches in flight are cancelled, when ctx ends; Wait waits for them.
func NewPool(ctx context.Context, dir string, st Store) *Pool {
	p := &Pool{
		dir:   dir,
		store: st,
		jobs:  make(chan int64, queueLength),
		ctx:   ctx,
	}
	p.wg.Add(workers)
	for i := 0; i < workers; i++ {
		go p.work()
	}
	return p
}

// Wait blocks until every worker has stopped.
func (p *Pool) Wait() { p.wg.Wait() }

// Enqueue asks for an icon for bookmark id. It never blocks; when the queue
// is full the request is dropped and the bookmark keeps its letter mark.
func (p *Pool) Enqueue(id int64) {
	select {
	case p.jobs <- id:
	default:
	}
}

func (p *Pool) work() {
	defer p.wg.Done()
	for {
		select {
		case <-p.ctx.Done():
			return
		case id := <-p.jobs:
			p.Run(id)
		}
	}
}

// Run fetches and stores the icon for one bookmark. Failures are silent.
func (p *Pool) Run(id int64) {
	b, err := p.store.Bookmark(id)
	if err != nil {
		return
	}
	parent := p.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, budget)
	defer cancel()
	client := p.client
	if client == nil {
		// Self hosted services often use self signed certificates; the
		// default verification stays on, so those simply get no icon.
		client = NewClient(ctx, b.URL)
		defer client.CloseIdleConnections()
	}
	icon, err := Find(ctx, client, b.URL)
	if err != nil {
		return
	}
	sum := sha256.Sum256(icon.Data)
	name := fmt.Sprintf("%d-%s.%s", id, hex.EncodeToString(sum[:4]), icon.Ext)
	if err := writeFile(filepath.Join(p.dir, name), icon.Data); err != nil {
		log.Printf("favicon: write %s: %v", name, err)
		return
	}
	prev, err := p.store.SetIcon(id, b.URLKey, name, icon.Tile)
	if err != nil {
		// The bookmark changed or vanished while we were fetching.
		if !p.store.IconInUse(name) {
			remove(filepath.Join(p.dir, name))
		}
		return
	}
	if prev != nil && *prev != name && !p.store.IconInUse(*prev) {
		remove(filepath.Join(p.dir, *prev))
	}
}

func remove(path string) {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("favicon: %v", err)
	}
}

// writeFile writes atomically: a temp file in the same folder, then rename.
func writeFile(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".icon-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), path)
}
