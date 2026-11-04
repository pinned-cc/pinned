// Tests for the browser extension in extras/extension: the shared API client and helpers
// (shared.js) and the right click save (background.js), run against a local test server.
// The extension's scripts are plain browser scripts; each test loads them into a fresh
// node:vm context with a stub of the browser's extension API. No dependencies:
//
//   node --test tools/extension.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'extras', 'extension');
const source = name => readFileSync(join(dir, name), 'utf8');

// Values made inside the vm context have that context's prototypes; compare them as plain data.
const plain = v => JSON.parse(JSON.stringify(v));

// A stub of browser.* with storage in memory, recording menus, badges and option page opens.
function stubBrowser(stored = {}) {
  const listeners = { installed: [], startup: [], clicked: [] };
  const rec = { menus: [], badges: [], optionsOpened: 0, store: { ...stored } };
  const browser = {
    storage: { local: {
      async get(keys) { const out = {}; for (const k of keys) if (k in rec.store) out[k] = rec.store[k]; return out; },
      async set(obj) { Object.assign(rec.store, obj); },
    } },
    contextMenus: {
      removeAll(cb) { rec.menus = []; cb(); },
      create(m) { rec.menus.push(m); },
      onClicked: { addListener: f => listeners.clicked.push(f) },
    },
    runtime: {
      onInstalled: { addListener: f => listeners.installed.push(f) },
      onStartup: { addListener: f => listeners.startup.push(f) },
      openOptionsPage() { rec.optionsOpened++; },
    },
    action: {
      setBadgeBackgroundColor() {},
      setBadgeTextColor() {},
      setBadgeText({ text }) { if (text) rec.badges.push(text); },
    },
  };
  return { browser, listeners, rec };
}

// Loads the named scripts, in order, into one context, as the manifest does.
function load(scripts, browser, extra = {}) {
  const ctx = vm.createContext({
    browser, URL, fetch, console, AbortController, ...extra,
    // the badge clears itself after two seconds; the tests do not wait for that
    setTimeout: () => 0, clearTimeout: () => {}, ...extra,
  });
  for (const s of scripts) vm.runInContext(source(s), ctx, { filename: s });
  return ctx;
}

// A test server that answers with the handler and records every request.
async function server(handler) {
  const requests = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const r = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined };
      requests.push(r);
      handler(r, res);
    });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const address = `http://127.0.0.1:${srv.address().port}`;
  return { address, requests, close: () => new Promise(ok => srv.close(ok)) };
}
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

test('cleanAddress keeps scheme, host, port and path, drops the rest', () => {
  const { Pinned } = load(['shared.js'], stubBrowser().browser);
  const cases = [
    ['bookmarks.example.com', 'https://bookmarks.example.com'],
    ['  https://bookmarks.example.com/  ', 'https://bookmarks.example.com'],
    ['http://10.0.0.5:9095', 'http://10.0.0.5:9095'],
    ['HTTP://Homelab:8080/pinned//', 'http://homelab:8080/pinned'],
    ['https://example.com:443/', 'https://example.com'],
    ['https://example.com/a?q=1#x', 'https://example.com/a'],
    ['ftp://example.com', ''],
    ['javascript:alert(1)', ''],
    ['', ''],
    [null, ''],
    ['http://', ''],
  ];
  for (const [raw, want] of cases) assert.equal(Pinned.cleanAddress(raw), want, String(raw));
});

test('addressCandidates tries https then http for an address typed without a scheme', () => {
  const { Pinned } = load(['shared.js'], stubBrowser().browser);
  const cases = [
    ['10.0.0.5:9095', ['https://10.0.0.5:9095', 'http://10.0.0.5:9095']],
    [' homelab:8080/pinned/ ', ['https://homelab:8080/pinned', 'http://homelab:8080/pinned']],
    ['http://10.0.0.5:9095', ['http://10.0.0.5:9095']],
    ['https://bookmarks.example.com/', ['https://bookmarks.example.com']],
    ['ftp://example.com', []],
    ['javascript:alert(1)', []],
    ['', []],
    [null, []],
  ];
  for (const [raw, want] of cases) assert.deepEqual(plain(Pinned.addressCandidates(raw)), want, String(raw));
});

test('probe falls back from https to http and names the address that answered', async () => {
  const srv = await server((r, res) => r.headers.authorization === 'Bearer tk_ok' ? json(res, 200, [{ id: 1 }, { id: 2 }]) : json(res, 401, { error: 'unauthorized' }));
  try {
    const { Pinned } = load(['shared.js'], stubBrowser().browser);
    const hostPort = srv.address.replace('http://', '');
    const got = plain(await Pinned.probe(Pinned.addressCandidates(hostPort), 'tk_ok'));
    assert.equal(got.address, srv.address);
    assert.equal(got.folders.length, 2);
    // a server that answers stops the search, and the error says where it was reached
    await assert.rejects(Pinned.probe(['http://' + hostPort, 'http://127.0.0.1:1'], 'tk_bad'), e => {
      assert.equal(e.address, srv.address); assert.equal(e.message, 'The token was not accepted'); return true; });
    assert.equal(srv.requests.length, 2);
  } finally { await srv.close(); }
  // nothing answers: the message names every address tried
  const { Pinned } = load(['shared.js'], stubBrowser().browser);
  await assert.rejects(Pinned.probe(Pinned.addressCandidates('127.0.0.1:1'), 'tk'), e => {
    assert.equal(e.network, true);
    assert.equal(e.message, 'Could not reach https://127.0.0.1:1 or http://127.0.0.1:1. Check the address and that Pinned is running');
    return true; });
});

test('originPattern asks for the host only, every port', () => {
  const { Pinned } = load(['shared.js'], stubBrowser().browser);
  assert.equal(Pinned.originPattern('http://10.0.0.5:9095'), 'http://10.0.0.5/*');
  assert.equal(Pinned.originPattern('https://bookmarks.example.com/pinned'), 'https://bookmarks.example.com/*');
});

test('config fills what is missing and ignores a recent list that is not a list', async () => {
  let { Pinned } = load(['shared.js'], stubBrowser().browser);
  assert.deepEqual(plain(await Pinned.config()), { address: '', token: '', recent: [] });
  ({ Pinned } = load(['shared.js'], stubBrowser({ address: 'https://a.example', token: 'tk_1', recent: 'x' }).browser));
  assert.deepEqual(plain(await Pinned.config()), { address: 'https://a.example', token: 'tk_1', recent: [] });
});

test('remember keeps the three most recent folders, newest first, without repeats', async () => {
  const { browser, rec } = stubBrowser({ recent: [1, 2, 3] });
  const { Pinned } = load(['shared.js'], browser);
  await Pinned.remember(3);
  assert.deepEqual(plain(rec.store.recent), [3, 1, 2]);
  await Pinned.remember(4);
  assert.deepEqual(plain(rec.store.recent), [4, 3, 1]);
  await Pinned.remember(null); // the Inbox is not a folder
  assert.deepEqual(plain(rec.store.recent), [4, 3, 1]);
});

test('api sends the token and the JSON body, and returns the answer', async () => {
  const srv = await server((r, res) => json(res, r.method === 'POST' ? 201 : 200, r.method === 'POST' ? { id: 7 } : [{ id: 1, name: 'Work' }]));
  try {
    const { Pinned } = load(['shared.js'], stubBrowser().browser);
    const cfg = { address: srv.address, token: 'tk_abc' };
    assert.deepEqual(plain(await Pinned.api(cfg, 'GET', '/api/folders')), [{ id: 1, name: 'Work' }]);
    assert.deepEqual(plain(await Pinned.api(cfg, 'POST', '/api/bookmarks', { title: 'T', url: 'https://x.example/', folder_id: null })), { id: 7 });
    const [get, post] = srv.requests;
    assert.equal(get.method, 'GET');
    assert.equal(get.url, '/api/folders');
    assert.equal(get.headers.authorization, 'Bearer tk_abc');
    assert.equal(get.headers['content-type'], undefined);
    assert.equal(get.headers.cookie, undefined);
    assert.equal(post.method, 'POST');
    assert.equal(post.headers['content-type'], 'application/json');
    assert.deepEqual(post.body, { title: 'T', url: 'https://x.example/', folder_id: null });
  } finally { await srv.close(); }
});

test('api turns error answers into errors with the status and a message', async () => {
  const srv = await server((r, res) => {
    if (r.url === '/401') return json(res, 401, { error: 'unauthorized' });
    if (r.url === '/409') return json(res, 409, { error: 'already saved', bookmark: { id: 3 } });
    if (r.url === '/500') { res.writeHead(500, { 'Content-Type': 'text/plain' }); return res.end('boom'); }
    if (r.url === '/bad-json') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{'); }
    json(res, 200, {});
  });
  try {
    const { Pinned } = load(['shared.js'], stubBrowser().browser);
    const cfg = { address: srv.address, token: 'tk_abc' };
    const fails = async (path, status, message) => {
      await assert.rejects(Pinned.api(cfg, 'GET', path), e => { assert.equal(e.status, status); assert.equal(e.message, message); return true; });
    };
    await fails('/401', 401, 'The token was not accepted');
    await fails('/409', 409, 'already saved');
    await fails('/500', 500, 'The server answered 500');
    await fails('/bad-json', 400, 'The server answered 400');
    await assert.rejects(Pinned.api(cfg, 'GET', '/409'), e => plain(e.data).bookmark.id === 3);
  } finally { await srv.close(); }
});

test('api reports a server it cannot reach as a network error', async () => {
  const srv = await server(() => {});
  const address = srv.address;
  await srv.close(); // nothing listens there now
  const { Pinned } = load(['shared.js'], stubBrowser().browser);
  await assert.rejects(Pinned.api({ address, token: 't' }, 'GET', '/api/folders'), e => {
    assert.equal(e.network, true);
    assert.equal(e.message, 'Could not reach ' + address);
    return true;
  });
});

test('folderIndex: hues by top level folder, paths, and the tree order', () => {
  const { Pinned } = load(['shared.js'], stubBrowser().browser);
  const folders = [
    { id: 5, name: 'Home', parent_id: null, position: 0 },
    { id: 2, name: 'Work', parent_id: null, position: 1 },
    { id: 9, name: 'Docs', parent_id: 2, position: 1 },
    { id: 8, name: 'Code', parent_id: 2, position: 0 },
    { id: 12, name: 'Go', parent_id: 8, position: 0 },
  ];
  const F = Pinned.folderIndex(folders);
  assert.equal(F.hue(null), 'tray');
  assert.equal(F.hue(2), 'cyan'); // created first
  assert.equal(F.hue(5), 'coral');
  assert.equal(F.hue(12), 'cyan'); // the hue of its top level folder
  assert.equal(F.hue(99), 'plain'); // not there
  assert.equal(F.path(null), 'Inbox');
  assert.equal(F.path(12), 'Work / Code / Go');
  assert.equal(F.path(99), 'Inbox');
  assert.equal(F.has(9), true);
  assert.equal(F.has(99), false);
  assert.deepEqual(plain(F.flat().map(x => [x.f.name, x.depth])), [['Home', 0], ['Work', 0], ['Code', 1], ['Go', 2], ['Docs', 1]]);
});

test('folderIndex stops on a folder loop instead of hanging', () => {
  const { Pinned } = load(['shared.js'], stubBrowser().browser);
  const F = Pinned.folderIndex([{ id: 1, name: 'A', parent_id: 2, position: 0 }, { id: 2, name: 'B', parent_id: 1, position: 0 }]);
  assert.ok(F.path(1).split(' / ').length <= 64);
});

test('background: the menus are made on install', () => {
  const { browser, listeners, rec } = stubBrowser();
  load(['shared.js', 'background.js'], browser);
  assert.equal(listeners.installed.length, 1);
  listeners.installed[0]();
  assert.deepEqual(plain(rec.menus.map(m => [m.id, m.contexts[0]])), [['pinned-page', 'page'], ['pinned-link', 'link']]);
});

// Clicks a menu item and waits for the save to finish.
async function click(listeners, rec, info, tab) {
  const before = rec.badges.length + rec.optionsOpened;
  listeners.clicked[0](info, tab);
  for (let i = 0; i < 200 && rec.badges.length + rec.optionsOpened === before; i++) await new Promise(ok => setImmediate(ok));
}

test('background: Save to Pinned posts the page or the link to the Inbox and shows the result', async () => {
  let answer = 201;
  const srv = await server((r, res) => json(res, answer, answer === 201 ? { id: 1 } : { error: 'x' }));
  try {
    const { browser, listeners, rec } = stubBrowser({ address: srv.address, token: 'tk_bg' });
    load(['shared.js', 'background.js'], browser);

    await click(listeners, rec, { menuItemId: 'pinned-page', pageUrl: 'https://a.example/page' }, { title: '  A page ', url: 'https://a.example/page' });
    await click(listeners, rec, { menuItemId: 'pinned-link', linkUrl: 'https://b.example:8443/x', linkText: '' }, {});
    answer = 409;
    await click(listeners, rec, { menuItemId: 'pinned-page', pageUrl: 'https://a.example/page' }, { title: 'A page' });
    answer = 500;
    await click(listeners, rec, { menuItemId: 'pinned-page', pageUrl: 'https://a.example/page' }, { title: 'A page' });
    await click(listeners, rec, { menuItemId: 'pinned-page', pageUrl: 'chrome://settings' }, { title: 'Settings' });

    assert.deepEqual(rec.badges, ['✓', '✓', '=', '!', '!']);
    assert.equal(srv.requests.length, 4); // the chrome:// page is never sent
    assert.deepEqual(srv.requests[0].body, { title: 'A page', url: 'https://a.example/page', folder_id: null });
    assert.deepEqual(srv.requests[1].body, { title: 'b.example:8443', url: 'https://b.example:8443/x', folder_id: null });
    for (const r of srv.requests) { assert.equal(r.method, 'POST'); assert.equal(r.url, '/api/bookmarks'); assert.equal(r.headers.authorization, 'Bearer tk_bg'); }
  } finally { await srv.close(); }
});

test('background: without an address or token the options page opens and nothing is sent', async () => {
  const { browser, listeners, rec } = stubBrowser({ address: 'http://127.0.0.1:1' });
  load(['shared.js', 'background.js'], browser);
  await click(listeners, rec, { menuItemId: 'pinned-page', pageUrl: 'https://a.example/' }, { title: 'A' });
  assert.equal(rec.optionsOpened, 1);
  assert.deepEqual(rec.badges, []);
});

test('localHost: own network hosts only', () => {
  const { Pinned } = load(['shared.js'], stubBrowser().browser);
  for (const h of ['10.0.0.5', '127.0.0.1', '172.16.3.4', '172.31.0.1', '192.168.1.20', '169.254.1.1', '100.100.1.1', '[::1]', '[fd12::1]', '[fe80::1]', 'localhost', 'homelab', 'nas.local', 'pinned.lan', 'box.home.arpa', 'x.internal'])
    assert.equal(Pinned.localHost(h), true, h);
  for (const h of ['bookmarks.example.com', '203.0.113.5', '172.32.0.1', '100.128.0.1', '8.8.8.8', '[2001:db8::1]', 'local.example.com'])
    assert.equal(Pinned.localHost(h), false, h);
});

// A fetch stand-in: https fails as a blocked or broken TLS connection would, http answers. Records every request.
function fakeFetch() {
  const seen = [];
  const f = async (url, opt) => {
    seen.push({ url, auth: opt && opt.headers && opt.headers.Authorization });
    if (url.startsWith('https:')) throw new TypeError('TLS failed');
    return new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { f, seen };
}

test('probe never sends the token over plain http to a public host it fell back to', async () => {
  const { f, seen } = fakeFetch();
  const { Pinned } = load(['shared.js'], stubBrowser().browser, { fetch: f });
  await assert.rejects(Pinned.probe(Pinned.addressCandidates('bookmarks.example.com'), 'tk_secret'), e => {
    assert.equal(e.plain, 'http://bookmarks.example.com');
    assert.match(e.message, /type http:\/\/bookmarks\.example\.com to connect anyway/);
    return true; });
  for (const r of seen) if (r.url.startsWith('http:')) assert.equal(r.auth, undefined, 'token sent to ' + r.url);
  assert.deepEqual(plain(seen.filter(r => r.url.startsWith('http:')).map(r => r.url)), ['http://bookmarks.example.com/health']);
  // typed with http://, the user chose plain http: the token goes there
  seen.length = 0;
  const got = plain(await Pinned.probe(Pinned.addressCandidates('http://bookmarks.example.com'), 'tk_secret'));
  assert.equal(got.address, 'http://bookmarks.example.com');
  assert.equal(seen[0].auth, 'Bearer tk_secret');
  // a home server falls back to http with the token, as before
  seen.length = 0;
  assert.equal(plain(await Pinned.probe(Pinned.addressCandidates('10.0.0.5:9095'), 'tk_secret')).address, 'http://10.0.0.5:9095');
});

// The options page in a stand-in DOM: the elements options.js reads, a form whose submit can be fired, permissions in memory.
function optionsPage(stored, granted) {
  const { browser, rec } = stubBrowser(stored);
  const perms = new Set(granted);
  rec.removed = []; rec.requested = [];
  browser.permissions = {
    async contains({ origins }) { return origins.every(o => perms.has(o)); },
    async request({ origins }) { rec.requested.push(origins); origins.forEach(o => perms.add(o)); return true; },
    async remove({ origins }) { origins.forEach(o => { perms.delete(o); rec.removed.push(o); }); return true; },
  };
  const node = () => ({ value: '', hidden: true, className: '', disabled: false, children: [], textContent: '',
    handlers: {}, setAttribute() {}, appendChild(c) { this.children.push(c); }, focus() {},
    addEventListener(k, f) { this.handlers[k] = f; }, replaceChildren(...c) { this.children = c; } });
  const els = { form: node(), address: node(), token: node(), test: node(), status: node() };
  const document = { getElementById: id => els[id], createElement: node, createElementNS: node, createTextNode: t => ({ textContent: t }) };
  const statusText = () => els.status.children.map(c => c.textContent || (c.children || []).map(x => x.textContent).join('')).join('');
  return { browser, rec, perms, els, document, statusText };
}
const settle = () => new Promise(ok => setTimeout(ok, 50));

test('options: a failed Save keeps the access the saved address uses', async () => {
  const page = optionsPage({ address: 'http://127.0.0.1:1', token: 'tk_old' }, ['http://127.0.0.1/*']);
  const ctx = load(['shared.js', 'options.js'], page.browser, { document: page.document, setTimeout, clearTimeout });
  await settle();
  page.els.address.value = '127.0.0.1:1'; page.els.token.value = 'tk_new';
  page.els.form.handlers.submit({ preventDefault() {} });
  for (let i = 0; i < 40 && !/Nothing was saved/.test(page.statusText()); i++) await settle();
  assert.match(page.statusText(), /Nothing was saved/);
  assert.ok(page.perms.has('http://127.0.0.1/*'), 'the saved address lost its access');
  assert.ok(!page.perms.has('https://127.0.0.1/*'), 'the access this Save was granted stayed');
  assert.deepEqual(plain(page.rec.removed), ['https://127.0.0.1/*']);
  assert.equal(page.rec.store.address, 'http://127.0.0.1:1');
  assert.ok(ctx);
});

// S23.1 (F-138): an address typed with http:// for a host outside the own network: Test and Save warn first and go
// ahead on a second click of the same button; once gone ahead, the address counts for both until it changes.
const TEST_WARN = 'On plain http your token may cross the internet unencrypted. Use https, or click Test again to connect anyway.';
const SAVE_WARN = 'On plain http your token may cross the internet unencrypted. Use https, or click Save again to save anyway.';
function optionsWithFetch(stored = {}) {
  const page = optionsPage(stored, []), net = fakeFetch();
  load(['shared.js', 'options.js'], page.browser, { document: page.document, fetch: net.f, setTimeout, clearTimeout });
  const click = async () => { await page.els.test.handlers.click(); };
  const submit = async () => { page.els.form.handlers.submit({ preventDefault() {} }); for (let i = 0; i < 40 && /^(Waiting|Looking)/.test(page.statusText()); i++) await settle(); await settle(); };
  return { ...page, net, click, submit };
}

test('options: Test warns first for a public http address, sends nothing, and connects on the second click', async () => {
  const o = optionsWithFetch(); await settle();
  o.els.address.value = 'http://bookmarks.example.com'; o.els.token.value = 'tk_secret';
  await o.click();
  assert.equal(o.statusText(), TEST_WARN);
  assert.equal(o.els.status.className, 'status bad');
  assert.equal(o.net.seen.length, 0, 'the first Test sent a request');
  await o.click();
  assert.equal(o.statusText(), 'Connected to http://bookmarks.example.com, 1 folder.');
  assert.deepEqual(plain(o.net.seen), [{ url: 'http://bookmarks.example.com/api/folders', auth: 'Bearer tk_secret' }]);
});

test('options: Save warns first for a public http address, asks for no access and stores nothing, then saves on the second click', async () => {
  const o = optionsWithFetch(); await settle();
  o.els.address.value = 'http://bookmarks.example.com'; o.els.token.value = 'tk_secret';
  await o.submit();
  assert.equal(o.statusText(), SAVE_WARN);
  assert.equal(o.rec.requested.length, 0, 'the first Save asked for access');
  assert.equal(o.rec.store.address, undefined); assert.equal(o.rec.store.token, undefined);
  await o.submit();
  assert.deepEqual(plain(o.rec.requested), [['http://bookmarks.example.com/*']]);
  assert.equal(o.rec.store.address, 'http://bookmarks.example.com'); assert.equal(o.rec.store.token, 'tk_secret');
  assert.equal(o.statusText(), 'Saved http://bookmarks.example.com.');
  assert.equal(o.net.seen.length, 0);
});

test('options: gone ahead on Test, Save does not warn again; a warning of one button does not arm the other; a changed address warns again', async () => {
  const o = optionsWithFetch(); await settle();
  o.els.address.value = 'http://bookmarks.example.com'; o.els.token.value = 'tk_secret';
  await o.click(); await o.click();
  assert.match(o.statusText(), /^Connected/);
  await o.submit();
  assert.equal(o.statusText(), 'Saved http://bookmarks.example.com.');
  assert.equal(o.rec.requested.length, 1);
  // the address Save writes back, and the same address typed in capitals or with a slash, stays gone ahead
  o.els.address.value = 'HTTP://Bookmarks.Example.com/';
  await o.click(); assert.match(o.statusText(), /^Connected/);
  // a warning of Test does not arm Save
  o.els.address.value = 'http://pinned.example.org';
  await o.click(); assert.equal(o.statusText(), TEST_WARN);
  await o.submit(); assert.equal(o.statusText(), SAVE_WARN);
  assert.equal(o.rec.requested.length, 1, 'Save went ahead on a warning of Test');
  // the address changed between two clicks: the next click warns again
  o.els.address.value = 'http://other.example.org';
  await o.submit(); assert.equal(o.statusText(), SAVE_WARN);
  assert.equal(o.rec.requested.length, 1);
  // and going back to the first address after a change asks again
  o.els.address.value = 'http://bookmarks.example.com';
  const before = o.net.seen.length;
  await o.click(); assert.equal(o.statusText(), TEST_WARN); assert.equal(o.net.seen.length, before);
});

test('options: own network, https and addresses without a scheme go ahead on the first click; public IPv4 and IPv6 over http warn', async () => {
  for (const a of ['http://10.0.0.5:9095', 'http://127.0.0.1:9095', 'http://localhost:9095', 'http://nas', 'http://[::1]:9095', 'http://nas.local']) {
    const o = optionsWithFetch(); await settle();
    o.els.address.value = a; o.els.token.value = 'tk_secret';
    await o.click();
    assert.match(o.statusText(), /^Connected to /, a);
    assert.equal(o.net.seen.length, 1, a);
    await o.submit();
    assert.match(o.statusText(), /^Saved /, a);
    assert.equal(o.rec.requested.length, 1, a);
  }
  for (const a of ['https://bookmarks.example.com', 'bookmarks.example.com']) {
    const o = optionsWithFetch(); await settle();
    o.els.address.value = a; o.els.token.value = 'tk_secret';
    await o.click();
    assert.doesNotMatch(o.statusText(), /click (Test|Save) again/, a);
    assert.ok(o.net.seen.length >= 1, a + ': no request');
    for (const r of o.net.seen) if (r.url.startsWith('http:')) assert.equal(r.auth, undefined, 'token sent to ' + r.url);
    await o.submit();
    assert.doesNotMatch(o.statusText(), /click (Test|Save) again/, a);
    assert.equal(o.rec.requested.length, 1, a);
  }
  for (const a of ['http://203.0.113.5:9095', 'http://[2001:db8::1]', 'http://nas.tailnet.ts.net', 'http://nas.example.home:9095', 'http://[::ffff:10.0.0.5]']) {
    const o = optionsWithFetch(); await settle();
    o.els.address.value = a; o.els.token.value = 'tk_secret';
    await o.click(); assert.equal(o.statusText(), TEST_WARN, a);
    await o.submit(); assert.equal(o.statusText(), SAVE_WARN, a);
    assert.equal(o.net.seen.length, 0, a); assert.equal(o.rec.requested.length, 0, a);
  }
});

test('options: an address saved before with http:// for a public host is used until Test or Save; Test then warns once', async () => {
  const o = optionsWithFetch({ address: 'http://bookmarks.example.com', token: 'tk_old' }); await settle();
  assert.equal(o.els.address.value, 'http://bookmarks.example.com');
  await o.click(); assert.equal(o.statusText(), TEST_WARN); assert.equal(o.net.seen.length, 0);
  await o.click(); assert.match(o.statusText(), /^Connected/);
});

// The extension carries the version of the release it ships in, the newest
// heading of CHANGELOG.md, so a user can tell which build is loaded (spec S23.23).
test('manifest version is the newest release in CHANGELOG.md', () => {
  const manifest = JSON.parse(source('manifest.json'));
  const changelog = readFileSync(join(dir, '..', '..', 'CHANGELOG.md'), 'utf8');
  const newest = changelog.match(/^## (\d+\.\d+\.\d+)/m)[1];
  assert.equal(manifest.version, newest);
});
