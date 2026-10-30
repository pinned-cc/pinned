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
function load(scripts, browser) {
  const ctx = vm.createContext({
    browser, URL, fetch, console,
    // the badge clears itself after two seconds; the tests do not wait for that
    setTimeout: () => 0, clearTimeout: () => {},
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
