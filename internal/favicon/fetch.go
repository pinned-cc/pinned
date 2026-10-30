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
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"syscall"
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

// ErrUnreachable means the site could not be reached: every request failed
// on DNS, a refused or unroutable connection or a timeout, or the time
// budget ran out on the way. That is often a passing outage and says
// nothing about the site's icon, so it is not counted as an icon failure.
// Lasting answers do count: an HTTP error, a bad icon, a certificate the
// check refuses, a redirect loop, an address the guard refuses.
var ErrUnreachable = errors.New("site did not answer")

// Find fetches pageURL and returns the first icon that downloads and decodes,
// trying apple touch icons, then the manifest, then link icons, then the
// home page's icons when the page has none, then /favicon.ico and /favicon.svg.
// When no icon is found, the error wraps ErrUnreachable if the site could
// not be reached or the time ran out.
func Find(ctx context.Context, client *http.Client, pageURL string) (Icon, error) {
	page, err := url.Parse(pageURL)
	if err != nil {
		return Icon{}, err
	}
	answered := false
	get := func(ctx context.Context, client *http.Client, u string, limit int64) ([]byte, *url.URL, error) {
		data, final, got, err := fetch(ctx, client, u, limit)
		answered = answered || got
		return data, final, err
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
	if !answered || ctx.Err() != nil {
		return Icon{}, fmt.Errorf("no icon found: %w", ErrUnreachable)
	}
	return Icon{}, errors.New("no icon found")
}

// fetch gets u. answered reports whether the failure, if any, is a lasting
// answer from the site rather than an outage (see outage).
func fetch(ctx context.Context, client *http.Client, u string, limit int64) (data []byte, final *url.URL, answered bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, nil, false, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, !outage(err), err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, true, fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err = io.ReadAll(io.LimitReader(resp.Body, limit))
	return data, resp.Request.URL, true, err
}

// outage reports whether err is a network failure that may pass: a DNS
// failure other than "no such host", a timeout, a refused, reset or
// unroutable connection. A name the resolver answers does not exist
// (NXDOMAIN) counts as lasting, like an HTTP error, as do a refusal by the
// guard, a certificate error, a redirect error and anything else.
func outage(err error) bool {
	if errors.Is(err, errBlocked) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return !dns.IsNotFound || dns.IsTimeout || dns.IsTemporary
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "dial" {
		return true
	}
	for _, e := range []error{syscall.ECONNREFUSED, syscall.ECONNRESET, syscall.ENETUNREACH, syscall.EHOSTUNREACH, syscall.ENETDOWN, syscall.EHOSTDOWN} {
		if errors.Is(err, e) {
			return true
		}
	}
	return false
}

// Store is the part of the store the worker pool needs.
type Store interface {
	Bookmark(id int64) (store.Bookmark, error)
	SetIcon(id int64, forKey, icon string, tile *string) (*string, error)
	IconInUse(icon string) bool
	IconFailed(id int64, forKey string, final bool) error
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
	// off and hosts come from ICONS and ICON_HOSTS, set with Configure
	// before the first Enqueue.
	off   bool
	hosts Hosts
}

// Configure applies ICONS=off (no fetch at all, every bookmark keeps its
// letter mark) and ICON_HOSTS. Call it before the first Enqueue.
func (p *Pool) Configure(off bool, hosts Hosts) {
	p.off, p.hosts = off, hosts
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
	if p.off {
		return
	}
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

// Run fetches and stores the icon for one bookmark. Failures are silent,
// and counted so the fetch at start gives up on a link after a few. Only a
// lasting answer counts: a bad or missing icon, an HTTP error, a refused
// certificate or redirect, a domain that does not exist. A site that could
// not be reached (a DNS server that does not answer, no route, refused,
// reset, timeout) is not counted, so a network outage at start does not
// give up on links. A panic
// anywhere in the fetch is caught: the bookmark is given up at once and the
// server keeps running.
func (p *Pool) Run(id int64) {
	if p.off {
		return
	}
	b, err := p.store.Bookmark(id)
	if err != nil {
		return
	}
	// A bookmark on a host outside ICON_HOSTS is not fetched, and not
	// counted as a failure: the list may change.
	if u, err := url.Parse(b.URL); err != nil || !p.hosts.Allow(u.Hostname()) {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("favicon: bookmark %d: icon fetch broke: %v", id, r)
			p.failed(b, true)
		}
	}()
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
		client = newClient(ctx, b.URL, p.hosts)
		defer client.CloseIdleConnections()
	}
	icon, err := Find(ctx, client, b.URL)
	if err != nil {
		if !errors.Is(err, ErrUnreachable) {
			p.failed(b, false)
		}
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

// failed counts a failed fetch for b, unless the pool is stopping and the
// fetch was cut short.
func (p *Pool) failed(b store.Bookmark, final bool) {
	if p.ctx != nil && p.ctx.Err() != nil {
		return
	}
	if err := p.store.IconFailed(b.ID, b.URLKey, final); err != nil && !errors.Is(err, store.ErrNotFound) {
		log.Printf("favicon: bookmark %d: %v", b.ID, err)
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
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), path)
}
