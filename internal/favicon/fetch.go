package favicon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
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
	"strings"
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
	answered, kind := false, ""
	get := func(ctx context.Context, client *http.Client, u string, limit int64) ([]byte, *url.URL, error) {
		data, final, got, err := fetch(ctx, client, u, limit)
		answered = answered || got
		if k := failKind(err); kindRank[k] > kindRank[kind] {
			kind = k
		}
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
		return Icon{}, &noIcon{kind: "unreachable", unreachable: true}
	}
	if kind == "" {
		kind = "no_icon"
	}
	return Icon{}, &noIcon{kind: kind}
}

// noIcon is the error of Find: why no icon was found, as a kind for the
// log. It wraps ErrUnreachable when the site could not be reached.
type noIcon struct {
	kind        string
	unreachable bool
}

func (e *noIcon) Error() string { return "no icon found: " + e.kind }

func (e *noIcon) Unwrap() error {
	if e.unreachable {
		return ErrUnreachable
	}
	return nil
}

// FailKind names why Find found no icon, for the log: certificate (the
// certificate check refused the site), blocked (an address the guard
// refuses), no_such_host, http (an HTTP error), unreachable, no_icon (the
// site answered but had no icon that decodes) or other.
func FailKind(err error) string {
	var e *noIcon
	if errors.As(err, &e) {
		return e.kind
	}
	if err == nil {
		return ""
	}
	return "other"
}

// kindRank orders the kinds of a failed request: when several requests
// for one bookmark fail, the most telling kind is the one logged.
var kindRank = map[string]int{"": 0, "other": 1, "http": 2, "unreachable": 3, "no_such_host": 4, "blocked": 5, "certificate": 6}

// errStatus is a response other than 200.
type errStatus int

func (e errStatus) Error() string { return fmt.Sprintf("status %d", int(e)) }

// failKind is the kind of one failed request, "" for none.
func failKind(err error) string {
	var cert *tls.CertificateVerificationError
	var unknown x509.UnknownAuthorityError
	var invalid x509.CertificateInvalidError
	var host x509.HostnameError
	var status errStatus
	var dns *net.DNSError
	switch {
	case err == nil:
		return ""
	case errors.As(err, &cert), errors.As(err, &unknown), errors.As(err, &invalid), errors.As(err, &host):
		return "certificate"
	case errors.Is(err, errBlocked):
		return "blocked"
	case errors.As(err, &status):
		return "http"
	case errors.As(err, &dns) && dns.IsNotFound && !dns.IsTimeout && !dns.IsTemporary:
		return "no_such_host"
	case outage(err):
		return "unreachable"
	}
	return "other"
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
		return nil, nil, true, errStatus(resp.StatusCode)
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
	DropIcon(icon string) error
	RenameIcon(old, new string) error
	IconsReencoded() bool
	MarkIconsReencoded() error
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
	// logf writes a log line for a failed fetch; set with SetLog.
	logf func(event string, kv ...any)
}

// SetLog sets where failed fetches are logged: one icon.fail event per
// bookmark whose fetch failed, with the host and the kind of failure (see
// FailKind), never the path or query. Call it before the first Enqueue.
func (p *Pool) SetLog(logf func(event string, kv ...any)) { p.logf = logf }

// logFail logs a failed fetch for b, unless the pool is stopping.
func (p *Pool) logFail(host, kind string) {
	if p.logf == nil || (p.ctx != nil && p.ctx.Err() != nil) {
		return
	}
	p.logf("icon.fail", "host", host, "kind", kind)
}

// Configure applies ICONS=off (no fetch at all, every bookmark keeps its
// letter mark) and ICON_HOSTS. Call it before the first Enqueue.
func (p *Pool) Configure(off bool, hosts Hosts) {
	p.off, p.hosts = off, hosts
}

// NewPool rewrites the stored SVG icons (see rewriteStoredSVG) and, once per data
// folder, re-encodes the stored raster icons (see reencodeStored), then
// starts the workers. Icons are written to dir. The workers stop, and fetches in
// flight are cancelled, when ctx ends; Wait waits for them.
func NewPool(ctx context.Context, dir string, st Store) *Pool {
	p := &Pool{
		dir:   dir,
		store: st,
		jobs:  make(chan int64, queueLength),
		ctx:   ctx,
	}
	p.rewriteStoredSVG()
	p.reencodeStored()
	p.wg.Add(workers)
	for i := 0; i < workers; i++ {
		go p.work()
	}
	return p
}

// rewriteStoredSVG runs every stored SVG icon a bookmark uses through the
// current check and rewrite at each start, before anything is served or
// fetched, because versions before 0.1.11 stored the bytes a site sent. A
// file that fails is taken off its bookmarks and deleted, so they show their
// letter; the fetch at start then tries them again under the current rules.
// A file that passes is stored as the rewritten SVG and its bookmarks point
// to that; the old file stays, unserved, like the raster files in
// reencodeStored. A file that is already a rewrite is left as it is, since
// a rewrite of a rewrite gives the same bytes, and a file no bookmark uses
// is not served and is skipped. It reads only the SVG files, which are few
// and small, so start stays quick.
func (p *Pool) rewriteStoredSVG() {
	names, err := filepath.Glob(filepath.Join(p.dir, "*.svg"))
	if err != nil {
		return
	}
	for _, path := range names {
		if p.store.IconInUse(filepath.Base(path)) {
			p.storeAgain(path, "svg")
		}
	}
}

// reencodeStored stores every PNG and JPEG icon that versions before 0.1.11
// kept byte for byte as a new PNG of what it shows, the way new icons are
// stored, and points its bookmarks to the new file. The old file stays on
// disk: no bookmark names it any more, so it is not served, and the
// database copy saved before the upgrade still names it, so going back to
// 0.1.10 with that copy shows the icon. A file that does not decode is
// taken off its bookmarks and deleted, so they show their letter.
// It runs once: a settings flag records the pass, so later starts skip it.
// If anything could not be finished, the flag is not set and the next start
// tries again.
func (p *Pool) reencodeStored() {
	if p.store.IconsReencoded() {
		return
	}
	var names []string
	for _, pat := range []string{"*.png", "*.jpg"} {
		m, err := filepath.Glob(filepath.Join(p.dir, pat))
		if err != nil {
			return
		}
		names = append(names, m...)
	}
	done := true
	for _, path := range names {
		if !p.storeAgain(path, "png") {
			done = false
		}
	}
	if done {
		if err := p.store.MarkIconsReencoded(); err != nil {
			log.Printf("favicon: re-encode: %v", err)
		}
	}
}

// storeAgain runs one stored icon through Process and stores the result the
// way a fresh fetch would, expecting ext ("png" for raster icons, "svg").
// It reports false when the work could not be finished and should be tried
// again.
func (p *Pool) storeAgain(path, ext string) bool {
	name := filepath.Base(path)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return true
	}
	if err != nil {
		log.Printf("favicon: re-encode %s: %v", name, err)
		return false
	}
	icon, err := Process(data)
	if err != nil || icon.Ext != ext {
		if err := p.store.DropIcon(name); err != nil {
			log.Printf("favicon: re-encode %s: %v", name, err)
			return false
		}
		log.Printf("favicon: dropped stored icon %s: it does not pass the check", name)
		remove(path)
		return true
	}
	if bytes.Equal(icon.Data, data) && filepath.Ext(name) == "."+ext {
		return true // already stored as it would be now
	}
	// The same naming as a fresh fetch: the bookmark id part is kept, the
	// hash and the extension follow the new file.
	prefix := strings.TrimSuffix(name, filepath.Ext(name))
	if i := strings.LastIndexByte(prefix, '-'); i > 0 {
		prefix = prefix[:i]
	}
	sum := sha256.Sum256(icon.Data)
	newName := fmt.Sprintf("%s-%s.%s", prefix, hex.EncodeToString(sum[:4]), icon.Ext)
	if err := writeFile(filepath.Join(p.dir, newName), icon.Data); err != nil {
		log.Printf("favicon: re-encode %s: %v", name, err)
		return false
	}
	if newName == name {
		return true
	}
	if err := p.store.RenameIcon(name, newName); err != nil {
		log.Printf("favicon: re-encode %s: %v", name, err)
		if !p.store.IconInUse(newName) {
			remove(filepath.Join(p.dir, newName))
		}
		return false
	}
	return true // the old file stays, see reencodeStored
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
	u, err := url.Parse(b.URL)
	if err != nil || !p.hosts.Allow(u.Hostname()) {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("favicon: bookmark %d: icon fetch broke: %v", id, r)
			p.logFail(u.Hostname(), "broke")
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
		p.logFail(u.Hostname(), FailKind(err))
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
