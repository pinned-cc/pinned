// UI smoke test for the web front end, Chromium, WebKit and Firefox, desktop 1440x900 (and 768 to 1280 for the sidebar), phone 390x844 (and 320),
// and a mouse in a 700 px window.
//
// Run against a running instance whose data you do not mind changing (it adds and removes a
// folder, bookmarks and a token, all named "ui-test ..."):
//
//   node tools/ui-test.mjs http://127.0.0.1:9098 <app password> [--shots <dir>] [--only chromium|webkit|firefox]
//
// Playwright is not a dependency of the repo. The script takes the first that loads:
//   1. PLAYWRIGHT_MODULE=/path/to/playwright (a folder or its index.mjs)
//   2. import('playwright') from a global or local node_modules
//   3. the driver bundled with the Python package (pip install playwright), found with python3
// Browsers come from `npx playwright install chromium webkit firefox` (or `python3 -m playwright install`)
// for the same Playwright version.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const shotsDir = flag('--shots');
const only = flag('--only');
const [BASE = 'http://127.0.0.1:9098', PASSWORD = process.env.APP_PASSWORD] = args;
if (!PASSWORD) { console.error('usage: node tools/ui-test.mjs <base url> <app password> [--shots dir] [--only engine]'); process.exit(2); }
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

async function loadPlaywright() {
  const tries = [];
  if (process.env.PLAYWRIGHT_MODULE) {
    const p = process.env.PLAYWRIGHT_MODULE;
    tries.push(pathToFileURL(p.endsWith('.mjs') || p.endsWith('.js') ? p : join(p, 'index.mjs')).href);
  }
  tries.push('playwright');
  try {
    const dir = execFileSync('python3', ['-c', 'import playwright,os;print(os.path.dirname(playwright.__file__))'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const p = join(dir, 'driver', 'package', 'index.mjs'); if (existsSync(p)) tries.push(pathToFileURL(p).href);
  } catch { /* no Python Playwright */ }
  for (const t of tries) { try { const m = await import(t); const pw = m.chromium ? m : m.default; if (pw && pw.chromium) return pw; } catch { /* next */ } }
  throw new Error('Playwright not found. Set PLAYWRIGHT_MODULE or install playwright.');
}

const stamp = Date.now().toString(36);
const T = {
  folder: `ui-test ${stamp}`,
  title: `ui-test card ${stamp}`,
  url: `https://ui-test.example/${stamp}/card`,
  saveTitle: `ui-test saved ${stamp}`,
  saveUrl: `https://ui-test.example/${stamp}/saved`,
  token: `ui-test token ${stamp}`,
  lockPw: 'lockpw-ui',
};
const SOURCE = 'https://github.com/pinned-cc/pinned';
const TOKENS_EMPTY = 'A token lets the extension or a script read your folders and save links. It cannot export, share, lock or delete anything.';

let failures = 0, passes = 0, beforeEach = null;
async function check(label, fn) {
  try { if (beforeEach) await beforeEach(); await fn(); passes++; console.log(`  ok    ${label}`); }
  catch (e) { failures++; console.log(`  FAIL  ${label}\n        ${String(e.message || e).split("\n").slice(0, process.env.UI_LINES ? 4 : 1).join(" | ")}`); }
}
const visible = (loc, timeout = 6000) => loc.first().waitFor({ state: 'visible', timeout });
const gone = (loc, timeout = 6000) => loc.first().waitFor({ state: 'hidden', timeout });
async function until(page, fn, arg, what, timeout = 6000) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); } catch { throw new Error('timed out: ' + what); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
/* the mouse moves out of the way first, unless a drag holds it (moving it would carry the drag off its target) */
async function shot(page, name, holding) { if (!shotsDir) return; if (!holding) await page.mouse.move(1, 1).catch(() => {}); await page.waitForTimeout(350); await page.screenshot({ path: join(shotsDir, name + '.png') }); }

/* the JSON API from inside the page, with the session and the CSRF header */
const apiIn = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(p, { method: m, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text(); try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t }; }
}, [method, path, body]);

/* remove everything an earlier or this run left behind */
async function cleanup(page) {
  const s = (await apiIn(page, 'GET', '/api/state')).data;
  for (const f of (s.folders || []).filter(f => f.name.startsWith('ui-test'))) {
    if (f.locked) await apiIn(page, 'DELETE', `/api/folders/${f.id}/lock`, { app_password: PASSWORD });
    await apiIn(page, 'DELETE', `/api/folders/${f.id}`);
  }
  const s2 = (await apiIn(page, 'GET', '/api/state')).data;
  for (const b of (s2.bookmarks || []).filter(b => b.url.startsWith('https://ui-test.example/'))) {
    if (!b.deleted_at) await apiIn(page, 'DELETE', `/api/bookmarks/${b.id}`);
    await apiIn(page, 'DELETE', `/api/bookmarks/${b.id}?permanent=1`);
  }
  const toks = (await apiIn(page, 'GET', '/api/tokens')).data || [];
  for (const t of toks.filter(t => t.name.startsWith('ui-test'))) await apiIn(page, 'DELETE', `/api/tokens/${t.id}`);
}

/* the checks bring their own data, so they pass on any copy: four links in the Inbox and one opened link in a folder,
   all named "ui-test ..." so cleanup removes them (none carries the run's stamp, so the palette checks still find one hit) */
async function seed(page) {
  const f = (await apiIn(page, 'POST', '/api/folders', { name: 'ui-test seed', parent_id: null })).data;
  const opened = (await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test seed opened', url: 'https://ui-test.example/seed/opened', folder_id: f.id })).data;
  await apiIn(page, 'POST', `/api/bookmarks/${opened.id}/open`);
  for (let i = 1; i <= 4; i++) await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test seed inbox ${i}`, url: `https://ui-test.example/seed/inbox-${i}`, folder_id: null });
}

async function login(page) {
  await page.goto(BASE + '/login');
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login')), page.click('button[type=submit]')]);
}

/* window.open is recorded instead of opening a tab */
const RECORD_OPEN = () => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; };

const isMacKey = process.platform === 'darwin' ? 'Meta' : 'Control';
const toastWith = (page, text) => visible(page.locator('#toasts .toast', { hasText: text }));
/* the sidebar actions sit folded behind More; open them before using one */
const openFoot = async page => { const t = page.locator('#side .foot-tog'); if (await t.count() && await t.getAttribute('aria-expanded') !== 'true') { await t.click(); await page.waitForTimeout(300); } };
/* a calm empty state sits in the middle of the space under the title, both ways, and fills that space to the bottom */
async function centred(page, scope) {
  const g = await page.evaluate(sc => { const a = document.querySelector(sc + ' .calm'), c = a.querySelector('.calm-in'), A = a.getBoundingClientRect(), C = c.getBoundingClientRect(), s = getComputedStyle(a);
    const top = A.top + parseFloat(s.paddingTop), bottom = A.bottom - parseFloat(s.paddingBottom);
    return { dx: Math.abs((C.left + C.right) / 2 - (A.left + A.right) / 2), dy: Math.abs((C.top + C.bottom) / 2 - (top + bottom) / 2), fill: A.height - C.height, align: getComputedStyle(c.querySelector('.calm-h')).textAlign }; }, scope);
  assert(g.dx < 2 && g.dy < 2, `not centred: ${g.dx.toFixed(1)} px across, ${g.dy.toFixed(1)} px down`);
  assert(g.fill > 120, 'the empty state does not fill the space under the title');
  assert(g.align === 'center', 'the empty state text is not centred');
}
const sheetOpen = page => visible(page.locator('#layer.open #sheet'));
const sheetClosed = page => until(page, () => !document.querySelector('#layer.open'), null, 'sheet closed');
const menuItem = (page, label) => page.locator('.menu [role^=menuitem]', { hasText: label });
const announced = (page, re, what) => until(page, src => new RegExp(src).test((document.getElementById('announce') || {}).textContent || ''), re.source, 'announced: ' + what);
const focusIn = page => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#sheet'));
/* a long list: a folder of 300 links from an import (more than the 240 a view draws at once), named "ui-test long" and
   removed again with bulk calls, so cleanup does not delete 300 links one by one */
/* the share password rule sits below the field and below the error line, never over them; '' when clear */
const ruleClear = page => page.evaluate(() => { const box = q => { const e = document.querySelector(q); return e ? e.getBoundingClientRect() : null; };
  const rule = box('#sheet #share-pw-rule'), field = box('#sheet form[data-sharepw] input[name=pw]'), err = box('#sheet .share-pwf .fld-err');
  if (!rule || !field) return 'no rule or field';
  if (rule.top < field.bottom - 0.5) return `rule starts ${field.bottom - rule.top} px above the field's bottom edge`;
  if (err && rule.top < err.bottom - 0.5) return `rule starts ${err.bottom - rule.top} px above the error line's bottom`;
  return ''; });
const LONG_N = 300, LONG_CAP = 240;
async function seedLong(page) {
  const id = await page.evaluate(async n => {
    let h = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n<DT><H3>ui-test long</H3>\n<DL><p>\n';
    for (let i = 0; i < n; i++) h += `<DT><A HREF="https://ui-test.example/long/${i}" ADD_DATE="${1700000000 + i}">ui-test long ${i}</A>\n`;
    h += '</DL><p>\n</DL><p>\n';
    const fd = new FormData(); fd.append('file', new Blob([h], { type: 'text/html' }), 'long.html');
    const r = await fetch('/api/import', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' }, body: fd }); if (!r.ok) return null;
    const s = await (await fetch('/api/state', { credentials: 'same-origin' })).json(); const f = s.folders.find(x => x.name === 'ui-test long'); return f ? f.id : null;
  }, LONG_N);
  assert(id, 'the long folder did not import'); return id;
}
async function dropLong(page, id) {
  const s = (await apiIn(page, 'GET', '/api/state')).data, ids = s.bookmarks.filter(b => b.url.startsWith('https://ui-test.example/long/')).map(b => b.id);
  if (ids.length) { await apiIn(page, 'POST', '/api/bookmarks/bulk', { ids, action: 'trash' }); await apiIn(page, 'POST', '/api/bookmarks/bulk', { ids, action: 'delete' }); }
  if (id) await apiIn(page, 'DELETE', `/api/folders/${id}`);
}
/* where the drawn head of a long list meets the first block drawn by Show all: the same gap as between two rows of the head */
const seamGap = (page, sel, cols) => page.evaluate(([sel, cols, cap]) => { const A = [...document.querySelectorAll(sel)].map(a => a.getBoundingClientRect());
  return { head: A[cap - cols].top - A[cap - 2 * cols].bottom, seam: A[cap].top - A[cap - cols].bottom, dx: Math.abs(A[cap].left - A[cap - cols].left) }; }, [sel, cols, LONG_CAP]);
async function tabsStayInSheet(page, n = 10) {
  for (let i = 0; i < n; i++) { await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab'); assert(await focusIn(page), `focus left the sheet after ${i + 1} tabs`); }
}

async function desktop(browser, engine) {
  console.log(`\n${engine}, desktop 1440x900`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(RECORD_OPEN);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let folderId = null;

  await check('login', async () => { await login(page); await visible(page.locator('#side .si')); });

  await check('login with a second factor: the code field shows, Enter in the password moves to it, nothing is sent', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }), p = await c.newPage();
    try {
      /* this instance may run without TOTP_SECRET: the page is served as the server serves it with one */
      await p.route('**/login', async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace('id="login-code" hidden', 'id="login-code"') }); });
      let posts = 0; p.on('request', q => { if (q.method() === 'POST') posts++; });
      await p.goto(BASE + '/login');
      await visible(p.locator('#login-code input[name=code]'));
      assert(await p.locator('#login-code input[name=code]').getAttribute('autocomplete') === 'one-time-code', 'the code field is not a one-time-code field');
      await p.fill('input[name=password]', 'any password'); await p.press('input[name=password]', 'Enter');
      await until(p, () => document.activeElement && document.activeElement.name === 'code', null, 'focus in the code');
      assert(posts === 0, 'the form was sent without the code');
    } finally { await c.close(); }
  });
  await cleanup(page); await seed(page); await page.reload();
  /* a failed check leaves no sheet, menu or palette open for the next one */
  beforeEach = async () => { for (let i = 0; i < 3; i++) { if (!(await page.locator('#layer.open, .menu, #pal').count())) break; await page.keyboard.press('Escape'); await page.waitForTimeout(350); } };

  await check('opens on the Dashboard: first in the nav, one design, recently opened links under day heads, no folder row, Select on screen', async () => {
    await visible(page.locator('#body .gal a[data-open]'));
    assert((await page.textContent('#tbwrap h2')).trim() === 'Dashboard', 'title is not Dashboard');
    assert(await page.getAttribute('#side .nav .si >> nth=0', 'data-view') === 'dashboard', 'Dashboard is not first in the nav');
    assert(await page.getAttribute('#side [data-view="dashboard"]', 'aria-current') === 'true', 'Dashboard not current');
    assert(await page.locator('.hsw, [data-home]').count() === 0, 'a draft switch is still there');
    assert((await page.textContent('#body .gal-h')).trim() === 'Recently opened', 'no Recently opened head');
    assert(await page.locator('#body .ftile').count() === 0, 'folder row on the Dashboard');
    assert(await page.locator('#tbwrap [data-a="select"]').count() === 1, 'no Select on the Dashboard');
    const links = await page.evaluate(() => [...document.querySelectorAll('#body .gal a[data-open]')].every(a => a.target === '_blank' && /noopener/.test(a.rel)));
    assert(links, 'a recents link is not a new tab with noopener');
    /* a bookmarked site is never told where the click came from */
    const leaks = await page.evaluate(() => [...document.querySelectorAll('#app a[data-open]')].filter(a => !/\bnoreferrer\b/.test(a.rel)).length);
    assert(!leaks, `${leaks} bookmark links without noreferrer`);
    const heads = await page.evaluate(() => [...document.querySelectorAll('#body .gal .gs-h')].map(h => h.firstChild.textContent.trim()));
    const ORDER = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'Earlier'];
    assert(heads[0] === 'Today', 'the link opened now is not under Today: ' + heads.join(', '));
    assert(heads.every((h, i) => ORDER.includes(h) && (!i || ORDER.indexOf(h) > ORDER.indexOf(heads[i - 1]))), 'day heads out of order: ' + heads.join(', '));
    assert(await page.evaluate(() => [...document.querySelectorAll('#body .gal .gs')].every(s => s.querySelector('a[data-open]'))), 'an empty day group shows');
    assert(await page.evaluate(() => [...document.querySelectorAll('#body .gal a[data-open]')].every(a => a.closest('article[data-id]') && a.querySelector('.gc-chip .gc-cn').textContent.trim())), 'an item is not a card or does not say its folder');
    const times = await page.evaluate(() => [...document.querySelectorAll('#body .gal time')].map(t => t.textContent));
    const bad = times.filter(t => !/^(Just now|\d+m ago|\d+h ago|\d\d:\d\d|(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)( \d{4})?)$/.test(t));
    assert(!bad.length, 'times not in the fixed form: ' + bad.join(', '));
    await page.click('#tbwrap .vsw [data-layout="list"]');
    await until(page, () => !!document.querySelector('#body .gal.is-list .gs .gc-row'), null, 'list rows under the day heads');
    await page.click('#tbwrap .vsw [data-layout="grid"]');
    await until(page, () => !!document.querySelector('#body .gal:not(.is-list) .gs .gk'), null, 'grid cards under the day heads');
    await page.keyboard.press('s'); await visible(page.locator('#screen.selecting #dbulk .tb.bulk'));
    assert(await page.locator('#body .gal article[data-id] .chk').count() > 0, 'no ticks on the Dashboard cards');
    await page.keyboard.press('Escape'); await gone(page.locator('#screen.selecting'));
    await shot(page, `${engine}-desktop-dashboard`);
  });
  await check('folder chips, the current sidebar folder, the picked folder tile in the pickers and search hits reach 4.5:1, the bulb 3:1, light and dark', async () => {
    const low = await page.evaluate(() => {
      const parse = c => { let m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]]; }
        m = c.match(/color\(srgb ([^)]+)\)/); const p = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] == null ? 1 : p[3]]; };
      const over = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
      const bgOf = el => { const L = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) { L.push(c); if (c[3] >= 1) break; } }
        let b = parse(getComputedStyle(document.documentElement).backgroundColor); for (let i = L.length - 1; i >= 0; i--) b = over(L[i], b); return b; };
      const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
      const ratio = (el, color) => { const bg = bgOf(el), f = parse(color || getComputedStyle(el).color), fg = over([f[0], f[1], f[2], f[3] * +getComputedStyle(el).opacity], bg), x = lum(fg), y = lum(bg); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const out = [], root = document.documentElement, was = root.dataset.theme, host = document.getElementById('body');
      for (const t of ['light', 'dark']) { root.dataset.theme = t;
        for (const h of ['cyan', 'coral', 'lilac', 'lime', 'mint', 'rose', 'tray', 'plain']) {
          const w = document.createElement('div'); w.innerHTML = `<span class="gc-chip hue-${h}"><span class="dot"></span><span class="gc-cn">Folder</span></span><button type="button" class="si hue-${h}" aria-current="true" style="--hp:var(--${h}-p);--h:var(--${h})"><span class="si-n">Folder</span></button><p class="t-host"><mark class="hit">hit</mark></p><div class="fpick"><button type="button" class="fmini hue-${h} fill"><span class="v"><span class="nm"><span class="nt">Folder</span></span></span></button></div><div class="sheet"><div class="fpick"><button type="button" class="fmini hue-${h} fill"><span class="v"><span class="nm"><span class="nt">Folder</span></span></span></button></div></div>`;
          host.prepend(w); const tiles = w.querySelectorAll('.fmini .nt');
          const r = [ratio(w.querySelector('.gc-cn')), ratio(w.querySelector('.si-n')), ratio(w.querySelector('mark')), ratio(tiles[0]), ratio(tiles[1])]; w.remove();
          r.forEach((v, i) => { if (v < 4.5) out.push(`${t} ${h} ${['chip', 'sidebar', 'hit', 'picked tile', 'picked tile in a sheet'][i]} ${v.toFixed(2)}`); }); }
        const b = document.querySelector('.bulb'); if (b) { const cs = getComputedStyle(b); for (const c of [cs.getPropertyValue('--bulb-rim').trim() || cs.color, cs.color]) {
          const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d); const v = ratio(b, getComputedStyle(d).color); d.remove(); if (v < 3) out.push(`${t} bulb ${v.toFixed(2)}`); } } }
      root.dataset.theme = was; return out; });
    assert(!low.length, 'under the contrast needed: ' + low.join(', '));
  });

  await check('1440: selecting keeps the toolbar and every card in place; Select turns into the pressed Done, the bar takes the search\'s place', async () => {
    const boxes = () => page.evaluate(() => [...document.querySelectorAll('#body article[data-id], #tbwrap .tb, #tbwrap .tb > *, #head')]
      .map(e => { const r = e.getBoundingClientRect(); return [e.dataset.id || e.dataset.a || e.tagName, r.x, r.y, r.width, r.height]; }));
    const same = (a, b) => a.length === b.length && a.every((x, i) => x[0] === b[i][0] && [1, 2, 3, 4].every(k => Math.abs(x[k] - b[i][k]) <= 1));
    for (const v of ['dashboard', 'inbox']) {
      await page.click(`#side [data-view="${v}"]`); await until(page, k => (document.querySelector('#tbwrap h2') || {}).textContent === k, v === 'dashboard' ? 'Dashboard' : 'Inbox', v);
      const sel = page.locator('#tbwrap [data-a="select"]'); if (!(await sel.count())) continue;
      const rest = await boxes(); await sel.click(); await visible(page.locator('#dbulk .tb.bulk'));
      assert(same(rest, await boxes()), v + ': the toolbar or a card moved entering selection');
      assert(await sel.getAttribute('aria-pressed') === 'true' && await sel.getAttribute('aria-label') === 'Done', v + ': Select is not the pressed Done');
      await until(page, () => getComputedStyle(document.querySelector('#head .search')).visibility === 'hidden', null, v + ': the search still shows beside the bar');
      assert(!(await page.locator('#dbulk [data-a="sel-done"]').count()), v + ': the selection bar still carries a Done');
      const [bg, add] = await page.evaluate(() => [getComputedStyle(document.querySelector('#tbwrap [data-a="select"]')).backgroundColor, getComputedStyle(document.querySelector('#tbwrap .add')).backgroundColor]);
      assert(bg !== add && /rgba\(255, 255, 255, 0\.08\)/.test(bg), v + ': the pressed Done is not the quiet grey: ' + bg);
      await page.keyboard.press('Escape'); await gone(page.locator('#dbulk .tb.bulk'));
      assert(await sel.getAttribute('aria-pressed') === 'false', v + ': Escape did not end selecting');
      assert(same(rest, await boxes()), v + ': something moved leaving selection by Escape');
      await sel.click(); await visible(page.locator('#dbulk .tb.bulk'));
      await sel.click(); await gone(page.locator('#dbulk .tb.bulk'));
      assert(!(await page.locator('#screen.selecting').count()) && await sel.getAttribute('aria-pressed') === 'false', v + ': the pressed Select did not end selecting');
      await visible(page.locator('#head .search'));
      assert(same(rest, await boxes()), v + ': something moved leaving selection');
    }
    await page.click('#side [data-view="dashboard"]'); await visible(page.locator('#tbwrap .tb.dash'));
  });

  await check('1440: Select, a tick and Done keep the sidebar, the toolbar and every card node', async () => {
    await page.click('#side [data-view="inbox"]'); await visible(page.locator('#body article.tile'));
    await page.evaluate(() => { window.__keep = [...document.querySelectorAll('#side .si, #tbwrap .tb, #tbwrap .tb > *, #body article[data-id], #body article[data-id] img')]; });
    await page.click('#tbwrap [data-a="select"]'); await visible(page.locator('#dbulk .tb.bulk'));
    await page.locator('#body article.tile').nth(0).click(); await until(page, () => document.querySelectorAll('#body article.tile.picked').length === 1, null, 'tick');
    await page.locator('#body article.tile').nth(0).click(); await until(page, () => !document.querySelector('#body article.tile.picked'), null, 'untick');
    await page.click('#tbwrap [data-a="select"]'); await gone(page.locator('#dbulk .tb.bulk'));
    const lost = await page.evaluate(() => __keep.filter(n => !n.isConnected).length);
    assert(!lost, lost + ' nodes were drawn again');
  });
  await check('the Inbox is only the Inbox: its cards, no folder row, no recents', async () => {
    await page.click('#side [data-view="inbox"]');
    await visible(page.locator('#body article.tile[data-id]'));
    assert((await page.textContent('#tbwrap h2')).trim() === 'Inbox', 'title is not Inbox');
    assert(await page.locator('#body .ftile').count() === 0, 'folder row in the Inbox');
    assert(await page.locator('#body .gal').count() === 0, 'recents in the Inbox');
    assert(await page.locator('#tbwrap [data-a="select"], #tbwrap [data-a="sort"], #tbwrap .vsw').count() === 3, 'Select, Sort or the layout switch missing with items');
    await shot(page, `${engine}-desktop-inbox`);
  });

  await check('an empty Inbox says All sorted; with no bookmarks at all, Nothing here yet with Import', async () => {
    const shape = mode => page.route('**/api/state', async r => { const res = await r.fetch(); const j = await res.json();
      if (mode === 'sorted') { const f = j.folders[0]; j.bookmarks.forEach(b => { if (b.folder_id == null) b.folder_id = f.id; }); } else j.bookmarks = [];
      await r.fulfill({ response: res, json: j }); });
    await shape('sorted'); await page.reload(); await page.click('#side [data-view="inbox"]');
    await visible(page.locator('#body .calm .calm-h', { hasText: 'All sorted' }));
    assert((await page.textContent('#body .calm .calm-t')).trim() === 'Nothing waiting in the Inbox.', 'quiet line');
    assert(await page.locator('#body .calm [data-a="add-new"]').count() === 1, 'no Add bookmark');
    assert(await page.locator('#body .calm .pile .pc').count() === 3 && await page.locator('#body .calm .pile .pc-ok').count() === 1, 'no tidy pile picture');
    await centred(page, '#body');
    assert(await page.locator('#tbwrap [data-a="select"], #tbwrap [data-a="sort"], #tbwrap .vsw').count() === 0, 'Select, Sort or the layout switch on an empty Inbox');
    await shot(page, `${engine}-desktop-inbox-empty`);
    await page.unroute('**/api/state'); await shape('fresh'); await page.reload(); await page.click('#side [data-view="inbox"]');
    await visible(page.locator('#body .calm .calm-h', { hasText: 'Nothing here yet' }));
    assert(await page.locator('#body .calm [data-a="import"]').count() === 1, 'no Import');
    await centred(page, '#body');
    assert(await page.locator('#tbwrap [data-a="select"], #tbwrap [data-a="sort"], #tbwrap .vsw').count() === 0, 'controls on a fresh install');
    await page.unroute('**/api/state'); await page.reload(); await visible(page.locator('#side .si'));
  });

  await check('the sidebar actions fold: More opens and closes them, the choice is remembered', async () => {
    const tog = page.locator('#side .foot-tog');
    if (await tog.getAttribute('aria-expanded') === 'true') await tog.click();
    await until(page, () => !document.querySelector('#side .side-foot.open') && getComputedStyle(document.querySelector('#side .foot-in')).visibility === 'hidden', null, 'folded');
    await tog.click();
    await until(page, () => !!document.querySelector('#side .side-foot.open'), null, 'open');
    assert(await page.evaluate(() => localStorage.getItem('pinned.foot') || Object.keys(localStorage).some(k => /foot/.test(k))), 'choice not stored');
  });

  await check('Source link and version at the end of the app menu', async () => {
    await openFoot(page);
    const a = page.locator('#side .side-foot a.si').last();
    assert(await a.getAttribute('href') === SOURCE, 'last item is not Source');
    assert((await a.textContent()).trim() === 'Source', 'label');
    assert(await a.getAttribute('target') === '_blank' && /noopener/.test(await a.getAttribute('rel') || ''), 'not a new tab with noopener');
    await visible(page.locator('#side .side-foot .app-ver'));
    assert(/^Pinned \S+What's new$/.test((await page.textContent('#side .side-foot .app-ver')).trim()), 'version line with What\'s new');
  });

  await check('places: Dashboard, All bookmarks and Inbox in the nav, + beside the Folders head, Trash at the foot above More', async () => {
    const nav = await page.evaluate(() => [...document.querySelectorAll('#side .nav .si')].map(e => e.dataset.view));
    assert(nav.join(',') === 'dashboard,all,inbox', 'nav: ' + nav.join(','));
    assert(await page.locator('#side .side-lbl .side-add[data-a="new-folder"]').count() === 1, 'no + beside Folders');
    assert(await page.locator('#side .side-add.nf-plus > .nf-c').count() === 1, 'the + beside Folders is not the filled circle');
    { const c = await page.locator('#side .side-add .nf-c').boundingBox(), t = await page.evaluate(() => { const r = document.querySelector('#side .side-add').getBoundingClientRect(), a = getComputedStyle(document.querySelector('#side .side-add'), '::after'); return r.width - 2 * parseFloat(a.left); });
      assert(Math.abs(c.width - 28) < 0.5 && Math.abs(c.height - 28) < 0.5, 'the circle is not 28 px'); assert(t > 43.5, 'the + target under 44 px'); }
    const foot = await page.evaluate(() => [...document.querySelector('#side .side-foot').children].map(e => e.dataset.view || e.dataset.a || e.className));
    assert(foot[0] === 'trash' && foot[1] === 'foot', 'foot: ' + foot.join(','));
    assert(!(await page.locator('#side .foot-acts [data-a="new-folder"]').count()), 'New folder still folded under More');
    await page.click('#side .side-foot [data-view="trash"]');
    await until(page, () => (document.querySelector('#tbwrap h2') || {}).textContent === 'Trash', null, 'Trash opens');
    await page.click('#side [data-view="dashboard"]');
  });

  await check('no three dots on the Dashboard or the Inbox; Sort shows the order and opens a menu, Select sits beside it', async () => {
    assert(!(await page.locator('#tbwrap [data-a$="menu"], #tbwrap [aria-label="More"]').count()), 'three dots on the Dashboard');
    assert(await page.locator('#tbwrap .vsw').count() === 1, 'no layout switch on the Dashboard');
    await page.click('#side [data-view="inbox"]'); await visible(page.locator('#body article.tile[data-id]'));
    assert(!(await page.locator('#tbwrap [data-a$="menu"], #tbwrap [aria-label="More"]').count()), 'three dots on the Inbox');
    const sort = page.locator('#tbwrap .sortc[data-a="sort"]');
    assert((await sort.textContent()).trim() === 'Newest', 'sort reads ' + (await sort.textContent()).trim());
    await sort.click(); await visible(page.locator('.menu'));
    assert((await page.locator('.menu [role="menuitemradio"]').allTextContents()).join(',') === 'Newest,A to Z,Last opened,Your order', 'orders');
    await menuItem(page, 'A to Z').click();
    await until(page, () => (document.querySelector('#tbwrap .sortc') || {}).textContent === 'A to Z', null, 'sort reads A to Z');
    await page.click('#tbwrap .sortc'); await menuItem(page, 'Newest').click();
    await until(page, () => (document.querySelector('#tbwrap .sortc') || {}).textContent === 'Newest', null, 'sort back to Newest');
    await visible(page.locator('#tbwrap [data-a="select"]'));
  });

  await check('the Folders screen: All bookmarks first, Trash at the foot, New folder always, its order from two folders on', async () => {
    const tops = async () => ((await apiIn(page, 'GET', '/api/state')).data.folders || []).filter(f => f.parent_id == null).length;
    const toFolders = async () => { await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal.open')); await page.keyboard.type('Folders');
      await visible(page.locator('#pal .pal-view', { hasText: 'Folders' })); await page.locator('#pal .pal-view', { hasText: 'Folders' }).first().click();
      await until(page, () => (document.querySelector('#tbwrap h2') || {}).textContent === 'Folders', null, 'Folders screen'); };
    await toFolders();
    assert(await page.locator('#tbwrap [data-a="new-folder"]').count() === 1, 'New folder missing');
    assert(await page.locator('#tbwrap [data-a="fsort"]').count() === (await tops() > 1 ? 1 : 0), 'the folder order shows with one folder or hides with two');
    const made = []; for (const x of ['a', 'b']) made.push((await apiIn(page, 'POST', '/api/folders', { name: `ui-test fsort ${x}`, parent_id: null })).data.id);
    await page.reload(); await visible(page.locator('#side .si')); await toFolders();
    assert(await page.getAttribute('#body .fscreen > .ftile >> nth=0', 'data-view') === 'all', 'All bookmarks is not the first card');
    assert(/^All bookmarks, \d+$/.test(await page.locator('#body .fscreen > .ftile').first().evaluate(e => e.querySelector('.ft-t').textContent + e.querySelector('.vh').textContent)), 'All bookmarks has no count');
    assert(/^Trash, \d+$/.test(await page.locator('#body .ftrash').evaluate(e => e.querySelector('.ftrash-n').textContent + e.querySelector('.vh').textContent)), 'no Trash row with its count');
    assert(await page.locator('#tbwrap [data-a="new-folder"]').count() === 1 && await page.locator('#tbwrap [data-a="fsort"]').count() === 1, 'New folder or the folder order missing with two folders');
    assert(!(await page.locator('#tbwrap [data-a$="menu"]').count()), 'three dots on the Folders screen');
    await page.click('#tbwrap [data-a="fsort"]'); await menuItem(page, 'A to Z').click();
    await until(page, () => { const n = [...document.querySelectorAll('#body .fscreen .ftile[data-ftile] .ft-t')].map(e => e.textContent); return n.length > 1 && n.every((x, i) => !i || n[i - 1].localeCompare(x, undefined, { sensitivity: 'base' }) <= 0); }, null, 'folders A to Z');
    await page.click('#tbwrap [data-a="fsort"]'); await menuItem(page, 'Your order').click();
    await until(page, () => (document.querySelector('#tbwrap .sortc') || {}).textContent === 'Your order', null, 'back to Your order');
    await page.click('#body .fscreen > .ftile[data-view="all"]');
    await until(page, () => (document.querySelector('#tbwrap h2') || {}).textContent === 'All bookmarks', null, 'All bookmarks opens');
    await visible(page.locator('#tbwrap [data-a="sort"]')); await visible(page.locator('#tbwrap [data-a="select"]'));
    for (const id of made) await apiIn(page, 'DELETE', `/api/folders/${id}`);
    await page.reload(); await visible(page.locator('#side .si'));
  });

  await check('in between widths: the sidebar folds to an icon rail from 720 to 999 px, names on focus, nothing scrolls sideways', async () => {
    await page.click('#side [data-view="inbox"]'); await visible(page.locator('#body article.tile[data-id]'));
    for (const w of [768, 900, 1024, 1280]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250);
      const g = await page.evaluate(() => ({ side: document.getElementById('side').getBoundingClientRect().width, over: document.documentElement.scrollWidth > innerWidth || document.getElementById('content').scrollWidth > document.getElementById('content').clientWidth,
        ctl: [...document.querySelectorAll('#tbwrap [data-a="sort"], #tbwrap [data-a="select"], #tbwrap .add')].every(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth; }) }));
      assert(w < 1000 ? g.side <= 80 : g.side >= 200, `${w}: sidebar ${g.side} px`);
      assert(!g.over, `${w}: scrolls sideways`); assert(g.ctl, `${w}: a title bar control is off screen`);
      /* WebKit tabs only to text fields by default, so there the name is checked on hover */
      if (w === 900 && engine === 'webkit') { await page.hover('#side .nav [data-view="all"]');
        await until(page, () => { const t = document.querySelector('.tip'); return t && !t.hidden && t.textContent === 'All bookmarks'; }, null, 'the name beside the rail icon on hover'); await page.mouse.move(600, 5); }
      else if (w === 900) { await page.focus('#side .nav [data-view="dashboard"]'); await page.keyboard.press('Tab'); /* from the row above, so it is keyboard focus */
        await until(page, () => { const t = document.querySelector('.tip'), a = document.activeElement, n = a && a.closest('#side') && (a.querySelector('.si-n') || {}).textContent;
          return t && !t.hidden && !!n && t.textContent === n; }, null, 'the name beside the rail icon'); }
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250);
  });

  await check('768: What\'s new stays in the folded rail under More and opens the releases; the full sidebar keeps the version line instead', async () => {
    await page.setViewportSize({ width: 768, height: 900 }); await page.waitForTimeout(250);
    await openFoot(page);
    const it = page.locator('#side .rail-only[data-a="releases"]'); await visible(it);
    await it.click(); await sheetOpen(page);
    await until(page, () => (window.Pinned.L.sheet || {}).type === 'releases', null, 'the releases sheet');
    await page.keyboard.press('Escape'); await sheetClosed(page);
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250);
    assert(!(await it.isVisible()), 'the rail item shows in the full sidebar');
  });

  await check('new folder from the + beside the Folders head', async () => {
    await page.click('#side .side-add'); await sheetOpen(page);
    await page.fill('#sheet input[name=v]', T.folder); await page.keyboard.press('Enter');
    await until(page, n => (document.querySelector('#tbwrap h2') || {}).textContent === n, T.folder, 'folder view');
    folderId = await page.evaluate(n => { const f = window.Pinned.D.folders.find(x => x.name === n); return f && f.id; }, T.folder);
    assert(folderId, 'folder not in state');
  });

  await check('add a bookmark through the Add sheet', async () => {
    await page.click('#tbwrap .add'); await sheetOpen(page);
    await page.fill('#sheet [data-f=title]', T.title);
    await page.fill('#sheet [data-f=url]', T.url);
    await shot(page, `${engine}-desktop-save-sheet`);
    await page.click('#sheet [data-a="save-go"]'); await sheetClosed(page);
    await visible(page.locator('#body article .t-title', { hasText: T.title }));
    await announced(page, /^Saved in /, 'saved');
  });

  await check('Tab in the Add sheet moves through its controls: Title, URL and Save are reached, Shift Tab goes back', async () => {
    await page.click('#tbwrap .add'); await sheetOpen(page);
    const at = () => page.evaluate(() => { const a = document.activeElement; return a.dataset.f || a.dataset.a || a.getAttribute('aria-label') || a.tagName; });
    const seen = [];
    for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); seen.push(await at()); assert(await focusIn(page), 'focus left the sheet'); }
    for (const k of ['title', 'url', 'save-go']) assert(seen.includes(k), `Tab never reached ${k}: ${seen.join(',')}`);
    const fwd = await at(); await page.keyboard.press('Shift+Tab'); assert(await at() !== fwd, 'Shift Tab stays on ' + fwd);
    await page.keyboard.press('Escape'); await sheetClosed(page);
  });

  const menuLabels = async () => (await page.locator('.menu [role="menuitem"]').allTextContents()).map(x => x.trim()).join(',');
  await check('right click on a card: Move, Copy, Share and Trash, then Open, Rename and Pin, as the selection bar and its More; the three dots on a card show the same', async () => {
    await page.click('#side [data-view="inbox"]'); await visible(page.locator('#body article.tile[data-id]'));
    const card = page.locator('#body article.tile[data-id]').first();
    await card.locator('.t-title').click({ button: 'right' }); await visible(page.locator('.menu'));
    const labels = await menuLabels();
    assert(/^Move,Copy,Share,Trash,Open,Rename,(Pin|Unpin)$/.test(labels), 'right click menu: ' + labels);
    assert(await page.locator('.menu hr').count() === 1, 'the bar actions and the More actions are not split');
    await shot(page, `${engine}-desktop-right-click`);
    await page.keyboard.press('Escape'); await gone(page.locator('.menu'));
    await card.hover(); await card.locator('[data-a="more"]').click(); await visible(page.locator('.menu'));
    assert(await menuLabels() === labels, 'the three dots on the card differ: ' + await menuLabels());
    await page.keyboard.press('Escape'); await gone(page.locator('.menu'));
  });

  await check('Shift click starts selecting with the bar; its three dots hold Open, Rename and Pin for one card, Pin or Unpin for several; Cmd click opens a new tab', async () => {
    const cards = page.locator('#body article.tile[data-id]');
    await cards.nth(0).locator('.t-title').click({ modifiers: ['Shift'] });
    await visible(page.locator('#dbulk .tb.bulk'));
    assert((await page.textContent('#dbulk .tb.bulk .n')).trim().startsWith('1'), 'the bar does not count 1');
    await page.click('#dbulk [data-a="sel-more"]'); await visible(page.locator('.menu'));
    assert(/^Open,Rename,(Pin|Unpin)$/.test(await menuLabels()), 'one card: ' + await menuLabels());
    await shot(page, `${engine}-desktop-bar-more`);
    await page.keyboard.press('Escape'); await gone(page.locator('.menu'));
    await cards.nth(1).locator('.t-title').click();
    assert((await page.textContent('#dbulk .tb.bulk .n')).trim().startsWith('2'), 'a click did not add the second card');
    await page.click('#dbulk [data-a="sel-more"]'); await visible(page.locator('.menu'));
    assert(/^(Pin|Unpin)$/.test(await menuLabels()), 'two cards: ' + await menuLabels());
    await page.keyboard.press('Escape'); await gone(page.locator('.menu'));
    await cards.nth(1).locator('.t-title').click();
    await page.click('#dbulk [data-a="sel-more"]'); await menuItem(page, 'Rename').click();
    await visible(page.locator('#body [data-rename]'));
    assert(!(await page.locator('#screen.selecting').count()), 'still selecting after Rename');
    await page.keyboard.press('Escape'); await gone(page.locator('#body [data-rename]'));
    const before = ctx.pages().length;
    await cards.nth(0).locator('.t-title').click({ modifiers: ['ControlOrMeta'] }); await page.waitForTimeout(400);
    assert(!(await page.locator('#screen.selecting').count()), 'Cmd click started selecting');
    for (const p of ctx.pages().slice(before)) await p.close();
  });

  await check('the search field opens the palette, typing narrows it, Escape closes it', async () => {
    assert(!(await page.locator('#scope, .head [data-view]').count()), 'All or Recent pills beside the search, places twice');
    await page.click('#side [data-view="all"]');
    await until(page, () => document.querySelectorAll('#body article.tile[data-id]').length > 1, null, 'All grid');
    await page.click('#q');
    await until(page, () => !!document.querySelector('#pal.open') && document.activeElement.id === 'pq', null, 'palette open from the field');
    await page.keyboard.type(stamp);
    await until(page, () => document.querySelectorAll('#pal .pal-it').length === 1, null, 'one result in the palette');
    assert(!(await page.locator('[aria-live]:not(#announce)').count()), 'a live region other than #announce');
    await visible(page.locator('#pal .pal-it', { hasText: T.title }));
    assert(/\bnoreferrer\b/.test(await page.locator('#pal .pal-it', { hasText: T.title }).getAttribute('rel')), 'a search result link without noreferrer');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(page, () => !document.querySelector('#pal'), null, 'palette closed');
    await page.click('#side [data-view="inbox"]');
  });

  await check('the palette shows Recent with no query; a typed query with no hit shows only No matches, Escape brings Recent back', async () => {
    await page.click('#q'); await visible(page.locator('#pal.open #pal-rec .pal-recent'));
    await page.keyboard.type('zq-no-such-link-' + stamp);
    await visible(page.locator('#pal-list .pal-none', { hasText: 'No matches.' })); await gone(page.locator('#pal-rec'));
    await page.keyboard.press('Escape'); await visible(page.locator('#pal-rec .pal-recent'));
    await page.keyboard.press('Escape'); await until(page, () => !document.querySelector('#pal'), null, 'palette closed');
  });

  await check('Tab goes on past the search field: the palette it opens steps aside for Tab and Shift Tab, Escape leaves focus in the field', async () => {
    await page.click('#side [data-view="inbox"]'); await visible(page.locator('#body article.tile[data-id]'));
    const palOn = what => until(page, () => !!document.querySelector('#pal.open') && document.activeElement.id === 'pq', null, what);
    const palOff = what => until(page, () => !document.querySelector('#pal'), null, what);
    const where = () => page.evaluate(() => { const a = document.activeElement; return { id: a.id, main: !!a.closest('#content'), side: !!a.closest('#side'), label: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 20) }; });
    const toQ = () => page.evaluate(() => { document.activeElement.blur(); document.getElementById('q').focus(); });
    await toQ(); await palOn('palette open from focus in the field');
    await page.keyboard.press('Tab'); await palOff('palette closed by Tab');
    let w = await where(); assert(w.main && w.id !== 'q', 'Tab did not move past the search: ' + JSON.stringify(w));
    await toQ(); await palOn('palette open again');
    await page.keyboard.press('Shift+Tab'); await palOff('palette closed by Shift Tab');
    w = await where(); assert(w.side, 'Shift Tab did not move to the sidebar: ' + JSON.stringify(w));
    await toQ(); await palOn('palette open for Escape');
    await page.keyboard.press('Escape'); await palOff('palette closed by Escape');
    await page.waitForTimeout(200);
    assert(await page.evaluate(() => document.activeElement.id === 'q' && !document.querySelector('#pal')), 'Escape did not leave focus in the search field, or the palette came back');
    await page.keyboard.press('Enter'); await palOn('Enter in the field opens the palette');
    await page.keyboard.press('Escape'); await palOff('palette closed');
    await page.keyboard.press('Escape'); /* out of the field */
  });

  await check('Cmd K palette: grouped results, Enter opens, Escape closes', async () => {
    await page.locator('body').click({ position: { x: 700, y: 5 } }).catch(() => {});
    await page.keyboard.press('ControlOrMeta+k');
    await visible(page.locator('#pal.open .pal-panel'));
    await page.keyboard.type(stamp);
    await visible(page.locator('#pal-list .pal-grp .pal-lbl', { hasText: T.folder }));
    await visible(page.locator('#pal-list .pal-it[aria-selected="true"]', { hasText: T.title }));
    await announced(page, /^1 result$/, 'palette result count');
    await shot(page, `${engine}-desktop-palette`);
    await page.keyboard.press('Enter');
    await until(page, u => (window.__opened || []).includes(u), T.url, 'window.open with the bookmark');
    await gone(page.locator('#pal'));
    await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal.open'));
    await page.keyboard.press('Escape'); await gone(page.locator('#pal'));
  });

  await check('Finder selection: Shift click takes a range, a click on empty space clears', async () => {
    const tiles = page.locator('#body article.tile[data-id]');
    await visible(tiles);
    assert(await tiles.count() >= 4, 'fewer than 4 tiles in Inbox');
    await tiles.nth(0).click({ modifiers: ['Shift'] });
    await tiles.nth(3).click({ modifiers: ['Shift'] });
    await until(page, () => document.querySelectorAll('#body article.tile.picked').length === 4, null, '4 picked');
    assert((await page.textContent('#dbulk .bulk .n')).trim().startsWith('4'), 'bulk bar does not say 4');
    for (const a of ['sel-all', 'bulk-copy', 'bulk-move', 'bulk-trash']) assert(await page.locator(`#dbulk .bulk [data-a="${a}"]:not([disabled])`).count() === 1, a + ' missing from the selection bar');
    assert(!(await page.locator('#dbulk .bulk button', { hasText: 'Done' }).count()), 'the selection bar still carries a Done');
    await page.click('#dbulk .bulk [data-a="bulk-copy"]');
    await visible(page.locator('#toasts .toast', { hasText: /links copied|Could not copy/ }));
    await page.locator('#body .glbl').first().click();
    await until(page, () => !document.querySelector('#body article.tile.picked') && !document.querySelector('#dbulk .bulk'), null, 'selection cleared');
  });

  await check('S starts and ends selecting', async () => {
    await page.locator('#body .glbl').first().click();
    await page.keyboard.press('s');
    await until(page, () => !!document.querySelector('#screen.selecting'), null, 'selecting');
    await page.keyboard.press('s');
    await until(page, () => !document.querySelector('#screen.selecting'), null, 'not selecting');
  });

  await check('N opens New folder; not with Shift or while typing, not in Trash', async () => {
    const nf = async () => { await sheetOpen(page); assert(await page.locator('#sheet input[name=v]').count() === 1 && (await page.textContent('#sheet')).includes('New folder'), 'not the New folder sheet');
      await page.keyboard.press('Escape'); await sheetClosed(page); };
    await page.locator('#body .glbl').first().click();
    await page.keyboard.press('n'); await nf();
    await page.keyboard.press('Shift+N'); await page.waitForTimeout(300); assert(!(await page.locator('#layer.open').count()), 'Shift N opened a sheet');
    await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal.open')); await page.keyboard.press('n'); await page.waitForTimeout(300);
    assert(!(await page.locator('#layer.open').count()) && await page.inputValue('#pq') === 'n', 'N in the palette field did not type');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await gone(page.locator('#pal'));
    await page.click('#side [data-view="trash"]'); await page.locator('#body .glbl, #body .empty, #tbwrap h2').first().click().catch(() => {});
    await page.keyboard.press('n'); await page.waitForTimeout(300); assert(!(await page.locator('#layer.open').count()), 'N opened a sheet in Trash');
    await page.click('#side [data-view="inbox"]'); await visible(page.locator('#body article.tile[data-id]'));
  });

  await check('palette: New folder is an action, Enter and a click both open its sheet', async () => {
    await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal.open')); await page.keyboard.type('new fol');
    await visible(page.locator('#pal .pal-act[data-act="new-folder"]', { hasText: 'New folder' }));
    await page.keyboard.press('Enter'); await gone(page.locator('#pal')); await sheetOpen(page);
    assert((await page.textContent('#sheet')).includes('New folder'), 'Enter: not the New folder sheet'); await page.keyboard.press('Escape'); await sheetClosed(page);
    await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal.open')); await page.keyboard.type('new fol');
    await page.locator('#pal .pal-act[data-act="new-folder"]').click(); await gone(page.locator('#pal')); await sheetOpen(page);
    assert((await page.textContent('#sheet')).includes('New folder'), 'click: not the New folder sheet'); await page.keyboard.press('Escape'); await sheetClosed(page);
  });

  /* Raycast style actions on a result: Cmd K again or the Right arrow at the end of the field */
  const palFind = async q => { await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal.open')); await page.keyboard.type(q);
    await visible(page.locator('#pal-list .pal-it[data-open][aria-selected="true"]')); };
  const palActs = async () => { await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal-acts')); };
  const actSel = () => page.evaluate(() => { const s = document.querySelector('#pal-acts [aria-selected="true"]'); return s ? s.textContent.trim() : ''; });
  await check('palette actions: Cmd K on a result lists them with Open first, the field points at the highlighted one, Escape and Left go back', async () => {
    await palFind(stamp); await palActs();
    const labels = (await page.locator('#pal-acts [role=option]').allTextContents()).map(x => x.trim());
    assert(labels.join(',') === 'Open,Pin,Move to folder,Rename,Copy link,Move to Trash', 'actions: ' + labels.join(','));
    assert(await actSel() === 'Open', 'Open is not preselected');
    assert(await page.getAttribute('#pal-acts', 'role') === 'listbox' && await page.getAttribute('#pq', 'aria-activedescendant') === 'pal-a-0', 'the field does not point at the action');
    assert(await page.evaluate(() => document.activeElement.id === 'pq'), 'focus left the field');
    await page.keyboard.press('ArrowDown'); assert(await actSel() === 'Pin', 'ArrowDown did not move to Pin');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); assert(await actSel() === 'Move to Trash', 'ArrowUp did not wrap to the last');
    await shot(page, `${engine}-desktop-palette-actions`);
    await page.keyboard.press('Escape'); await gone(page.locator('#pal-acts'));
    assert(await page.locator('#pal.open').count() === 1 && await page.inputValue('#pq') === stamp, 'Escape left the results');
    await page.keyboard.press('ArrowRight'); await visible(page.locator('#pal-acts'));
    await page.keyboard.press('ArrowLeft'); await gone(page.locator('#pal-acts'));
    await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal-acts')); await page.keyboard.press('ControlOrMeta+k'); await gone(page.locator('#pal-acts'));
    /* Right arrow with the caret inside the text moves the caret, nothing opens */
    await page.evaluate(() => document.getElementById('pq').setSelectionRange(0, 0)); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150); assert(!(await page.locator('#pal-acts').count()), 'Right arrow mid text opened the actions');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await gone(page.locator('#pal'));
  });
  await check('palette actions: Pin, Copy link, Move to folder and Rename run as their menu items do', async () => {
    const b = (await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.url === T.url);
    await palFind(stamp); await palActs(); await page.keyboard.press('p'); assert(await actSel() === 'Pin', 'type-ahead p');
    await page.keyboard.press('Enter'); await gone(page.locator('#pal'));
    await page.waitForTimeout(400);
    assert((await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === b.id).pinned, 'Pin did not pin');
    await palFind(stamp); await palActs(); assert((await page.locator('#pal-acts [role=option]').nth(1).textContent()).trim() === 'Unpin', 'a pinned link offers Pin');
    await page.keyboard.press('u'); await page.keyboard.press('Enter'); await gone(page.locator('#pal')); await page.waitForTimeout(400);
    assert(!(await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === b.id).pinned, 'Unpin did not unpin');
    await palFind(stamp); await palActs(); await page.keyboard.press('c'); assert(await actSel() === 'Copy link', 'type-ahead c');
    await page.keyboard.press('Enter'); await visible(page.locator('#toasts .toast', { hasText: /Copied|Could not copy/ }));
    await palFind(stamp); await palActs(); await page.keyboard.press('m'); await page.keyboard.press('Enter'); await gone(page.locator('#pal')); await sheetOpen(page);
    assert(await page.locator('#sheet .sh-lbl', { hasText: 'Folder' }).count() === 1, 'Move to folder: not the move sheet'); await page.keyboard.press('Escape'); await sheetClosed(page);
    await palFind(stamp); await palActs(); await page.keyboard.press('r'); await page.keyboard.press('Enter'); await gone(page.locator('#pal'));
    await until(page, id => !!document.querySelector(`[data-rename="${id}"]`) || !!document.querySelector('#layer.open #sheet input[name=v]'), b.id, 'a rename field');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert((await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === b.id).title === T.title, 'Escape renamed it');
  });
  await check('palette actions: Move to Trash with a click, Undo in the toast; a view row has no actions', async () => {
    const t = (await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test paltrash ${stamp}`, url: `https://ui-test.example/${stamp}/paltrash`, folder_id: null })).data; await page.reload(); await visible(page.locator('#side .si'));
    await palFind('paltrash'); await palActs(); await page.locator('#pal-acts [role=option]', { hasText: 'Move to Trash' }).click(); await gone(page.locator('#pal'));
    await toastWith(page, 'Moved to Trash');
    assert((await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === t.id).deleted_at, 'not in Trash');
    await apiIn(page, 'DELETE', `/api/bookmarks/${t.id}?permanent=1`);
    await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal.open')); await page.keyboard.type('inbox');
    await visible(page.locator('#pal .pal-view[aria-selected="true"]')); await page.keyboard.press('ControlOrMeta+k'); await page.waitForTimeout(200);
    assert(!(await page.locator('#pal-acts').count()), 'a view row opened actions');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await gone(page.locator('#pal'));
  });

  await check('How to save: the page, its sidebar link, and "a token" opens the app with API tokens open', async () => {
    await openFoot(page); await visible(page.locator('#side a.si[href="/bookmarklet"]', { hasText: 'How to save' }));
    await page.goto(BASE + '/bookmarklet');
    assert(await page.title() === 'How to save' && (await page.textContent('h1')).trim() === 'How to save', 'the page is not How to save');
    assert(!(await page.locator('body', { hasText: 'Save button' }).count()), 'the page still says Save button');
    assert((await page.textContent('[data-bm-code]')).includes('height=544'), 'the bookmarklet window is not 544 tall');
    await shot(page, `${engine}-desktop-how-to-save`);
    await page.click('#t-ext'); await page.locator('.bm-page a', { hasText: 'a token' }).click();
    await page.waitForURL(u => u.pathname === '/'); await sheetOpen(page);
    await visible(page.locator('#sheet .at-title', { hasText: 'API tokens' }));
    assert(await page.evaluate(() => location.hash === ''), 'the #tokens hash stayed');
    await page.keyboard.press('Escape'); await sheetClosed(page);
    await page.reload(); await visible(page.locator('#side .si')); await page.waitForTimeout(400);
    assert(!(await page.locator('#layer.open').count()), 'the tokens sheet opened again on reload');
    await page.click('#side [data-view="inbox"]'); await visible(page.locator('#body article.tile[data-id]'));
  });

  await check('share page: no matches is an empty state with Clear search; inside a subfolder it names it and offers the whole folder', async () => {
    const f = (await apiIn(page, 'POST', '/api/folders', { name: `ui-test share ${stamp}`, parent_id: null })).data;
    const sub = (await apiIn(page, 'POST', '/api/folders', { name: 'ui-test sub', parent_id: f.id })).data;
    await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test share zebra', url: `https://ui-test.example/${stamp}/zebra`, folder_id: f.id });
    await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test share alpha', url: `https://ui-test.example/${stamp}/alpha`, folder_id: sub.id });
    const sh = (await apiIn(page, 'POST', `/api/folders/${f.id}/share`, {})).data;
    const url = sh.url || (await apiIn(page, 'GET', '/api/state')).data.folders.find(x => x.id === f.id).share.url;
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, locale: 'en-US' }), sp = await c.newPage();
      await sp.goto(url); await visible(sp.locator('#sq'));
      await sp.fill('#sq', 'nomatchxyz'); await visible(sp.locator('#sbody .calm.nm'));
      assert((await sp.textContent('#sbody .calm-h')).includes('Nothing matches') && (await sp.textContent('#sbody .calm-t')).includes(`in ui-test share ${stamp}`), 'the empty state does not say what was searched');
      await shot(sp, `${engine}-${w}-share-empty`);
      await sp.click('#sbody [data-clear]'); await visible(sp.locator('#sbody article'));
      assert(await sp.inputValue('#sq') === '', 'Clear search left the query');
      await sp.click('[data-sv]:has-text("ui-test sub")'); await sp.fill('#sq', 'zebra'); await visible(sp.locator('#sbody .calm.nm'));
      assert((await sp.textContent('#sbody .calm-t')).includes('in ui-test sub'), 'the message does not name the subfolder');
      await sp.click('#sbody .em-a[data-sv="all"]'); await visible(sp.locator('#sbody article', { hasText: 'ui-test share zebra' }));
      await c.close();
    }
    await apiIn(page, 'DELETE', `/api/folders/${f.id}`);
  });

  await check('share page: the token stays in the fragment, a password share opens with no console error, light and dark follow the system, the old link form still opens', async () => {
    const f = (await apiIn(page, 'POST', '/api/folders', { name: `ui-test pwshare ${stamp}`, parent_id: null })).data;
    await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test pwshare link', url: `https://ui-test.example/${stamp}/pw`, folder_id: f.id });
    const sh = (await apiIn(page, 'POST', `/api/folders/${f.id}/share`, { password: 'ui-test-share-pw' })).data;
    assert(sh.url.includes('/s/#' + sh.token), 'the link does not keep the token in the fragment: ' + sh.url);
    for (const scheme of ['light', 'dark']) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: scheme }), sp = await c.newPage();
      const errs = [], paths = [];
      sp.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); sp.on('pageerror', e => errs.push(e.message));
      sp.on('request', r => { const u = new URL(r.url()); paths.push(u.pathname + u.search); });
      await sp.goto(sh.url); await visible(sp.locator('#unlock input[name=password]'));
      assert(await sp.evaluate(() => document.documentElement.dataset.theme) === scheme, `the share page is not ${scheme}`);
      /* the footer reads at 4.5:1 or more on the page ground */
      const ratio = await sp.evaluate(() => { const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = c => { const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        let el = document.body, bg = 'rgba(0, 0, 0, 0)'; while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(el).backgroundColor; el = el.parentElement; }
        const a = lum(rgb(getComputedStyle(document.querySelector('.share-foot')).color)), b = lum(rgb(bg)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });
      assert(ratio >= 4.5, `share footer contrast ${ratio.toFixed(2)}:1 in ${scheme}`);
      await sp.fill('#unlock input[name=password]', 'ui-test-share-pw'); await sp.press('#unlock input[name=password]', 'Enter');
      await visible(sp.locator('#sbody article', { hasText: 'ui-test pwshare link' }));
      assert(await sp.locator('#sbody a[target=_blank]:not([rel~=noreferrer])').count() === 0, 'a bookmark link on the share page sends a referrer');
      assert(await sp.locator('main').count() === 1, 'the open share page has no single main landmark');
      assert(!paths.some(p => p.includes(sh.token)), 'the token went into a request path: ' + paths.find(p => p.includes(sh.token)));
      await sp.goto(`${BASE}/s/${sh.token}`); await visible(sp.locator('#sbody article', { hasText: 'ui-test pwshare link' }));
      assert(errs.length === 0, 'console errors: ' + errs.join(' | '));
      await c.close();
    }
    await apiIn(page, 'DELETE', `/api/folders/${f.id}`);
  });

  /* audit F-96: every heading, the share footer and the search sit inside a landmark (axe rule region) */
  const outsideLandmarks = p => p.evaluate(() => { const lm = 'main,header,footer,nav,aside,[role=search],[role=dialog],[role=banner],[role=contentinfo],[role=main],[role=navigation],[role=region],[role=complementary],[role=status]';
    return [...document.querySelectorAll('h1,h2,h3,.share-foot,input[type=search],label.ps,label.search')].filter(el => !el.closest(lm) && !el.closest('[hidden],[aria-hidden=true]')).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : '')); });
  await check('landmarks: headings, the share footer and the search sit inside a landmark, app, save and share at 1440 and 390', async () => {
    const f = (await apiIn(page, 'POST', '/api/folders', { name: `ui-test landmark ${stamp}`, parent_id: null })).data;
    await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test landmark link', url: `https://ui-test.example/${stamp}/lm`, folder_id: f.id });
    const sh = (await apiIn(page, 'POST', `/api/folders/${f.id}/share`, {})).data;
    for (const w of [1440, 390]) {
      const c = await browser.newContext({ viewport: { width: w, height: w > 700 ? 900 : 844 }, storageState: await page.context().storageState() }), p = await c.newPage();
      await p.goto(BASE + '/'); await p.waitForSelector(w > 700 ? '#side .si' : '#pmain');
      let bad = await outsideLandmarks(p); assert(bad.length === 0, `${w} app: outside landmarks: ${bad.join(', ')}`);
      await p.goto(BASE + '/save?url=' + encodeURIComponent('https://ui-test.example/lm-save') + '&title=lm'); await p.waitForSelector('#sheet');
      bad = await outsideLandmarks(p); assert(bad.length === 0, `${w} save: outside landmarks: ${bad.join(', ')}`);
      await p.goto(sh.url); await visible(p.locator('#sbody article', { hasText: 'ui-test landmark link' }));
      bad = await outsideLandmarks(p); assert(bad.length === 0, `${w} share: outside landmarks: ${bad.join(', ')}`);
      await c.close();
    }
    await apiIn(page, 'DELETE', `/api/folders/${f.id}`);
  });

  await check('save page in a popup sized window: the panel is the window, Save draws the tick, a short fade, then Saved in place', async () => {
    /* dark: the graphite gradient is the dark panel's; in light the panel is plain paper */
    const c = await browser.newContext({ viewport: { width: 392, height: 544 }, locale: 'en-US', colorScheme: 'dark' }); await c.addCookies(await ctx.cookies());
    const sp = await c.newPage(); const u = `https://ui-test.example/${stamp}/popup`;
    await sp.goto(`${BASE}/save?url=${encodeURIComponent(u)}&title=${encodeURIComponent('ui-test popup ' + stamp)}`);
    await visible(sp.locator('#layer.open #sheet [data-f=title]')); await sp.waitForTimeout(1300);
    const g = await sp.evaluate(() => { const s = document.getElementById('sheet'), r = s.getBoundingClientRect(), cs = getComputedStyle(s), gr = s.querySelector('.grab');
      return { top: r.top, radius: cs.borderTopLeftRadius, grab: gr ? getComputedStyle(gr).display : 'none', bg: cs.backgroundImage }; });
    assert(g.top === 0 && g.radius === '0px' && g.grab === 'none', 'the panel is not the window: ' + JSON.stringify(g));
    assert(/gradient/.test(g.bg), 'no gradient');
    await shot(sp, `${engine}-popup-save-panel`);
    await sp.evaluate(() => { const s = document.getElementById('sheet'); window.__sv = {}; new MutationObserver(() => { for (const k of ['saved', 'leaving']) if (s.classList.contains(k) && !window.__sv[k]) window.__sv[k] = performance.now(); }).observe(s, { attributes: true, attributeFilter: ['class'] }); });
    await sp.click('#sheet [data-a="save-go"]');
    await visible(sp.locator('#sheet.saved [aria-label="Saved"] .tick-draw'));
    assert(await sp.evaluate(() => getComputedStyle(document.querySelector('#sheet .tick-draw path')).animationDuration) === '0.2s', 'the tick does not draw over 200 ms');
    await until(sp, () => window.__sv.leaving, null, 'the sheet fading out');
    const held = await sp.evaluate(() => window.__sv.leaving - window.__sv.saved); assert(held > 480 && held < 700, 'the hold before the fade is not about 520 ms: ' + Math.round(held)); assert(!(await sp.locator('#sheet .tack').count()), 'the pin is back on the favicon');
    /* the save window closes itself after the fade; Chromium and WebKit refuse a window the page did not open and
       show Saved in place, Firefox under Playwright lets it close, as a real popup from the bookmarklet does */
    await Promise.race([sp.waitForEvent('close', { timeout: 8000 }).catch(() => {}), sp.locator('#sheet .done-state').waitFor({ timeout: 8000 }).catch(() => {})]);
    assert(sp.isClosed() || await sp.locator('#sheet .done-state').count() === 1, 'neither closed nor Saved in place');
    const b = (await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.url === u && !x.deleted_at);
    assert(b, 'not saved'); await apiIn(page, 'DELETE', `/api/bookmarks/${b.id}?permanent=1`);
    await c.close();
  });

  await check('share sheet from a folder menu at 1280: link, password, expiry; the password rule clear of the field and the error', async () => {
    await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(250);
    const ft = page.locator(`#side .sf[data-fid="${folderId}"]`);
    await ft.click({ button: 'right' });
    await menuItem(page, 'Share').first().click(); await sheetOpen(page);
    const sw = page.locator('#sheet [data-a="share-toggle"]');
    assert(await sw.getAttribute('aria-checked') === 'false', 'link already on');
    await sw.click();
    await until(page, () => /\/s\//.test((document.getElementById('share-url') || {}).value || ''), null, 'share link');
    await announced(page, /^Sharing on$/, 'sharing on');
    await page.click('#sheet [data-a="share-lock"]');
    const pw = page.locator('#sheet form[data-sharepw] input[name=pw]'); await visible(pw);
    await visible(page.locator('#sheet #share-pw-rule', { hasText: 'Use at least 8 characters.' }));
    assert(await pw.getAttribute('aria-describedby') === 'share-pw-rule', 'the password rule is not tied to the field');
    await pw.fill('short1'); await pw.press('Enter');
    await visible(page.locator('#sheet .share-pwf .fld-err', { hasText: 'at least 8' }));
    { const r = await ruleClear(page); assert(!r, '1280: ' + r); }
    await page.locator('#sheet form[data-sharepw] input[name=pw]').fill('sunshine'); await page.locator('#sheet form[data-sharepw] input[name=pw]').press('Enter');
    await visible(page.locator('#sheet .share-pwf .fld-err', { hasText: 'too easy to guess' }));
    await page.locator('#sheet form[data-sharepw] input[name=pw]').fill('long-enough-1');
    await page.locator('#sheet form[data-sharepw] input[name=pw]').press('Enter');
    await visible(page.locator('#sheet .share-locked'));
    await announced(page, /^Password set$/, 'password set');
    await page.focus('#sheet [data-a="share-toggle"]'); await tabsStayInSheet(page);
    assert(await page.locator('#sheet .seg [role=radio]').count() === 4, 'not 4 expiry choices');
    await page.click('#sheet [data-exp="7"]');
    await until(page, () => (document.querySelector('#sheet [data-exp="7"]') || {}).getAttribute?.('aria-checked') === 'true', null, '7 days checked');
    await visible(page.locator('#sheet .share-meta', { hasText: 'Until' }));
    await page.keyboard.press('Escape'); await sheetClosed(page);
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250);
  });

  await check('API tokens: keyboard, focus stays in the sheet and returns to the opener', async () => {
    await openFoot(page); await page.focus('#side [data-a="tokens"]'); await page.keyboard.press('Enter'); await sheetOpen(page);
    await page.waitForTimeout(350); await tabsStayInSheet(page);
    await page.keyboard.press('Escape'); await sheetClosed(page);
    assert(await page.evaluate(() => document.activeElement && document.activeElement.dataset.a === 'tokens'), 'focus did not return to API tokens');
  });

  await check('API tokens: create, shown once, copy, revoke with confirm', async () => {
    await openFoot(page); await page.click('#side [data-a="tokens"]'); await sheetOpen(page);
    await visible(page.locator('#sheet .at-title', { hasText: 'API tokens' })); await visible(page.locator('#sheet .tk-sec:not([aria-busy])'));
    await page.fill('#sheet form[data-token] input[name=name]', T.token);
    /* Enter in the name asks for the app password; a wrong one says so and keeps the name */
    await page.press('#sheet form[data-token] input[name=name]', 'Enter');
    await until(page, () => document.activeElement && document.activeElement.name === 'password', null, 'focus in the password');
    await page.fill('#sheet form[data-token] input[name=password]', 'not the password');
    await page.press('#sheet form[data-token] input[name=password]', 'Enter');
    await visible(page.locator('#sheet form[data-token] .fld-err', { hasText: 'Wrong password' }));
    assert(await page.inputValue('#sheet form[data-token] input[name=name]') === T.token, 'the name was lost');
    await page.fill('#sheet form[data-token] input[name=password]', PASSWORD);
    await page.press('#sheet form[data-token] input[name=password]', 'Enter');
    await until(page, () => /^tk_/.test((document.querySelector('#sheet .tk-val') || {}).textContent || ''), null, 'token value');
    await visible(page.locator('#sheet', { hasText: 'Copy it now. It is not shown again.' }));
    await visible(page.locator('#sheet [data-a="tk-copy"]'));
    await shot(page, `${engine}-desktop-tokens`);
    await page.locator('#sheet .tk-row', { hasText: T.token }).locator('[data-a="tk-revoke"]').click();
    await page.click('#sheet [data-a="tk-revoke-yes"]');
    await toastWith(page, 'Token revoked');
    await until(page, n => ![...document.querySelectorAll('#sheet .tk-row')].some(r => r.textContent.includes(n)), T.token, 'row gone');
    assert(!(await page.locator('#sheet .tk-val').count()), 'value still shown after revoke');
    await page.keyboard.press('Escape'); await sheetClosed(page);
  });

  await check('API tokens: empty state sentence', async () => {
    await page.route('**/api/tokens', r => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback());
    await openFoot(page); await page.click('#side [data-a="tokens"]'); await sheetOpen(page);
    await visible(page.locator('#sheet p.tk-sec'));
    const text = (await page.textContent('#sheet p.tk-sec')).trim();
    await page.unroute('**/api/tokens');
    assert(text === TOKENS_EMPTY, 'empty state reads: ' + text);
    await page.keyboard.press('Escape'); await sheetClosed(page);
  });

  await check('Signed in: this browser is marked, another one shows up and goes with Sign out all others after the app password', async () => {
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } }), op = await other.newPage();
    try {
      await login(op);
      await openFoot(page); await page.click('#side [data-a="sessions"]'); await sheetOpen(page);
      await visible(page.locator('#sheet .at-title', { hasText: 'Signed in' }));
      await visible(page.locator('#sheet .tk-row', { hasText: 'This browser' }));
      assert(!(await page.locator('#sheet .tk-row', { hasText: 'This browser' }).locator('[data-a="ss-end"]').count()), 'this browser has a Sign out button');
      /* Sign out asks for the app password, like making a token; a wrong one says so and the other browser stays in */
      await page.click('#sheet [data-a="ss-others"]');
      await until(page, () => document.activeElement && document.activeElement.name === 'password', null, 'focus in the password');
      await page.fill('#sheet form[data-session] input[name=password]', 'not the password');
      await page.press('#sheet form[data-session] input[name=password]', 'Enter');
      await visible(page.locator('#sheet form[data-session] .fld-err', { hasText: 'Wrong password' }));
      assert((await apiIn(op, 'GET', '/api/state')).status === 200, 'a wrong password signed the other browser out');
      await page.click('#sheet [data-a="ss-cancel"]');
      await gone(page.locator('#sheet form[data-session]'));
      await page.click('#sheet [data-a="ss-others"]');
      await page.fill('#sheet form[data-session] input[name=password]', PASSWORD);
      await page.press('#sheet form[data-session] input[name=password]', 'Enter');
      await toastWith(page, 'Other browsers signed out');
      await gone(page.locator('#sheet [data-a="ss-others"]'));
      assert((await apiIn(op, 'GET', '/api/state')).status === 401, 'the other browser is still signed in');
      assert((await apiIn(page, 'GET', '/api/state')).status === 200, 'this browser was signed out');
      await page.keyboard.press('Escape'); await sheetClosed(page);
    } finally { await other.close(); }
  });

  await check('locked folder: lock from the menu, it hides, unlock shows it', async () => {
    await page.click(`#side .sf[data-fid="${folderId}"]`);
    await until(page, n => (document.querySelector('#tbwrap h2') || {}).textContent === n, T.folder, 'folder view');
    /* the folder menu from the keyboard: End, Home, type-ahead, Enter */
    await page.focus('#tbwrap [data-a="folder-menu"]'); await page.keyboard.press('Enter');
    await visible(page.locator('.menu'));
    const labels = (await page.locator('.menu [role="menuitem"]').allTextContents()).map(x => x.trim());
    assert(!labels.some(l => /Inbox|All bookmarks|Trash$|^New folder$|Sort/.test(l)), 'places or view controls in the folder menu: ' + labels.join(', '));
    const focused = () => page.evaluate(() => document.activeElement.textContent.trim());
    await page.keyboard.press('End'); assert(await focused() === 'Delete', 'End: ' + await focused());
    await page.keyboard.press('Home'); assert(/^Shar(e|ing)$/.test(await focused()), 'Home: ' + await focused());
    await page.keyboard.press('r'); assert(await focused() === 'Rename', 'type-ahead r: ' + await focused());
    await page.keyboard.press('l'); assert(await focused() === 'Lock with a password', 'type-ahead l: ' + await focused());
    await page.keyboard.press('Enter');
    await visible(page.locator('#layer.dialog.open #sheet'));
    await page.waitForTimeout(250); await tabsStayInSheet(page, 6);
    await page.keyboard.press('Escape'); await sheetClosed(page);
    assert(await page.evaluate(() => document.activeElement && document.activeElement.dataset.a === 'folder-menu'), 'focus did not return to the folder menu button');
    await page.click('#tbwrap [data-a="folder-menu"]');
    await menuItem(page, 'Lock with a password').click();
    await visible(page.locator('#layer.dialog.open #sheet'));
    await page.fill('#sheet input[name=pw]', 'abc'); await page.fill('#sheet input[name=pw2]', 'abc'); await page.press('#sheet input[name=pw2]', 'Enter');
    await visible(page.locator('#sheet .fld-err', { hasText: 'at least 8' }));
    await page.fill('#sheet input[name=pw]', 'Password1'); await page.fill('#sheet input[name=pw2]', 'Password1'); await page.press('#sheet input[name=pw2]', 'Enter');
    await visible(page.locator('#sheet .fld-err', { hasText: 'too easy to guess' }));
    await page.fill('#sheet input[name=pw]', T.lockPw); await page.fill('#sheet input[name=pw2]', T.lockPw); await page.press('#sheet input[name=pw2]', 'Enter');
    await toastWith(page, 'Folder locked'); await announced(page, /^Folder locked$/, 'folder locked');
    await visible(page.locator(`#side .sf.locked[data-fid="${folderId}"]`));
    await page.click('#q');
    await until(page, () => !!document.querySelector('#pal.open') && document.activeElement.id === 'pq', null, 'palette open from the field');
    await page.keyboard.type(stamp);
    await until(page, () => document.querySelector('#pal.open') && !document.querySelector('#pal .pal-it'), null, 'the locked link stays out of the palette');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await until(page, () => !document.querySelector('#pal'), null, 'palette closed');
    await page.click('#side [data-view="inbox"]');
    /* saving a link that sits only in the locked folder: the save page tells nothing, as for a link not saved anywhere */
    const sp = await ctx.newPage();
    await sp.goto(`${BASE}/save?url=${encodeURIComponent(T.url)}&title=x`);
    await visible(sp.locator('#sheet [data-a="save-go"]'));
    await sp.waitForTimeout(600); /* the check has answered */
    assert(await sp.locator('#sheet .dupe:not(.off)').count() === 0, 'the save page told the link is saved');
    assert(await sp.locator('#sheet [data-a="save-go"][disabled]').count() === 0, 'Save is disabled');
    await sp.close();
    await page.click(`#side .sf[data-fid="${folderId}"]`);
    await visible(page.locator('#layer.dialog.open #sheet'));
    await page.fill('#sheet input[name=pw]', T.lockPw); await page.press('#sheet input[name=pw]', 'Enter');
    await visible(page.locator('#body article .t-title', { hasText: T.title }));
    await page.click('#tbwrap [data-a="folder-menu"]');
    await menuItem(page, 'Remove lock').click();
    await visible(page.locator('#layer.dialog.open #sheet'));
    await page.fill('#sheet input[name=pw]', PASSWORD); await page.press('#sheet input[name=pw]', 'Enter');
    await toastWith(page, 'Lock removed');
  });

  await check('save page: ?url= preloads, shows the picker, Save to Inbox works', async () => {
    const sp = await ctx.newPage();
    await sp.goto(`${BASE}/save?url=${encodeURIComponent(T.saveUrl)}&title=${encodeURIComponent(T.saveTitle)}`);
    await visible(sp.locator('#layer.open #sheet [data-f=title]'));
    assert(await sp.inputValue('#sheet [data-f=title]') === T.saveTitle, 'title not preloaded');
    assert(await sp.inputValue('#sheet [data-f=url]') === T.saveUrl, 'url not preloaded');
    await sp.click('#sheet [data-a="choose"]');
    await visible(sp.locator('#sheet .fpick .fmini'));
    await shot(sp, `${engine}-desktop-save-page`);
    const inbox = sp.locator('#sheet [data-a="save-inbox"]');
    if (await inbox.count()) await inbox.click(); else await sp.click('#sheet [data-a="save-go"]');
    await Promise.race([sp.waitForEvent('close', { timeout: 6000 }), visible(sp.locator('#sheet .done-state, #sheet [aria-label="Saved"]'))]);
    const s = (await apiIn(page, 'GET', '/api/state')).data;
    const b = s.bookmarks.find(x => x.url === T.saveUrl && !x.deleted_at);
    assert(b && b.folder_id == null, 'not saved to Inbox');
    if (!sp.isClosed()) await sp.close();
  });

  await check('delete the test folder', async () => {
    await page.click('#tbwrap [data-a="folder-menu"]');
    await menuItem(page, 'Delete').click(); await sheetOpen(page);
    await page.click('#sheet [data-a="confirm"]'); await sheetClosed(page);
    await until(page, id => !document.querySelector(`#side .sf[data-fid="${id}"]`), folderId, 'folder gone');
  });

  await check('1440: a click on a Trash card offers Restore and Delete now at the card and never opens it; Cmd click opens nothing', async () => {
    const t = (await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test trash click', url: 'https://ui-test.example/seed/trash-click', folder_id: null })).data;
    await apiIn(page, 'DELETE', `/api/bookmarks/${t.id}`); await page.reload(); await page.click('#side [data-view="trash"]');
    const card = page.locator(`#body article.tile[data-id="${t.id}"]`); await visible(card);
    assert(!(await card.locator('a[href]').count()), 'a Trash card still carries a link');
    await page.evaluate(() => { window.__opened = []; }); const pages = ctx.pages().length;
    const r = await card.boundingBox(); await page.mouse.click(r.x + 60, r.y + 40);
    await visible(page.locator('.menu'));
    assert((await page.locator('.menu [role^=menuitem]').allTextContents()).map(x => x.trim()).join(',') === 'Restore,Delete now', 'the menu is not Restore and Delete now');
    const m = await page.locator('.menu').boundingBox(); assert(Math.abs(m.x - (r.x + 60)) < 4 && Math.abs(m.y - (r.y + 40)) < 4, 'the menu is not at the click');
    await shot(page, `${engine}-desk-trash-click`);
    await page.keyboard.press('Escape'); await gone(page.locator('.menu'));
    await page.mouse.move(r.x + 60, r.y + 40); await page.keyboard.down(isMacKey); await page.mouse.click(r.x + 60, r.y + 40); await page.keyboard.up(isMacKey); await page.waitForTimeout(400);
    assert(!(await page.evaluate(() => window.__opened.length)) && ctx.pages().length === pages, 'a Trash card opened its link');
    await page.keyboard.press('Escape'); await apiIn(page, 'DELETE', `/api/bookmarks/${t.id}?permanent=1`);
  });

  await check('1440: deleting from Trash for good asks first, from Delete now in the menu, the Delete key and Select then Delete; Cancel keeps it', async () => {
    const mk = async n => (await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test purge ${n}`, url: `https://ui-test.example/seed/purge-${n}`, folder_id: null })).data;
    const a = await mk('a'), b = await mk('b'); await apiIn(page, 'DELETE', `/api/bookmarks/${a.id}`); await apiIn(page, 'DELETE', `/api/bookmarks/${b.id}`);
    const exists = async id => ((await apiIn(page, 'GET', '/api/state')).data.bookmarks || []).some(x => x.id === id);
    await page.reload(); await page.click('#side [data-view="trash"]');
    const card = id => page.locator(`#body article.tile[data-id="${id}"]`); await visible(card(a.id));
    await card(a.id).locator('.t-title').click(); await menuItem(page, 'Delete now').click(); await sheetOpen(page);
    assert(/deleted for good/.test(await page.textContent('#sheet')), 'Delete now did not ask');
    await page.click('#sheet [data-a="close"]'); await sheetClosed(page); await page.waitForTimeout(300);
    assert(await exists(a.id), 'Cancel deleted it');
    await card(a.id).locator('.t-title').focus(); await page.keyboard.press('Delete'); await sheetOpen(page);
    assert(await exists(a.id), 'the Delete key deleted before asking');
    await page.click('#sheet [data-a="confirm"]'); await sheetClosed(page);
    await until(page, id => !document.querySelector(`#body article.tile[data-id="${id}"]`), a.id, 'the card gone');
    assert(!(await exists(a.id)), 'confirmed, but still there');
    await page.click('#tbwrap [data-a="select"]'); await card(b.id).locator('.t-title').click();
    await page.click('#dbulk [data-a="bulk-purge"]'); await sheetOpen(page);
    assert(await exists(b.id), 'bulk Delete deleted before asking');
    await page.click('#sheet [data-a="close"]'); await sheetClosed(page);
    assert(await page.locator('#screen.selecting').count(), 'Cancel ended selecting');
    await page.click('#dbulk [data-a="bulk-purge"]'); await sheetOpen(page); await page.click('#sheet [data-a="confirm"]'); await sheetClosed(page);
    await until(page, id => !document.querySelector(`#body article.tile[data-id="${id}"]`), b.id, 'the picked card gone');
    assert(!(await exists(b.id)), 'bulk confirmed, but still there');
  });

  await check('1024, 900 and 800: the selection bar keeps every word; at 720 the least needed folds first and Trash keeps its word longest', async () => {
    await page.click('#side [data-view="inbox"]'); await visible(page.locator('#body article.tile'));
    const state = () => page.evaluate(() => { const bar = document.querySelector('#dbulk .bulk');
      return { over: bar.scrollWidth > bar.clientWidth, ic: [...bar.querySelectorAll('[data-fit]')].filter(b => b.classList.contains('ic')).map(b => b.dataset.a), all: [...bar.querySelectorAll('[data-fit]')].map(b => b.dataset.a) }; });
    for (const w of [1024, 900, 800, 720]) { await page.setViewportSize({ width: w, height: 900 }); await visible(page.locator('#side'));
      await page.click('#tbwrap [data-a="select"]'); await page.locator('#body article.tile').nth(0).click(); await page.locator('#body article.tile').nth(1).click();
      await visible(page.locator('#dbulk .bulk')); const g = await state();
      assert(!g.over, w + ': the bar runs over ' + JSON.stringify(g));
      if (w >= 800) assert(!g.ic.length, w + ': words folded ' + g.ic);
      else { const order = ['bulk-share', 'sel-all', 'bulk-copy', 'bulk-move', 'sel-more', 'bulk-trash']; assert(g.ic.length && g.ic.every(a => order.indexOf(a) < g.ic.length) && !g.ic.includes('bulk-trash'), '720: folded ' + g.ic); }
      await page.keyboard.press('Escape'); await gone(page.locator('#dbulk .bulk')); }
    await page.setViewportSize({ width: 1440, height: 900 }); await visible(page.locator('#side .si'));
  });

  await check('768 with touch: the How to save device tabs, the folder title share button and the card actions take a 44 px tap', async () => {
    const c = await browser.newContext({ viewport: { width: 768, height: 900 }, hasTouch: true, locale: 'en-US' }); await c.addCookies(await ctx.cookies()); const p = await c.newPage();
    try {
      await p.goto(BASE + '/bookmarklet'); await visible(p.locator('.hs-tabs [role=tab]'));
      const tabs = await p.evaluate(() => [...document.querySelectorAll('.hs-tabs [role=tab]')].map(t => { const r = t.getBoundingClientRect(), x = r.left + r.width / 2;
        const at = y => { const e = document.elementFromPoint(x, y); return !!e && e.closest('[role=tab]') === t; }; const cy = r.top + r.height / 2; return at(cy - 21.5) && at(cy + 21.5) ? 0 : t.textContent; }).filter(Boolean));
      assert(!tabs.length, 'device tabs under 44 px: ' + tabs.join(', '));
      const seedF = (await apiIn(p, 'GET', '/api/state')).data.folders.find(f => f.name === 'ui-test seed');
      await p.goto(BASE + '/'); await visible(p.locator('#side .si')); await p.click(`#side [data-view="${seedF.id}"]`); await visible(p.locator('#body article.tile .ab'));
      const g = await p.evaluate(() => { const s = document.querySelector('#tbwrap .tb-share'), r = s.getBoundingClientRect(), cy = r.top + r.height / 2;
        const hit = x => { const e = document.elementFromPoint(x, cy); return !!e && e.closest('.tb-share') === s; };
        const ab = document.querySelector('#body article.tile .ab').getBoundingClientRect();
        return { share: hit(r.left + r.width / 2 - 21.5) && hit(r.left + r.width / 2 + 21.5), ab: [ab.width, ab.height] }; });
      assert(g.share, 'the share button beside the folder title is under 44 px');
      assert(g.ab[0] >= 44 && g.ab[1] >= 44, 'card action buttons ' + g.ab.join(' by '));
    } finally { await c.close(); }
  });

  await check('768 with touch: Show all under a long list takes a 44 px tap', async () => {
    const id = await seedLong(page);
    const c = await browser.newContext({ viewport: { width: 768, height: 900 }, hasTouch: true, locale: 'en-US' }); await c.addCookies(await ctx.cookies()); const p = await c.newPage();
    try {
      await p.goto(BASE + '/'); await visible(p.locator('#side .si')); await p.click(`#side [data-view="${id}"]`);
      const b = await p.locator('#body [data-a="show-all"]').boundingBox();
      assert(b && b.height >= 44, 'Show all is under 44 px: ' + (b && b.height));
    } finally { await c.close(); await dropLong(page, id); }
  });

  await check('login, How to save and save pages follow the system scheme and the bulb\'s pick, as the app does', async () => {
    const WANT = { light: ['rgb(244, 241, 234)', 'rgb(27, 26, 23)'], dark: ['rgb(15, 15, 17)', 'rgb(240, 240, 240)'] };
    const look = async (p, want, where) => { const g = await p.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.documentElement).backgroundColor, ink: getComputedStyle(document.body).color }));
      assert(g.t === want && g.bg === WANT[want][0] && g.ink === WANT[want][1], `${where}: wanted ${want}, got ${JSON.stringify(g)}`); };
    for (const scheme of ['light', 'dark']) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme }), p = await c.newPage();
      try {
        await p.goto(BASE + '/login'); await look(p, scheme, `${scheme} login`);
        await login(p);
        for (const path of ['/bookmarklet', '/save']) { await p.goto(BASE + path); await look(p, scheme, `${scheme} ${path}`); }
        const other = scheme === 'light' ? 'dark' : 'light';
        await p.evaluate(t => localStorage.setItem('pinned-theme', t), other);
        for (const path of ['/bookmarklet', '/save']) { await p.goto(BASE + path); await look(p, other, `${scheme} system, ${other} picked, ${path}`); }
      } finally { await c.close(); }
    }
  });

  await check('the save page and How to save each have a Log out that ends the session', async () => {
    for (const path of ['/save', '/bookmarklet']) {
      const c = await browser.newContext({ viewport: { width: 392, height: 600 } }), p = await c.newPage();
      try {
        await login(p); await p.goto(BASE + path);
        const out = p.locator('[data-a="logout"]'); await visible(out);
        await Promise.all([p.waitForURL(u => u.pathname === '/login'), out.click()]);
        await p.goto(BASE + '/'); assert(new URL(p.url()).pathname === '/login', `${path}: still signed in after Log out`);
      } finally { await c.close(); }
    }
  });

  await check('dates read the same in every locale: 4 Oct this year, 4 Oct 2025 before (de-DE too)', async () => {
    const de = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const dp = await de.newPage(); await login(dp); await dp.click('#side [data-view="inbox"]'); await visible(dp.locator('#body article time'));
    const bad = await dp.evaluate(() => { const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], y = new Date().getFullYear();
      const want = iso => { const d = new Date(iso + 'T12:00:00'); return `${d.getDate()} ${M[d.getMonth()]}${d.getFullYear() === y ? '' : ' ' + d.getFullYear()}`; };
      return [...document.querySelectorAll('#body article time')].map(t => [t.textContent, t.getAttribute('datetime')])
        .filter(([txt, iso]) => !/^(Today|Yesterday)$/.test(txt) && txt !== want(iso)); });
    await de.close();
    assert(!bad.length, 'dates not in the fixed form: ' + JSON.stringify(bad.slice(0, 3)));
  });

  await check('a long list: the first 240 cards, the count and Show all; Show all from the keyboard draws the rest without a seam, focus on the next card, screen readers hear the count; Delete moves focus to the next card; a redraw keeps the place; search finds any card; a new visit starts capped', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await seedLong(page);
    try {
      await page.evaluate(() => window.Pinned.load()); await visible(page.locator(`#side .sf[data-fid="${id}"]`));
      await page.click(`#side .sf[data-fid="${id}"]`); await visible(page.locator('#body .more'));
      assert(await page.locator('#body article').count() === LONG_CAP, 'not 240 cards: ' + await page.locator('#body article').count());
      assert((await page.locator('#body .more-n').textContent()).trim() === `Showing ${LONG_CAP} of ${LONG_N} bookmarks`, 'count line: ' + await page.locator('#body .more-n').textContent());
      const btn = page.locator('#body [data-a="show-all"]');
      assert((await btn.textContent()).trim() === `Show all ${LONG_N}`, 'button: ' + await btn.textContent());
      assert(await btn.getAttribute('aria-label') === `Show all ${LONG_N} bookmarks`, 'button label: ' + await btn.getAttribute('aria-label'));
      assert(await page.locator('#body .addtile').count() === 0, 'the add tile shows under a cut list');
      const h = await btn.boundingBox(); assert(h && h.height >= 32, 'Show all is smaller than the other buttons');
      await btn.scrollIntoViewIfNeeded(); await shot(page, `${engine}-long-capped`);
      await btn.focus(); await page.keyboard.press('Enter');
      await until(page, n => document.querySelectorAll('#body article').length === n && !document.querySelector('#body .more'), LONG_N, 'every card drawn');
      await announced(page, new RegExp(`Showing all ${LONG_N} bookmarks`), 'the count');
      const f = await page.evaluate(() => { const a = document.activeElement, arts = [...document.querySelectorAll('#body article')];
        return { title: !!a && a.matches('.t-title'), at: a && a.closest('article') ? arts.indexOf(a.closest('article')) : -1 }; });
      assert(f.title && f.at === LONG_CAP, `focus is not on card ${LONG_CAP + 1}: ${JSON.stringify(f)}`);
      assert(await page.locator('#body .addtile').count() === 1, 'no add tile after the last card');
      const g = await seamGap(page, '#body article', 4);
      assert(Math.abs(g.seam - g.head) < 1 && g.dx < 1, `seam ${g.seam} px against ${g.head} px between rows, ${g.dx} px across`);
      const at = () => page.evaluate(() => [...document.querySelectorAll('#body article')].indexOf(document.activeElement.closest('article')));
      await page.keyboard.press('ArrowLeft'); assert(await at() === LONG_CAP - 1, 'ArrowLeft does not cross back to the head');
      await page.keyboard.press('ArrowDown'); assert(await at() === LONG_CAP + 3, 'ArrowDown does not reach the next row: ' + await at());
      await shot(page, `${engine}-long-full`);
      /* the list layout joins the same way */
      await page.click('#tbwrap .vsw [data-layout="list"]'); await until(page, n => document.querySelectorAll('#body .grid.is-list article').length === n, LONG_N, 'list drawn whole');
      const gl = await seamGap(page, '#body article', 1);
      await page.click('#tbwrap .vsw [data-layout="grid"]'); await page.waitForTimeout(300);
      assert(Math.abs(gl.seam - gl.head) < 1, `list seam ${gl.seam} px against ${gl.head} px`);
      /* Delete on a card past the first 240 moves the focus to the next card, as in the first 240 */
      const order = await page.evaluate(() => [...document.querySelectorAll('#body article')].map(a => +a.dataset.id)), k = LONG_CAP + 10;
      await page.locator(`#body article[data-id="${order[k]}"] .t-title`).focus();
      await page.keyboard.press('Delete'); await toastWith(page, 'Moved to Trash');
      await until(page, want => { const a = document.activeElement; return !!a && a.matches('.t-title') && +a.closest('article').dataset.id === want; }, order[k + 1], 'focus on the next card after Delete');
      /* a redraw (what a return to the window runs) keeps the place and draws the cards on screen at once */
      const kept = await page.evaluate(async () => { const c = document.getElementById('content'); c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) * 0.9);
        await new Promise(r => setTimeout(r, 300)); const y0 = c.scrollTop;
        const seen = () => [...document.querySelectorAll('#body article')].filter(a => { const q = a.getBoundingClientRect(); return q.bottom > 0 && q.top < innerHeight; }).length;
        window.Pinned.render(); const now = seen(), y1 = c.scrollTop; await window.Pinned.load(); return { y0, y1, y2: c.scrollTop, now, after: seen() }; });
      assert(Math.abs(kept.y1 - kept.y0) < 2 && Math.abs(kept.y2 - kept.y0) < 2, 'a redraw moved the list: ' + JSON.stringify(kept));
      assert(kept.now > 0 && kept.after > 0, 'the cards on screen are empty right after a redraw: ' + JSON.stringify(kept));
      /* search finds a card whatever was drawn */
      await page.click('#q'); await page.keyboard.type('ui-test long 299');
      await visible(page.locator('#pal .pal-it', { hasText: 'ui-test long 299' }));
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await page.click('#side [data-view="dashboard"]'); await page.click(`#side .sf[data-fid="${id}"]`);
      await visible(page.locator('#body .more'));
      assert(await page.locator('#body article').count() === LONG_CAP, 'a new visit is not capped again');
    } finally { await dropLong(page, id); await page.evaluate(() => window.Pinned.load()); }
  });

  await check('no script errors', async () => assert(!errors.length, errors.join('; ')));
  beforeEach = null;
  await cleanup(page);
  await ctx.close();
}

async function phone(browser, engine) {
  console.log(`\n${engine}, phone 390x844`);
  const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US' };
  if (engine === 'chromium' || engine === 'webkit') opts.isMobile = true;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(RECORD_OPEN);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));

  await check('login', async () => { await login(page); await visible(page.locator('#papp')); });
  await cleanup(page); await seed(page); await page.reload(); await visible(page.locator('#papp .ptbar.tabs'));
  await check('opens on the Dashboard tab with recently opened links', async () => {
    await visible(page.locator('#pmain .gal a[data-open]'));
    assert(await page.locator('.ptbar.tabs .ptab[aria-selected="true"][data-tab="dashboard"]').count() === 1, 'Dashboard tab is not the chosen one');
    assert(await page.locator('.ptbar.tabs [data-tab="inbox"] .ptab-n').count() === 1, 'Inbox tab has no count');
    assert(await page.locator('.ptbar.tabs [data-tab="folders"] .ptab-n').count() === 1, 'Folders tab has no count');
    await shot(page, `${engine}-phone-dashboard`);
  });
  await check('the phone layout has one main landmark, the content', async () => {
    const m = await page.evaluate(() => [...document.querySelectorAll('main, [role=main]')].map(e => e.id));
    assert(m.length === 1 && m[0] === 'pmain', 'main landmarks: ' + JSON.stringify(m));
  });

  await check('the phone Dashboard groups by day, with no draft switch', async () => {
    assert(await page.locator('.hsw, [data-home]').count() === 0, 'a draft switch is still there');
    assert((await page.locator('#pmain .gal .gs-h').first().textContent()).startsWith('Today'), 'no Today head first');
  });
  await check('the phone Dashboard switches grid and list, 44 px targets, and keeps the choice', async () => {
    const b = await page.locator('#pmain .vsw [data-layout="list"]').boundingBox();
    assert(b && b.width > 43.5 && b.height > 43.5, 'layout button under 44 px');
    await page.tap('#pmain .vsw [data-layout="list"]');
    await until(page, () => !!document.querySelector('#pmain .gal.is-list .gc-row'), null, 'list rows');
    await page.reload();
    await until(page, () => !!document.querySelector('#pmain .gal.is-list'), null, 'list kept after reload');
    await page.tap('#pmain .vsw [data-layout="grid"]');
    await until(page, () => !!document.querySelector('#pmain .gal:not(.is-list)'), null, 'grid again');
  });
  await check('Dashboard, Inbox and Folders tabs: the chosen one carries the shape, the app opens on the Dashboard', async () => {
    await page.tap('.ptbar.tabs [data-tab="inbox"]');
    await until(page, () => !!document.querySelector('#pmain article.pt[data-id]') && !document.querySelector('#pmain .gal, #pmain .ftile'), null, 'Inbox cards only');
    assert(await page.locator('.ptbar.tabs .ptab[aria-selected="true"][data-tab="inbox"]').count() === 1, 'Inbox tab not chosen');
    await shot(page, `${engine}-phone-inbox`);
    await page.tap('.ptbar.tabs [data-tab="folders"]');
    await until(page, () => !!document.querySelector('#pmain .fscreen .ftile'), null, 'folders grid');
    await page.reload();
    await until(page, () => !!document.querySelector('.ptbar.tabs .ptab[aria-selected="true"][data-tab="dashboard"]') && !!document.querySelector('#pmain .gal'), null, 'opens on the Dashboard');
  });
  await check('bottom search pill and Add', async () => {
    const pill = page.locator('.pbottom .ps-trigger'), add = page.locator('.pbottom .padd');
    await visible(pill); await visible(add);
    const a = await pill.boundingBox(), b = await add.boundingBox();
    assert(a.y + a.height > 844 - 120 && b.y + b.height > 844 - 120, 'not at the bottom');
  });
  await check('palette anchored at the top', async () => {
    await page.tap('.pbottom .ps-trigger');
    await visible(page.locator('#pal.open .pal-panel'));
    await page.waitForTimeout(300);
    const r = await page.locator('#pal .pal-panel').boundingBox();
    assert(r.y < 120, 'panel top at ' + r.y);
    await page.keyboard.type('a');
    await visible(page.locator('#pal-list .pal-grp'));
    const c = page.locator('#pal .pal-cancel'), cb = await c.boundingBox();
    assert(cb && cb.height > 43.5 && cb.x + cb.width <= 390, 'Cancel is not a visible 44 px button beside the field');
    assert(await page.evaluate(() => document.activeElement.id === 'pq'), 'the field lost focus');
    await shot(page, `${engine}-phone-palette`);
    await c.tap();
    await gone(page.locator('#pal'));
    await page.tap('.pbottom .ps-trigger'); await visible(page.locator('#pal.open .pal-panel'));
    assert(await page.inputValue('#pq') === '', 'Cancel did not clear the search');
    await page.tap('#pal .pal-cancel'); await gone(page.locator('#pal'));
  });
  await check('the gear opens Settings full screen: Source last, version line, Log out at the end, back to Inbox', async () => {
    await page.tap('.phead [data-view="settings"]');
    await until(page, () => (document.querySelector('.ptb-t') || {}).textContent === 'Settings', null, 'settings screen');
    assert(await page.evaluate(() => document.getElementById('psrow').hidden), 'the search row is still shown');
    const src = page.locator('.pset a.sr[target="_blank"]');
    assert(await src.getAttribute('href') === SOURCE && /noopener/.test(await src.getAttribute('rel') || ''), 'Source link');
    assert(/^Pinned/.test((await page.textContent('.pset .pset-name')).trim()), 'name and version line');
    assert((await page.locator('.pset .sr').last().textContent()).trim() === 'Log out', 'Log out is not last');
    await page.tap('.ptbar.set .pchev');
    await until(page, () => !!document.querySelector('.ptbar.tabs'), null, 'back on the start screen');
  });

  await check('no three dots on the Dashboard, Inbox or Folders tab; the Inbox row shows Sort and Select, 44 px', async () => {
    for (const t of ['dashboard', 'inbox', 'folders']) { await page.tap(`.ptbar.tabs [data-tab="${t}"]`); await page.waitForTimeout(300);
      assert(!(await page.locator('#pmain [data-a$="menu"], #pmain [aria-label="More"]').count()), 'three dots on the ' + t + ' tab'); }
    await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
    const sort = page.locator('#pmain .vbar .sortc[data-a="sort"]'), sel = page.locator('#pmain .vbar [data-a="select"]');
    await visible(sort); await visible(sel);
    for (const l of [sort, sel]) { const b = await l.boundingBox(); assert(b.height > 43.5 && b.width > 43.5, 'under 44 px: ' + JSON.stringify(b)); }
    assert((await sort.textContent()).trim() === 'Newest', 'sort reads ' + (await sort.textContent()).trim());
    assert(!(await page.locator('#pmain .pglbl', { hasText: /^Newest$/ }).count()), 'the order is said twice');
    await sort.tap(); await visible(page.locator('.menu'));
    const rows = await page.evaluate(() => [...document.querySelectorAll('.menu [role="menuitemradio"]')].map(e => e.getBoundingClientRect().height));
    assert(rows.length === 4 && rows.every(h => h > 43.5), 'order rows: ' + rows.join(','));
    await menuItem(page, 'A to Z').tap();
    await until(page, () => (document.querySelector('#pmain .vbar .sortc') || {}).textContent === 'A to Z', null, 'A to Z');
    await page.tap('#pmain .vbar .sortc'); await menuItem(page, 'Newest').tap();
    await until(page, () => (document.querySelector('#pmain .vbar .sortc') || {}).textContent === 'Newest', null, 'Newest');
    await sel.tap(); await visible(page.locator('#pbulkwrap .pbulk'));
    await until(page, () => getComputedStyle(document.getElementById('psrow')).visibility === 'hidden', null, 'the search pill still shows under the selection bar');
    await page.locator('#pmain article.pt .pt-in').first().tap();
    for (const a of ['bulk-move', 'bulk-copy', 'bulk-trash']) { const l = page.locator(`#pbulkwrap [data-a="${a}"]:not([disabled])`); await visible(l);
      const b = await l.boundingBox(); assert(b.width > 43.5 && b.height > 43.5, a + ' under 44 px'); }
    assert((await page.textContent('#pbulkwrap .pbulk .n')).trim().startsWith('1'), 'the bar does not count 1');
    await shot(page, `${engine}-phone-selection`);
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk'));
  });

  /* a finger held still on an element for 600 ms, then lifted where it is, or carried to another element first */
  const hold = (sel, to) => page.evaluate(async ([s, t]) => {
    const el = document.querySelector(s), r = el.getBoundingClientRect(); let x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fire = (type, target) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 42, pointerType: 'touch', isPrimary: true, button: type === 'pointermove' ? -1 : 0, clientX: x, clientY: y }));
    const wait = ms => new Promise(f => setTimeout(f, ms));
    fire('pointerdown', document.elementFromPoint(x, y) || el); await wait(600);
    if (t) { const d = document.querySelector(t).getBoundingClientRect(), x0 = x, y0 = y, tx = d.left + d.width / 2, ty = d.top + d.height / 2;
      for (let i = 1; i <= 14; i++) { x = x0 + (tx - x0) * i / 14; y = y0 + (ty - y0) * i / 14; fire('pointermove', document); await wait(20); } await wait(60); }
    fire('pointerup', document);
  }, [sel, to || null]);
  const scrimClose = async () => { await page.evaluate(() => document.querySelector('#layer .scrim').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))); await sheetClosed(page); };
  const rowLabels = async () => (await page.locator('#sheet .sh-row').allTextContents()).map(r => r.trim()).join(',');

  /* the header does not redraw while selecting: the same nodes, the same computed style in every frame, through hold-select, a tick and Done */
  await check('the active tab, the other tabs and Select are the same nodes with the same style through hold-select, a tick and Done', async () => {
    await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
    await page.evaluate(() => { window.__fr = new Set(); const q = ['.ptbar.tabs .ptab-ind', '.ptbar.tabs .ptab[aria-selected="true"]', '.ptbar.tabs .ptab[aria-selected="false"]'], ids = new WeakMap(); let n = 0;
      const f = () => { __fr.add(q.map(s => { const e = document.querySelector(s); if (!e) return '-'; if (!ids.has(e)) ids.set(e, ++n); const c = getComputedStyle(e); return [ids.get(e), c.opacity, c.transform, c.width, c.color, c.backgroundColor].join('/'); }).join(' ')); window.__raf = requestAnimationFrame(f); }; f(); });
    const id0 = await page.getAttribute('#pmain article.pt >> nth=0', 'data-id');
    await page.waitForTimeout(150); await page.evaluate(() => __fr.clear()); await page.waitForTimeout(100);
    await hold(`#pmain article.pt[data-id="${id0}"] .pt-in`); await visible(page.locator('#pbulkwrap .pbulk'));
    await page.locator('#pmain article.pt .pt-in').nth(1).tap(); await until(page, () => document.querySelectorAll('#pmain article.pt.picked').length === 2, null, 'second tick');
    await page.locator('#pmain article.pt .pt-in').nth(1).tap(); await page.waitForTimeout(300);
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk')); await page.waitForTimeout(300);
    const seen = await page.evaluate(() => { cancelAnimationFrame(__raf); return [...__fr]; });
    assert(seen.length === 1, 'the tabs changed while selecting: ' + seen.slice(0, 3).join(' | '));
  });

  await check('hold a card and let go: selecting starts with it ticked, a tap adds the next, More holds Open, Rename and Pin', async () => {
    await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
    const id0 = await page.getAttribute('#pmain article.pt >> nth=0', 'data-id');
    await hold(`#pmain article.pt[data-id="${id0}"] .pt-in`);
    await visible(page.locator('#pbulkwrap .pbulk'));
    assert(await page.locator(`#pmain article.pt.picked[data-id="${id0}"] [role="checkbox"][aria-checked="true"]`).count() === 1, 'the held card is not ticked');
    assert((await page.textContent('#pbulkwrap .pbulk .n')).trim().startsWith('1'), 'the bar does not count 1');
    assert(!(await page.locator('#layer.open').count()), 'a sheet opened on the long press');
    await shot(page, `${engine}-phone-hold-select`);
    await page.locator('#pmain article.pt .pt-in').nth(1).tap();
    await until(page, () => document.querySelectorAll('#pmain article.pt.picked').length === 2, null, 'a tap adds the second card');
    await page.tap('#pbulkwrap [data-a="sel-more"]'); await sheetOpen(page);
    assert(/^(Pin|Unpin)$/.test(await rowLabels()), 'two cards: ' + await rowLabels());
    await scrimClose();
    await page.locator('#pmain article.pt .pt-in').nth(1).tap();
    await until(page, () => document.querySelectorAll('#pmain article.pt.picked').length === 1, null, 'a tap takes it off again');
    for (const a of ['bulk-move', 'bulk-copy', 'bulk-trash', 'sel-more']) { const l = page.locator(`#pbulkwrap [data-a="${a}"]:not([disabled])`); await visible(l);
      const b = await l.boundingBox(); assert(b.width > 43.5 && b.height > 43.5 && b.x + b.width <= 390, a + ' under 44 px or off screen'); }
    await page.tap('#pbulkwrap [data-a="sel-more"]'); await sheetOpen(page); await page.waitForTimeout(350);
    assert(/^Open,Rename,(Pin|Unpin)$/.test(await rowLabels()), 'one card: ' + await rowLabels());
    await shot(page, `${engine}-phone-bar-more`);
    await page.locator('#sheet .sh-row', { hasText: 'Rename' }).tap();
    await visible(page.locator('#sheet input[name=v]'));
    await until(page, () => !document.querySelector('#pbulkwrap .pbulk'), null, 'still selecting after Rename');
    await scrimClose();
  });

  await check('a sheet over the selection reads solid: the bar steps out while it is open and comes back after', async () => {
    await page.goto(BASE + '/'); await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
    await hold(`#pmain article.pt[data-id="${await page.getAttribute('#pmain article.pt >> nth=0', 'data-id')}"] .pt-in`); await visible(page.locator('#pbulkwrap .pbulk'));
    await page.tap('#pbulkwrap [data-a="sel-all"]'); await page.tap('#pbulkwrap [data-a="bulk-move"]'); await sheetOpen(page); await page.waitForTimeout(400);
    const g = await page.evaluate(() => { const w = getComputedStyle(document.getElementById('pbulkwrap')), bg = getComputedStyle(document.getElementById('sheet')).backgroundColor, a = bg.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
      return { op: w.opacity, vis: w.visibility, alpha: a.length > 3 ? a[3] : 1 }; });
    assert(g.op === '0' && g.vis === 'hidden', 'the selection bar shows under the sheet: ' + JSON.stringify(g));
    assert(g.alpha >= .9, 'the sheet is see-through: ' + g.alpha);
    await shot(page, `${engine}-phone-move-sheet`);
    await scrimClose(); await page.waitForTimeout(300);
    assert(await page.evaluate(() => { const w = getComputedStyle(document.getElementById('pbulkwrap')); return w.opacity === '1' && w.visibility === 'visible'; }), 'the bar did not come back');
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk'));
  });

  await check('hold a card and move it: it lifts and drops on a folder, no selecting', async () => {
    const seedF = (await apiIn(page, 'GET', '/api/state')).data.folders.find(f => f.name === 'ui-test seed');
    const sub = (await apiIn(page, 'POST', '/api/folders', { name: 'ui-test drop', parent_id: seedF.id })).data;
    await page.reload(); await page.tap('.ptbar.tabs [data-tab="folders"]');
    await page.locator('#pmain .fscreen .ftile[data-ftile]', { hasText: 'ui-test seed' }).tap();
    await visible(page.locator(`#pmain .ftile[data-ftile="${sub.id}"]`)); await visible(page.locator('#pmain article.pt'));
    const id = await page.getAttribute('#pmain article.pt >> nth=0', 'data-id');
    await hold(`#pmain article.pt[data-id="${id}"] .pt-in`, `#pmain .ftile[data-ftile="${sub.id}"]`);
    await toastWith(page, 'Moved to ui-test drop');
    const b = (await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === +id);
    assert(b && b.folder_id === sub.id, 'not moved into the folder');
    assert(!(await page.locator('#pbulkwrap .pbulk').count()) && !(await page.locator('#layer.open').count()), 'selecting or a sheet started after the drag');
    await apiIn(page, 'PATCH', `/api/bookmarks/${id}`, { folder_id: seedF.id }); await apiIn(page, 'DELETE', `/api/folders/${sub.id}`);
    await page.goto(BASE + '/'); await visible(page.locator('.ptbar.tabs'));
  });

  await check('in the Trash a hold selects too, the bar holds Restore and Delete; a tap still opens Restore and Delete now', async () => {
    const t = (await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test trashed', url: 'https://ui-test.example/seed/trashed', folder_id: null })).data;
    await apiIn(page, 'DELETE', `/api/bookmarks/${t.id}`);
    await page.reload(); await page.tap('.ptbar.tabs [data-tab="folders"]'); await page.tap('#pmain .ftrash');
    await visible(page.locator(`#pmain article.pt[data-id="${t.id}"]`));
    await hold(`#pmain article.pt[data-id="${t.id}"] .pt-in`);
    await visible(page.locator('#pbulkwrap [data-a="bulk-restore"]:not([disabled])')); await visible(page.locator('#pbulkwrap [data-a="bulk-purge"]:not([disabled])'));
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk'));
    await page.locator(`#pmain article.pt[data-id="${t.id}"] .pt-in`).tap(); await sheetOpen(page);
    assert(await rowLabels() === 'Restore,Delete now', 'trash card sheet: ' + await rowLabels());
    await scrimClose();
    await page.goto(BASE + '/'); await visible(page.locator('.ptbar.tabs'));
  });

  /* the home gallery: two more opened links in the seed folder, so the Dashboard has cards to pick and carry */
  const galSeed = async () => { const seedF = (await apiIn(page, 'GET', '/api/state')).data.folders.find(f => f.name === 'ui-test seed'), ids = [];
    for (const n of [1, 2]) { const b = (await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test gal ${n}`, url: `https://ui-test.example/seed/gal-${n}`, folder_id: seedF.id })).data;
      await apiIn(page, 'POST', `/api/bookmarks/${b.id}/open`); ids.push(b.id); }
    return { seedF, ids }; };
  const galCard = id => `#pmain .gal article[data-id="${id}"] .g-in`;
  /* a finger held still on a card for 600 ms, then carried over each target in turn, resting on each for the given time */
  const carry = (sel, legs) => page.evaluate(async ([s, legs]) => {
    const el = document.querySelector(s), r = el.getBoundingClientRect(); let x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fire = type => (type === 'pointerdown' ? document.elementFromPoint(x, y) || el : document).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 43, pointerType: 'touch', isPrimary: true, button: type === 'pointermove' ? -1 : 0, clientX: x, clientY: y }));
    const wait = ms => new Promise(f => setTimeout(f, ms));
    fire('pointerdown'); await wait(600);
    for (const [t, rest] of legs) { const d = document.querySelector(t).getBoundingClientRect(), x0 = x, y0 = y, tx = d.left + d.width / 2, ty = d.top + d.height / 2;
      for (let i = 1; i <= 14; i++) { x = x0 + (tx - x0) * i / 14; y = y0 + (ty - y0) * i / 14; fire('pointermove'); await wait(20); } await wait(rest); }
    fire('pointerup');
  }, [sel, legs]);

  await check('home at 390: Select is on screen on the Dashboard, Inbox and Folders tabs, 44 px', async () => {
    await page.goto(BASE + '/'); await visible(page.locator('.ptbar.tabs'));
    for (const [t, sel] of [['dashboard', '#pmain .gal-hr [data-a="select"]'], ['inbox', '#pmain .vbar [data-a="select"]'], ['folders', '#pmain .vbar [data-a="select"]']]) {
      await page.tap(`.ptbar.tabs [data-tab="${t}"]`); const l = page.locator(sel); await visible(l);
      const b = await l.boundingBox(); assert(b.width > 43.5 && b.height > 43.5 && b.x >= 0 && b.x + b.width <= 390, t + ': Select under 44 px or off screen'); }
    await page.tap('.ptbar.tabs [data-tab="dashboard"]'); await page.tap('#pmain .gal-hr [data-a="select"]');
    await visible(page.locator('#pbulkwrap .pbulk')); await visible(page.locator('#pmain .gal article[data-id] .chk'));
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk'));
  });
  /* where the cards, folder tiles and the top controls sit, to the pixel, in the phone layout */
  const phoneBoxes = () => page.evaluate(() => [...document.querySelectorAll('#pmain article[data-id], #pmain .fscreen .ftile[data-ftile], #pmain .ptbar, #pmain .phead, #pmain .vbar, #pmain .gal-hr, #pmain [data-a="select"]')]
    .map(e => { const r = e.getBoundingClientRect(); return [e.dataset.id || e.dataset.ftile || e.className, Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
  const sameBoxes = (a, b) => a.length === b.length && a.every((x, i) => x[0] === b[i][0] && [1, 2, 3, 4].every(k => Math.abs(x[k] - b[i][k]) <= 1));
  await check('home at 390: selecting keeps the title, gear, tabs and every card in place; Select turns into the pressed Done and ends it', async () => {
    await page.goto(BASE + '/'); await visible(page.locator('.ptbar.tabs'));
    let ran = 0;
    for (const t of ['dashboard', 'inbox', 'folders']) {
      await page.tap(`.ptbar.tabs [data-tab="${t}"]`); await until(page, k => !!document.querySelector(`.ptbar.tabs [data-tab="${k}"][aria-selected="true"]`), t, t + ' tab');
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(350);
      const sel = page.locator('#pmain [data-a="select"]'); if (!(await sel.count())) continue; ran++;
      assert(await sel.getAttribute('aria-pressed') === 'false' && await sel.getAttribute('aria-label') === 'Select', t + ': Select is not a toggle named Select');
      const rest = await phoneBoxes(); await sel.tap(); await visible(page.locator('#pbulkwrap .pbulk'));
      const on = await phoneBoxes();
      assert(sameBoxes(rest, on), t + ': something moved entering selection');
      await visible(page.locator('#pmain .phead .phead-t')); await visible(page.locator('#pmain .phead [data-view="settings"]'));
      assert(await page.locator('.ptbar.tabs .ptab').count() === 3 && await page.locator(`.ptbar.tabs [data-tab="${t}"][aria-selected="true"]`).count() === 1, t + ': the tabs left while selecting');
      assert(await sel.getAttribute('aria-pressed') === 'true' && await sel.getAttribute('aria-label') === 'Done', t + ': Select is not the pressed Done');
      await until(page, () => getComputedStyle(document.getElementById('psrow')).visibility === 'hidden', null, t + ': the search pill still shows');
      await sel.tap(); await gone(page.locator('#pbulkwrap .pbulk'));
      assert(!(await page.locator('#papp.selecting').count()) && await sel.getAttribute('aria-pressed') === 'false', t + ': the pressed Select did not end selecting');
      assert(sameBoxes(rest, await phoneBoxes()), t + ': something moved leaving selection');
    }
    assert(ran > 0, 'no tab with Select');
  });
  await check('home at 390: switching tab while selecting ends it and shows the new tab as it is', async () => {
    await page.goto(BASE + '/'); await visible(page.locator('.ptbar.tabs'));
    await page.tap('.ptbar.tabs [data-tab="dashboard"]'); await visible(page.locator('#pmain .gal-hr [data-a="select"]'));
    await page.tap('#pmain .gal-hr [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk'));
    await page.locator('#pmain .gal article[data-id]').first().tap();
    await until(page, () => document.querySelectorAll('#pmain .gal article.picked').length === 1, null, 'a card picked');
    await page.tap('.ptbar.tabs [data-tab="folders"]');
    await until(page, () => !!document.querySelector('.ptbar.tabs [data-tab="folders"][aria-selected="true"]') && !document.querySelector('#papp.selecting'), null, 'Folders tab, not selecting');
    await until(page, () => !document.querySelector('#pbulkwrap .pbulk') && getComputedStyle(document.getElementById('psrow')).visibility === 'visible', null, 'the selection bar stayed after the tab switch');
    assert(!(await page.locator('#pmain .picked').count()), 'picks survived the tab switch');
    await page.tap('.ptbar.tabs [data-tab="dashboard"]'); await visible(page.locator('#pmain .gal'));
    assert(!(await page.locator('#pmain .gal article.picked').count()) && !(await page.locator('#papp.selecting').count()), 'the Dashboard came back selecting');
  });
  await check('home gallery at 390: hold a card and let go selects it ticked, a tap adds and takes off, the bar holds Move, Copy, Share, Trash and More', async () => {
    const { ids } = await galSeed(); await page.reload(); await visible(page.locator(galCard(ids[0])));
    await hold(galCard(ids[0]));
    await visible(page.locator('#pbulkwrap .pbulk'));
    assert(await page.locator(`#pmain .gal article.picked[data-id="${ids[0]}"] [role="checkbox"][aria-checked="true"]`).count() === 1, 'the held card is not ticked');
    assert((await page.textContent('#pbulkwrap .pbulk .n')).trim().startsWith('1'), 'the bar does not count 1');
    assert(!(await page.locator('#layer.open').count()), 'a sheet opened on the long press');
    await page.waitForTimeout(400); assert(!(await page.evaluate(() => window.__opened.length)), 'the hold opened the link');
    await page.locator(galCard(ids[1])).tap();
    await until(page, () => document.querySelectorAll('#pmain .gal article.picked').length === 2, null, 'a tap adds the second card');
    await page.locator(galCard(ids[1])).tap();
    await until(page, () => document.querySelectorAll('#pmain .gal article.picked').length === 1, null, 'a tap takes it off again');
    for (const a of ['bulk-move', 'bulk-copy', 'bulk-share', 'bulk-trash', 'sel-more']) { const l = page.locator(`#pbulkwrap [data-a="${a}"]:not([disabled])`); await visible(l);
      const b = await l.boundingBox(); assert(b.width > 43.5 && b.height > 43.5 && b.x + b.width <= 390, a + ' under 44 px or off screen'); }
    await page.tap('#pbulkwrap [data-a="sel-more"]'); await sheetOpen(page); await page.waitForTimeout(350);
    assert(/^Open,Rename,(Pin|Unpin)$/.test(await rowLabels()), 'one card: ' + await rowLabels());
    await scrimClose();
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk'));
    await page.tap('#pmain .gal-hr [data-layout="list"]'); await visible(page.locator(`#pmain .gal.is-list article.gc-row[data-id="${ids[1]}"]`)); await page.waitForTimeout(400); /* the layout morph settles */
    await hold(galCard(ids[1])); await visible(page.locator(`#pmain .gal article.gc-row.picked[data-id="${ids[1]}"]`));
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await page.tap('#pmain .gal-hr [data-layout="grid"]'); await visible(page.locator('#pmain .gal:not(.is-list) article.gk'));
  });
  await check('home gallery at 390: hold and move a card over the Folders tab, it opens and the card drops on a folder', async () => {
    const st = (await apiIn(page, 'GET', '/api/state')).data, b = st.bookmarks.find(x => x.title === 'ui-test gal 1'), from = b.folder_id;
    const f = (await apiIn(page, 'POST', '/api/folders', { name: 'ui-test gdrop', parent_id: null })).data;
    await page.reload(); await visible(page.locator(galCard(b.id)));
    await carry(galCard(b.id), [['.ptbar.tabs [data-tab="folders"]', 700], [`#pmain .fscreen .ftile[data-ftile="${f.id}"]`, 80]]);
    await toastWith(page, 'Moved to ui-test gdrop');
    assert((await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === b.id).folder_id === f.id, 'not moved into the folder');
    assert(!(await page.locator('#pbulkwrap .pbulk').count()) && !(await page.locator('#layer.open').count()), 'selecting or a sheet started after the drag');
    await apiIn(page, 'PATCH', `/api/bookmarks/${b.id}`, { folder_id: from }); await apiIn(page, 'DELETE', `/api/folders/${f.id}`);
  });
  /* the same carry with a real finger: Chromium's touch input runs through its scroll handling, so a drag that loses its
     touch target in the view swap is cancelled there. WebKit has no way to drive real touch from here */
  if (engine === 'chromium') await check('home gallery at 390, real touch: a card carried over the Folders tab survives the swap and drops on a folder, the page holds still', async () => {
    const st = (await apiIn(page, 'GET', '/api/state')).data, b = st.bookmarks.find(x => x.title === 'ui-test gal 1'), from = b.folder_id;
    const f = (await apiIn(page, 'POST', '/api/folders', { name: 'ui-test tdrop', parent_id: null })).data;
    await page.goto(BASE + '/'); await visible(page.locator(galCard(b.id)));
    await page.evaluate(() => { window.__pc = 0; window.__sy = new Set(); document.addEventListener('pointercancel', () => { __pc++; }, true); addEventListener('scroll', () => __sy.add(scrollY)); });
    const cdp = await ctx.newCDPSession(page), touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const mid = async sel => { const r = await page.locator(sel).first().boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    let [x, y] = await mid(galCard(b.id)); const y0 = await page.evaluate(() => scrollY);
    const leg = async ([tx, ty]) => { const x0 = x, y0 = y; for (let i = 1; i <= 14; i++) { x = x0 + (tx - x0) * i / 14; y = y0 + (ty - y0) * i / 14; await touch('touchMove', [{ x, y }]); await page.waitForTimeout(20); } };
    await touch('touchStart', [{ x, y }]); await page.waitForTimeout(600);
    await leg(await mid('.ptbar.tabs [data-tab="folders"]')); await page.waitForTimeout(700);
    await visible(page.locator(`#pmain .fscreen .ftile[data-ftile="${f.id}"]`));
    await leg(await mid(`#pmain .fscreen .ftile[data-ftile="${f.id}"]`)); await page.waitForTimeout(80);
    const mid1 = await page.evaluate(() => ({ ghost: !!document.querySelector('.ghost'), on: !!document.querySelector('.ftile.drop-on'), pc: __pc, sy: [...__sy] }));
    await touch('touchEnd', []); await cdp.detach();
    assert(mid1.ghost && mid1.on && !mid1.pc, 'the drag did not survive the swap: ' + JSON.stringify(mid1));
    assert(mid1.sy.every(v => v === y0), 'the page scrolled during the drag: ' + mid1.sy.join(','));
    await toastWith(page, 'Moved to ui-test tdrop');
    assert((await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === b.id).folder_id === f.id, 'not moved into the folder');
    await apiIn(page, 'PATCH', `/api/bookmarks/${b.id}`, { folder_id: from }); await apiIn(page, 'DELETE', `/api/folders/${f.id}`);
  });
  await check('home gallery at 390: a card carried onto the Trash row of the Folders tab goes to Trash with Undo', async () => {
    const b = (await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.title === 'ui-test gal 2');
    await page.goto(BASE + '/'); await visible(page.locator(galCard(b.id)));
    await carry(galCard(b.id), [['.ptbar.tabs [data-tab="folders"]', 700], ['#pmain .ftrash', 80]]);
    await toastWith(page, 'Moved to Trash');
    assert((await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === b.id).deleted_at, 'not in Trash');
    await page.locator('#toasts .toast button').tap();
    await until(page, () => true, null, 'undo'); await page.waitForTimeout(500);
    assert(!(await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === b.id).deleted_at, 'Undo did not bring it back');
  });
  await check('Folders tab at 390: a hold on a folder selects it, no sheet; a tap adds the next; the bar says Delete', async () => {
    for (const x of ['a', 'b']) await apiIn(page, 'POST', '/api/folders', { name: `ui-test fhold ${x}`, parent_id: null });
    await page.goto(BASE + '/'); await page.tap('.ptbar.tabs [data-tab="folders"]');
    const ft = x => page.locator('#pmain .fscreen .ftile[data-ftile]', { hasText: `ui-test fhold ${x}` });
    await visible(ft('a')); await hold(`#pmain .fscreen .ftile[data-ftile="${await ft('a').getAttribute('data-ftile')}"]`);
    await visible(page.locator('#pbulkwrap .pbulk'));
    assert(!(await page.locator('#layer.open').count()), 'a sheet opened on the hold');
    assert(await page.locator('#pmain .ftile.picked').count() === 1, 'the held folder is not picked');
    await ft('b').tap(); await until(page, () => document.querySelectorAll('#pmain .ftile.picked').length === 2, null, 'a tap adds the second folder');
    const del = page.locator('#pbulkwrap [data-a="bulk-ftrash"]');
    assert((await del.textContent()).trim() === 'Delete', 'the folder bar says ' + (await del.textContent()).trim());
    await del.tap(); await sheetOpen(page);
    assert(/Delete 2 folders\?/.test(await page.textContent('#sheet')), 'the confirm does not count 2 folders');
    await page.tap('#sheet [data-a="confirm"]'); await sheetClosed(page);
    await until(page, () => ![...document.querySelectorAll('#pmain .ftile')].some(t => t.textContent.includes('ui-test fhold')), null, 'both folders gone');
  });

  await check('the Folders tab: New folder on screen, its order from two folders on, All bookmarks the first card, Trash at the foot', async () => {
    await page.tap('.ptbar.tabs [data-tab="folders"]');
    await until(page, () => !!document.querySelector('#pmain .fscreen .ftile'), null, 'folders grid');
    const tops = ((await apiIn(page, 'GET', '/api/state')).data.folders || []).filter(f => f.parent_id == null).length;
    assert(await page.locator('#pmain .vbar [data-a="fsort"]').count() === (tops > 1 ? 1 : 0), `the folder order ${tops > 1 ? 'hides with two folders' : 'shows with one folder'}`);
    const add = page.locator('#pmain .vbar [data-a="new-folder"]'), b = await add.boundingBox();
    assert(b.width > 43.5 && b.height > 43.5, 'New folder under 44 px');
    assert(await add.locator('.nf-c').count() === 1, 'the Folders tab + is not the filled circle');
    assert(await page.evaluate(() => { const a = getComputedStyle(document.querySelector('#pmain .vbar .nf-c')), w = document.querySelector('#pmain .vbar .nf-c').getBoundingClientRect().width; return a.backgroundColor !== 'rgba(0, 0, 0, 0)' && Math.abs(w - 28) < 0.5; }), 'the Folders tab circle has no fill or is not 28 px');
    const first = page.locator('#pmain .fscreen > .ftile').first();
    assert(await first.getAttribute('data-view') === 'all' && /^All bookmarks, \d+$/.test(await first.evaluate(e => e.querySelector('.ft-t').textContent + e.querySelector('.vh').textContent)), 'All bookmarks is not the first card');
    const fb = await first.boundingBox(), sb = await page.locator('#pmain .fscreen .ftile[data-ftile]').first().boundingBox();
    assert(Math.abs(fb.width - sb.width) < 1 && Math.abs(fb.height - sb.height) < 1, 'All bookmarks is not a folder card in size');
    const tr = page.locator('#pmain .ftrash'); await visible(tr);
    assert(/^Trash, \d+$/.test(await tr.evaluate(e => e.querySelector('.ftrash-n').textContent + e.querySelector('.vh').textContent)), 'Trash row has no count');
    assert((await tr.boundingBox()).height > 43.5, 'Trash row under 44 px');
    await shot(page, `${engine}-phone-folders`);
    await add.tap(); await sheetOpen(page); await visible(page.locator('#sheet input[name=v]'));
    await page.evaluate(() => document.querySelector('#layer .scrim').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))); await sheetClosed(page);
    await first.tap();
    await until(page, () => (document.querySelector('.ptb-t') || {}).textContent === 'All bookmarks', null, 'All bookmarks opens');
    await visible(page.locator('#pmain .vbar [data-a="sort"]')); await visible(page.locator('#pmain .vbar [data-a="select"]'));
    assert(!(await page.locator('#pmain [data-a$="menu"]').count()), 'three dots on All bookmarks');
    await page.tap('#pmain .pback');
    await until(page, () => !!document.querySelector('.ptbar.tabs [data-tab="folders"][aria-selected="true"]'), null, 'back on the Folders tab');
    await page.tap('#pmain .ftrash');
    await until(page, () => (document.querySelector('.ptb-t') || {}).textContent === 'Trash', null, 'Trash opens');
    await page.tap('#pmain .pback');
  });

  await check('inside a folder: Sort and Select on screen, the three dots hold only what acts on the folder', async () => {
    await page.tap('.ptbar.tabs [data-tab="folders"]');
    await page.locator('#pmain .fscreen .ftile[data-ftile]', { hasText: 'ui-test seed' }).tap();
    await until(page, () => (document.querySelector('.ptb-t') || {}).textContent === 'ui-test seed', null, 'seed folder');
    await visible(page.locator('#pmain .vbar [data-a="sort"]')); await visible(page.locator('#pmain .vbar [data-a="select"]'));
    await page.tap('.ptbar [data-a="folder-menu"]'); await sheetOpen(page); await page.waitForTimeout(350);
    assert(!(await page.locator('#sheet .sh-tile, #sheet .sh-tiles').count()), 'squares in the sheet');
    const rows = (await page.locator('#sheet .sh-row').allTextContents()).map(r => r.trim());
    for (const want of ['Share', 'Add bookmarks', 'New folder inside', 'Rename', 'Move to', 'Hide from Recent', 'Lock with a password', 'Delete']) assert(rows.includes(want), want + ' missing: ' + rows.join(', '));
    assert(!rows.some(r => /Inbox|All bookmarks|^Trash|^New folder$|Sort/.test(r)), 'places or view controls in the folder sheet: ' + rows.join(', '));
    await shot(page, `${engine}-phone-folder-sheet`);
    await page.evaluate(() => document.querySelector('#layer .scrim').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))); await sheetClosed(page);
    await page.goto(BASE + '/'); await visible(page.locator('.ptbar.tabs'));
  });

  await check('390 touch: a tap on empty space ends selecting, on the Dashboard and in the Inbox; a tap in the gutter beside a card ticks none', async () => {
    await page.tap('.ptbar.tabs [data-tab="dashboard"]'); await visible(page.locator('#pmain .gal article[data-id]'));
    await page.tap('#pmain [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk'));
    const empty = await page.evaluate(() => { const bad = 'article, button, a, input, label, .ptbar, .vbar, .phead, .precent, .gal-hr, #pbottom'; for (let y = innerHeight - 120; y > 200; y -= 3) for (let x = 20; x < innerWidth - 20; x += 3) { const e = document.elementFromPoint(x, y); if (e && e.closest('#pmain') && !e.closest(bad)) return [x, y]; } return null; });
    assert(empty, 'no empty space on the Dashboard');
    await page.touchscreen.tap(empty[0], empty[1]); await until(page, () => !document.querySelector('#papp.selecting'), null, 'Dashboard: the tap on empty space did not end selecting');
    await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
    await page.tap('#pmain [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk'));
    await page.locator('#pmain article.pt .pt-in').nth(0).tap(); await until(page, () => document.querySelectorAll('#pmain article.pt.picked').length === 1, null, 'first tick');
    const gut = await page.evaluate(() => { const a = [...document.querySelectorAll('#pmain article.pt')], r0 = a[0].getBoundingClientRect(), r1 = a[1].getBoundingClientRect();
      window.__ticked = []; new MutationObserver(m => m.forEach(x => { if (x.target.classList.contains('picked') && !String(x.oldValue).includes('picked')) __ticked.push(x.target.dataset.id); })).observe(document.getElementById('pmain'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
      return Math.abs(r1.top - r0.top) < 2 ? [(r0.right + r1.left) / 2, r0.top + r0.height / 2] : [r0.left + r0.width / 2, (r0.bottom + r1.top) / 2]; });
    assert(await page.evaluate(([x, y]) => !document.elementFromPoint(x, y).closest('article'), gut), 'the gutter point is on a card');
    await page.touchscreen.tap(gut[0], gut[1]); await until(page, () => !document.querySelector('#papp.selecting'), null, 'Inbox: the tap in the gutter did not end selecting');
    await page.waitForTimeout(400);
    assert(!(await page.evaluate(() => __ticked.length)) && !(await page.locator('#pmain article.picked').count()), 'the gutter tap ticked a card');
    assert(!(await page.evaluate(() => window.__opened.length)) && ctx.pages().length === 1, 'the gutter tap opened a link');
  });
  await check('390 touch: Select, a tick, an untick and Done keep every card and favicon node; the tick pops in, the one motion', async () => {
    await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
    await page.evaluate(() => { window.__keep = [...document.querySelectorAll('#pmain article[data-id], #pmain article[data-id] img, .ptbar.tabs')]; });
    await page.tap('#pmain [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk'));
    await page.locator('#pmain article.pt .pt-in').nth(1).tap(); await until(page, () => document.querySelectorAll('#pmain article.pt.picked').length === 1, null, 'tick');
    const anims = await page.evaluate(() => document.getAnimations().map(a => a.animationName).filter(Boolean));
    assert(!anims.length || (anims.length === 1 && anims[0] === 'chk-pop'), 'the tick plays ' + anims.join(','));
    await page.locator('#pmain article.pt .pt-in').nth(1).tap(); await until(page, () => !document.querySelector('#pmain article.pt.picked'), null, 'untick');
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk'));
    const lost = await page.evaluate(() => __keep.filter(n => !n.isConnected).length);
    assert(!lost, lost + ' nodes were drawn again');
    assert(await page.locator('#pmain article.pt a.pt-in[href][data-open]').count() === await page.locator('#pmain article.pt').count(), 'a card is not a link again after Done');
  });
  await check('390 and 320: the selection bar shows the count whole, the five actions beside it; screen readers hear "selected"', async () => {
    for (const w of [390, 320]) { await page.setViewportSize({ width: w, height: w === 320 ? 640 : 844 });
      await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
      await page.tap('#pmain [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk'));
      for (const i of [0, 1]) await page.locator('#pmain article.pt .pt-in').nth(i).tap();
      await until(page, () => document.querySelectorAll('#pmain article.pt.picked').length === 2, null, 'two ticks');
      const g = await page.evaluate(() => { const n = document.querySelector('#pbulkwrap .pbulk .n'), v = n.querySelector('.vh'); return { cut: n.scrollWidth > n.clientWidth + 1, text: n.textContent.trim(), vh: !!v && v.textContent.trim() === 'selected', acts: [...document.querySelectorAll('#pbulkwrap .bb')].filter(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }).length }; });
      assert(!g.cut && g.text === '2 selected' && g.vh && g.acts === 5, w + ': ' + JSON.stringify(g));
      if (w === 390) await shot(page, `${engine}-phone-selection-count`);
      await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk')); }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check('375x667: the Add sheet keeps Save and Save to Inbox in view; every field 16 px text and 48 px high; + is 48 px round beside the 48 px search', async () => {
    const pb = await page.evaluate(() => ['#qs', '.pbottom .padd'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.top, r.height, r.width]; }));
    assert(pb[0][0] === pb[1][0] && pb[0][1] === 48 && pb[1][1] === 48 && pb[1][2] === 48, 'search and + do not align: ' + JSON.stringify(pb));
    await page.setViewportSize({ width: 375, height: 667 });
    await page.tap('.pbottom .padd'); await sheetOpen(page); await page.waitForTimeout(450);
    const f = await page.evaluate(() => ({ acts: [...document.querySelectorAll('#sheet [data-a="save-go"], #sheet [data-a="save-inbox"]')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.a, Math.round(r.top), Math.round(r.bottom)]; }),
      fields: [...document.querySelectorAll('#sheet .fld-in')].map(e => [e.tagName, parseFloat(getComputedStyle(e).fontSize), Math.round(e.getBoundingClientRect().height)]), shimmer: document.getAnimations().filter(a => a.animationName === 'ph-sweep').length }));
    assert(f.acts.length && f.acts.every(a => a[1] >= 0 && a[2] <= 667), 'an action is out of view: ' + JSON.stringify(f.acts));
    assert(f.fields.length === 2 && f.fields.every(x => x[1] >= 16 && x[2] === 48), 'fields: ' + JSON.stringify(f.fields));
    assert(!f.shimmer, 'the placeholder shimmers with nothing loading');
    await shot(page, `${engine}-phone-add-sheet-375`);
    await page.evaluate(() => document.querySelector('#layer .scrim').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))); await sheetClosed(page);
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await check('320 px: the view rows fit, nothing scrolls sideways', async () => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const t of ['inbox', 'folders']) { await page.tap(`.ptbar.tabs [data-tab="${t}"]`); await page.waitForTimeout(350);
      const g = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth, fit: [...document.querySelectorAll('#pmain .vbar button, .ptbar.tabs .ptab')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) }));
      assert(!g.over && g.fit, t + ' at 320: ' + JSON.stringify(g)); }
    await page.setViewportSize({ width: 390, height: 844 }); await page.tap('.ptbar.tabs [data-tab="dashboard"]');
  });

  await check('390 and 320: Select all is the count with the word All, one 44 px target, nothing overlaps or is cut; a tap picks every card', async () => {
    for (const w of [390, 320]) { await page.setViewportSize({ width: w, height: w === 320 ? 640 : 844 });
      await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
      await page.tap('#pmain [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk .pall'));
      for (const round of [0, 1]) { await page.waitForTimeout(450); /* the bar settles from its entrance scale */
        const g = await page.evaluate(() => { const bar = document.querySelector('#pbulkwrap .pbulk'), B = bar.getBoundingClientRect(), n = bar.querySelector('.n');
          const R = [...bar.querySelectorAll('button')].map(e => e.getBoundingClientRect());
          return { cut: n.scrollWidth > n.clientWidth + 1, in: R.every(r => r.left >= B.left && r.right <= B.right), lap: R.slice(1).some((r, i) => r.left < R[i].right - .5),
            all: (({ width, height }) => [width, height])(bar.querySelector('.pall').getBoundingClientRect()), text: [...bar.querySelector('.pall-t').childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join(''), label: bar.querySelector('.pall').textContent,
            bb: [...bar.querySelectorAll('.bb')].map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)) }; });
        assert(!g.cut && g.in && !g.lap && g.all[0] >= 44 && g.all[1] >= 44 && g.text === 'All' && /selected, select All$/.test(g.label) && g.bb.every(x => x >= 44), w + ': ' + JSON.stringify(g));
        if (!round) { await page.tap('#pbulkwrap .pall'); await until(page, () => document.querySelectorAll('#pmain article.pt').length === document.querySelectorAll('#pmain article.pt.picked').length
          && document.querySelector('#pbulkwrap .pbulk .n').textContent.startsWith(document.querySelectorAll('#pmain article.pt').length + ' '), null, 'every card picked'); }
      }
      await shot(page, `${engine}-phone-select-all-${w}`);
      await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk')); }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check('the phone groups cards by day as the desktop does: Today, Yesterday, This week, Earlier', async () => {
    await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
    const L = await page.locator('#pmain .pglbl:not(.prc-lbl) span').allTextContents();
    assert(L[0] === 'Today' && L.every(x => ['Today', 'Yesterday', 'This week', 'Earlier'].includes(x)), 'labels ' + L.join(','));
    await page.tap('#pmain [data-a="sort"]'); await page.tap('.menu [role^=menuitem]:has-text("Last opened")'); await page.waitForTimeout(300);
    const O = await page.locator('#pmain .pglbl:not(.prc-lbl) span').allTextContents();
    assert(O.every(x => ['Today', 'Yesterday', 'This week', 'Earlier', 'Not opened'].includes(x)) && O.includes('Not opened'), 'Last opened labels ' + O.join(','));
    await page.tap('#pmain [data-a="sort"]'); await page.tap('.menu [role^=menuitem]:has-text("Newest")'); await page.waitForTimeout(300);
  });
  await check('the phone switches grid and list in the Inbox, a folder, All bookmarks and Trash, 44 px, the one choice the desktop keeps; list rows are 56 px', async () => {
    const t = (await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test list trashed', url: 'https://ui-test.example/seed/list-trashed', folder_id: null })).data;
    await apiIn(page, 'DELETE', `/api/bookmarks/${t.id}`); await page.reload(); await visible(page.locator('.ptbar.tabs'));
    const seedF = (await apiIn(page, 'GET', '/api/state')).data.folders.find(f => f.name === 'ui-test seed');
    const go = { inbox: async () => page.tap('.ptbar.tabs [data-tab="inbox"]'), all: async () => { await page.tap('.ptbar.tabs [data-tab="folders"]'); await page.tap('#pmain .ftile[data-view="all"]'); },
      folder: async () => { await page.tap('.ptbar.tabs [data-tab="folders"]'); await page.tap(`#pmain .ftile[data-ftile="${seedF.id}"]`); }, trash: async () => { await page.tap('.ptbar.tabs [data-tab="folders"]'); await page.tap('#pmain .ftrash'); } };
    for (const [k, open] of Object.entries(go)) {
      await page.goto(BASE + '/'); await visible(page.locator('.ptbar.tabs')); await open(); await visible(page.locator('#pmain article.pt'));
      const sw = page.locator('#pmain .vbar .vsw [data-layout="list"]'); await visible(sw); const b = await sw.boundingBox();
      assert(b.width > 43.5 && b.height > 43.5 && b.x + b.width <= 390, k + ': list button under 44 px or off screen');
      await sw.tap(); await until(page, () => !!document.querySelector('#pmain .pgrid.is-list article.pt.row'), null, k + ' list rows');
      const g = await page.evaluate(() => { const a = document.querySelector('#pmain article.pt.row'), r = a.getBoundingClientRect(), t = a.querySelector('.pt-title').getBoundingClientRect(), f = a.querySelector('.fav').getBoundingClientRect();
        return { h: Math.round(r.height), one: getComputedStyle(a.parentElement).gridTemplateColumns.split(' ').length, side: t.left > f.right, kept: localStorage.getItem('pinned.layout'), over: document.documentElement.scrollWidth > innerWidth }; });
      assert(g.h === 56 && g.one === 1 && g.side && g.kept === '"list"' && !g.over, k + ': ' + JSON.stringify(g));
      if (k === 'inbox') await shot(page, `${engine}-phone-inbox-list`);
      await page.tap('#pmain .vbar .vsw [data-layout="grid"]'); await until(page, () => !document.querySelector('#pmain .pgrid.is-list') && !!document.querySelector('#pmain .pgrid article.pt:not(.row)'), null, k + ' grid again');
    }
    assert(await page.locator('#pmain .ptbar [data-a="empty-trash"]').count() === 1, 'Empty trash is not beside the Trash title');
    await page.setViewportSize({ width: 320, height: 640 }); await page.waitForTimeout(200);
    const fit = await page.evaluate(() => [...document.querySelectorAll('#pmain .vbar button, #pmain .ptbar button')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) && document.documentElement.scrollWidth <= innerWidth);
    assert(fit, 'the Trash rows do not fit at 320');
    await page.setViewportSize({ width: 390, height: 844 });
    await apiIn(page, 'DELETE', `/api/bookmarks/${t.id}?permanent=1`); await page.goto(BASE + '/'); await visible(page.locator('.ptbar.tabs'));
  });
  await check('a soft backing under the bottom bar: the ground under the search and plus and the gaps beside them, a gradient with no blur, rising with the selection bar', async () => {
    await page.tap('.ptbar.tabs [data-tab="inbox"]'); await visible(page.locator('#pmain article.pt'));
    const top = () => page.evaluate(() => { const c = getComputedStyle(document.getElementById('papp'), '::after'), m = new DOMMatrix(c.transform === 'none' ? '' : c.transform);
      return { top: innerHeight - parseFloat(c.height) + m.m42, bg: c.backgroundImage, blur: (c.backdropFilter || c.webkitBackdropFilter || 'none'), pos: c.position, pe: c.pointerEvents, z: c.zIndex }; });
    const a = await top(), q = await page.locator('#qs').boundingBox();
    assert(a.pos === 'fixed' && a.pe === 'none' && /gradient/.test(a.bg) && a.blur === 'none', 'backing: ' + JSON.stringify(a));
    assert(a.top <= q.y - 20 && a.top >= q.y - 60, `backing top ${a.top} against the search at ${q.y}`);
    await shot(page, `${engine}-phone-bottom-backing`);
    await page.tap('#pmain [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk')); await page.waitForTimeout(450);
    const s2 = await top(), bb = await page.locator('#pbulkwrap .pbulk').boundingBox();
    assert(s2.top <= bb.y - 20, `backing top ${s2.top} against the selection bar at ${bb.y}`);
    await page.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(page.locator('#pbulkwrap .pbulk'));
  });

  await check('an empty Inbox on the phone: All sorted, centred under the tabs', async () => {
    await page.route('**/api/state', async r => { const res = await r.fetch(); const j = await res.json(); const f = j.folders[0];
      j.bookmarks.forEach(b => { if (b.folder_id == null) b.folder_id = f.id; }); await r.fulfill({ response: res, json: j }); });
    await page.reload(); await page.tap('.ptbar.tabs [data-tab="inbox"]');
    await visible(page.locator('#pmain .calm .calm-h', { hasText: 'All sorted' }));
    await centred(page, '#pmain');
    await shot(page, `${engine}-phone-inbox-empty`);
    await page.unroute('**/api/state'); await page.reload(); await visible(page.locator('.ptbar.tabs'));
  });

  await check('a sheet dismissed by swipe', async () => {
    await page.tap('.pbottom .padd'); await sheetOpen(page);
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
      const g = document.querySelector('#sheet .grab'), r = g.getBoundingClientRect(), x = r.left + r.width / 2; let y = r.top + 2;
      const fire = (type, yy) => g.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, button: type === 'pointermove' ? -1 : 0, clientX: x, clientY: yy }));
      fire('pointerdown', y);
      for (let i = 0; i < 12; i++) { y += 30; fire('pointermove', y); await new Promise(f => setTimeout(f, 16)); }
      fire('pointerup', y);
    });
    await sheetClosed(page);
  });
  await check('390: the share password rule sits under the field and under the error line', async () => {
    const f = (await apiIn(page, 'POST', '/api/folders', { name: 'ui-test share rule' })).data;
    try {
      await page.evaluate(async v => { const a = await import('/static/js/actions.js'); await window.Pinned.load(); a.goView(v); }, f.id);
      await page.locator('[data-a="share-open"]').first().click(); await sheetOpen(page);
      await page.click('#sheet [data-a="share-toggle"]');
      await until(page, () => /\/s\//.test((document.getElementById('share-url') || {}).value || ''), null, 'share link');
      await page.click('#sheet [data-a="share-lock"]');
      const pw = page.locator('#sheet form[data-sharepw] input[name=pw]'); await visible(pw); await pw.focus(); await page.waitForTimeout(300);
      let r = await ruleClear(page); assert(!r, '390: ' + r);
      if (process.env.SHARE_SHOT && engine === 'webkit') await page.screenshot({ path: process.env.SHARE_SHOT });
      await pw.fill('short1'); await pw.press('Enter');
      await visible(page.locator('#sheet .share-pwf .fld-err', { hasText: 'at least 8' }));
      r = await ruleClear(page); assert(!r, '390 with the error: ' + r);
      await page.keyboard.press('Escape'); await sheetClosed(page);
    } finally { await apiIn(page, 'DELETE', `/api/folders/${f.id}`); await page.evaluate(async () => { const a = await import('/static/js/actions.js'); a.goView('dashboard'); await window.Pinned.load(); }); }
  });
  await check('390: a long folder shows 240 cards, the count and Show all at 44 px; a tap draws the rest without a seam; a redraw keeps the place', async () => {
    const id = await seedLong(page);
    try {
      await page.evaluate(async v => { const a = await import('/static/js/actions.js'); await window.Pinned.load(); a.goView(v); }, id);
      await visible(page.locator('#pmain .pmore'));
      assert(await page.locator('#pmain article').count() === LONG_CAP, 'not 240 cards');
      assert((await page.locator('#pmain .more-n').textContent()).trim() === `Showing ${LONG_CAP} of ${LONG_N} bookmarks`, 'count line');
      const btn = page.locator('#pmain [data-a="show-all"]'), bb = await btn.boundingBox();
      assert(bb && bb.height >= 44, 'Show all is under 44 px: ' + (bb && bb.height));
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'the page scrolls sideways');
      await btn.scrollIntoViewIfNeeded(); await shot(page, `${engine}-phone-long-capped`);
      await btn.tap();
      await until(page, n => document.querySelectorAll('#pmain article').length === n && !document.querySelector('#pmain .pmore'), LONG_N, 'every card drawn');
      await announced(page, new RegExp(`Showing all ${LONG_N} bookmarks`), 'the count');
      /* the card Show all focuses, and the one ArrowDown moves to, sit clear of the bottom bar */
      const clear = () => page.evaluate(() => { const a = document.activeElement && document.activeElement.closest('article'), bar = document.querySelector('.pbottom');
        if (!a || !bar) return 'no focused card or bar'; const r = a.getBoundingClientRect(), t = bar.getBoundingClientRect().top; return r.bottom <= t + 0.5 ? '' : `card ends at ${r.bottom}, bar starts at ${t}`; });
      await page.waitForTimeout(300); let under = await clear(); assert(!under, 'after Show all: ' + under);
      await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); under = await clear(); assert(!under, 'after ArrowDown: ' + under);
      const g = await seamGap(page, '#pmain article', 2);
      assert(Math.abs(g.seam - g.head) < 1 && g.dx < 1, `seam ${g.seam} px against ${g.head} px between rows, ${g.dx} px across`);
      await shot(page, `${engine}-phone-long-full`);
      /* a redraw (what a return to the app runs) keeps the place far down the list and draws the cards on screen at once */
      const kept = await page.evaluate(async () => { const lazyTop = document.querySelector('#pmain .lazy').getBoundingClientRect().top + scrollY;
        scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) * 0.9));
        await new Promise(r => setTimeout(r, 400)); const y0 = scrollY;
        const seen = () => [...document.querySelectorAll('#pmain article')].filter(a => { const q = a.getBoundingClientRect(); return q.bottom > 0 && q.top < innerHeight; }).length;
        window.Pinned.render(); const now = seen(), y1 = scrollY; await window.Pinned.load(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { y0, y1, y2: scrollY, now, after: seen(), lazyTop }; });
      assert(kept.y0 > kept.lazyTop, 'did not scroll past the first 240 cards: ' + JSON.stringify(kept));
      assert(Math.abs(kept.y1 - kept.y0) < 2 && Math.abs(kept.y2 - kept.y0) < 2, 'a redraw moved the page: ' + JSON.stringify(kept));
      assert(kept.now > 0 && kept.after > 0, 'the cards on screen are empty right after a redraw: ' + JSON.stringify(kept));
    } finally { await dropLong(page, id); await page.evaluate(async () => { const a = await import('/static/js/actions.js'); a.goView('dashboard'); await window.Pinned.load(); }); }
  });
  await check('no script errors', async () => assert(!errors.length, errors.join('; ')));
  await cleanup(page);
  await ctx.close();
}

/* a narrow desktop window (the phone layout) driven by a mouse and a keyboard: selecting follows the input, not the width */
async function narrow(browser, engine) {
  console.log(`\n${engine}, mouse at 700x1000`);
  const ctx = await browser.newContext({ viewport: { width: 700, height: 1000 }, locale: 'en-US' });
  await ctx.addInitScript(RECORD_OPEN);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); await cleanup(page); await seed(page); await page.reload(); await visible(page.locator('#papp'));
  beforeEach = async () => { for (let i = 0; i < 3; i++) { if (!(await page.locator('#layer.open, .menu, #pal').count())) break; await page.keyboard.press('Escape'); await page.waitForTimeout(350); }
    if (await page.locator('#papp.selecting, #screen.selecting').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
  const card = n => page.locator('#pmain article.pt', { hasText: `ui-test seed inbox ${n}` });
  const centre = async loc => { const b = await loc.first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const mouseHold = async loc => { await loc.first().scrollIntoViewIfNeeded(); const c = await centre(loc); await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); };
  const inbox = async () => { await page.click('.ptbar.tabs [data-tab="inbox"]'); await visible(card(1)); };
  const picked = () => page.locator('#app .picked').count();
  const mod = engine === 'webkit' || process.platform === 'darwin' ? 'Meta' : 'Control';

  await check('700 px with a mouse: the phone layout, a click opens a card and does not select', async () => {
    assert(await page.locator('#papp').count() === 1, 'not the phone layout');
    await inbox();
    const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }), card(1).locator('.pt-in').click()]);
    await pop.close();
    assert(!(await page.locator('#papp.selecting').count()), 'a click started selecting');
  });
  await check('700 px: a mouse held still on a card and let go selects it, with the bar', async () => {
    await inbox(); await mouseHold(card(2));
    await visible(page.locator('#pbulkwrap .pbulk'));
    assert(await card(2).locator('[role="checkbox"][aria-checked="true"]').count() === 1, 'the held card is not ticked');
    assert((await page.textContent('#pbulkwrap .pbulk .n')).trim().startsWith('1'), 'the bar does not count 1');
    assert(!(await page.locator('#layer.open, .menu').count()), 'a sheet or menu opened on the hold');
    await page.waitForTimeout(400); assert(!(await page.evaluate(() => window.__opened.length)) && ctx.pages().length === 1, 'the hold opened the link');
    await shot(page, `${engine}-700-hold-select`);
    await page.keyboard.press('Escape'); await gone(page.locator('#pbulkwrap .pbulk'));
  });
  await check('700 px: Shift click selects, a second Shift click takes the range', async () => {
    await inbox(); await card(1).click({ modifiers: ['Shift'] });
    await visible(page.locator('#pbulkwrap .pbulk'));
    assert(await picked() === 1, 'Shift click did not pick one card');
    await card(3).click({ modifiers: ['Shift'] });
    await until(page, () => document.querySelectorAll('#app article.picked').length === 3, null, 'a range of three');
  });
  await check('700 px: Cmd or Ctrl click opens a new tab, Cmd A selects every card, Escape ends it', async () => {
    /* headless Chromium now and then drops a Cmd click background tab (about 1 run in 10), so a link click the app left alone also passes */
    await inbox(); await page.evaluate(() => { window.__modClick = null; addEventListener('click', e => { const a = e.target.closest('a[href][target=_blank]'); window.__modClick = !!a && e.metaKey !== e.ctrlKey && !e.defaultPrevented; }, { once: true }); });
    const pop = (await Promise.all([ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null), card(1).locator('.pt-in').click({ modifiers: [mod] })]))[0];
    if (pop) await pop.close(); else assert(await page.evaluate(() => window.__modClick), 'Cmd click neither opened a tab nor reached the link');
    assert(!(await page.locator('#papp.selecting').count()), 'Cmd click started selecting');
    await page.keyboard.press(`${mod}+a`);
    const n = await page.locator('#app article[data-id]').count();
    await until(page, n => document.querySelectorAll('#app article.picked').length === n, n, 'every card picked');
    assert((await page.textContent('#pbulkwrap .pbulk .n')).trim().startsWith(String(n)), 'the bar does not count them all');
    await page.keyboard.press('Escape'); await gone(page.locator('#pbulkwrap .pbulk'));
  });
  await check('700 px: a mouse held still on a Dashboard gallery card selects it; Shift click takes a range; a click opens', async () => {
    await page.click('.ptbar.tabs [data-tab="dashboard"]'); const g = page.locator('#pmain .gal article[data-id]'); await visible(g);
    await mouseHold(g.first()); await visible(page.locator('#pbulkwrap .pbulk'));
    assert(await g.first().locator('[role="checkbox"][aria-checked="true"]').count() === 1, 'the held card is not ticked');
    await page.waitForTimeout(400); assert(!(await page.evaluate(() => window.__opened.length)) && ctx.pages().length === 1, 'the hold opened the link');
    await page.keyboard.press('Escape'); await gone(page.locator('#pbulkwrap .pbulk'));
    const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }), g.first().locator('.g-in').click()]); await pop.close();
    assert(!(await page.locator('#papp.selecting').count()), 'a click started selecting');
  });
  await check('home at 1024 and 1440: Select on the Dashboard, Inbox and Folders; a mouse hold on a gallery card selects it', async () => {
    try { for (const w of [1024, 1440]) { await page.setViewportSize({ width: w, height: 900 }); await visible(page.locator('#side .si'));
      for (const v of ['dashboard', 'inbox', 'folders']) { if (v === 'folders') { await page.keyboard.press('ControlOrMeta+k'); await visible(page.locator('#pal.open')); await page.keyboard.type('Folders'); await page.locator('#pal .pal-view', { hasText: 'Folders' }).first().click(); }
        else await page.click(`#side [data-view="${v}"]`); await visible(page.locator('#tbwrap [data-a="select"]')); }
      await page.click('#side [data-view="dashboard"]'); const g = page.locator('#body .gal article[data-id]'); await visible(g);
      await mouseHold(g.first()); await visible(page.locator('#dbulk .tb.bulk'));
      assert(await page.locator('#body .gal article.picked').count() === 1, w + ': the held card is not picked');
      await page.keyboard.press('Escape'); await gone(page.locator('#screen.selecting')); } }
    finally { await page.setViewportSize({ width: 700, height: 1000 }); await visible(page.locator('#papp')); }
  });
  await check('700 px: a right click on a folder tile opens its menu', async () => {
    await page.click('.ptbar.tabs [data-tab="folders"]'); const t = page.locator('#pmain .fscreen .ftile[data-ftile]', { hasText: 'ui-test seed' });
    await t.click({ button: 'right' }); await visible(page.locator('.menu'));
    assert(await menuItem(page, 'Rename').count() === 1, 'no Rename in the folder menu');
    const m = await page.locator('.menu').boundingBox(); assert(m.x >= 0 && m.x + m.width <= 700, 'the menu runs off screen');
    await page.keyboard.press('Escape'); await gone(page.locator('.menu'));
  });
  await check('700 px Folders screen: hold, Shift click and Cmd A pick folders; the bar holds All and Delete, which asks once', async () => {
    for (const x of ['a', 'b']) await apiIn(page, 'POST', '/api/folders', { name: `ui-test fsel ${x}`, parent_id: null });
    await page.reload(); await page.click('.ptbar.tabs [data-tab="folders"]');
    const ft = x => page.locator('#pmain .fscreen .ftile[data-ftile]', { hasText: `ui-test fsel ${x}` });
    await mouseHold(ft('a')); await visible(page.locator('#pbulkwrap .pbulk'));
    assert(await page.locator('#pmain .ftile.picked').count() === 1, 'the held folder is not picked');
    await ft('b').click({ modifiers: [mod] });
    await until(page, () => document.querySelectorAll('#pmain .ftile.picked').length === 2, null, 'Cmd click adds the second folder');
    const acts = await page.locator('#pbulkwrap .pbulk [data-a]').evaluateAll(l => l.map(b => b.dataset.a).join(','));
    assert(acts === 'sel-all,bulk-ftrash', 'the folder bar holds ' + acts);
    assert((await page.textContent('#pbulkwrap [data-a="bulk-ftrash"]')).trim() === 'Delete', 'the folder bar does not say Delete');
    await shot(page, `${engine}-700-folder-select`);
    await page.keyboard.press('Escape'); await ft('a').click({ modifiers: ['Shift'] }); await visible(page.locator('#pbulkwrap .pbulk'));
    await page.keyboard.press(`${mod}+a`);
    const n = await page.locator('#pmain .fscreen .ftile[data-ftile]:not(.locked)').count();
    await until(page, n => document.querySelectorAll('#pmain .ftile.picked').length === n, n, 'Cmd A picks every folder');
    await page.keyboard.press('Escape'); await gone(page.locator('#pbulkwrap .pbulk'));
    await ft('a').click({ modifiers: [mod] }); await ft('b').click({ modifiers: [mod] });
    await page.click('#pbulkwrap [data-a="bulk-ftrash"]'); await sheetOpen(page);
    assert(/Delete 2 folders\?/.test(await page.textContent('#sheet')), 'the confirm does not count 2 folders');
    await page.click('#sheet [data-a="confirm"]'); await sheetClosed(page);
    await until(page, () => ![...document.querySelectorAll('#pmain .ftile')].some(t => t.textContent.includes('ui-test fsel')), null, 'both folders gone');
    assert(!(await page.locator('#papp.selecting').count()), 'still selecting after the delete');
  });
  await check('700 px Folders screen: a folder carried onto Trash lights it and asks to delete', async () => {
    await apiIn(page, 'POST', '/api/folders', { name: 'ui-test fdrag', parent_id: null });
    await page.reload(); await page.click('.ptbar.tabs [data-tab="folders"]');
    const a = await centre(page.locator('#pmain .fscreen .ftile', { hasText: 'ui-test fdrag' })), b = await centre(page.locator('#pmain .ftrash'));
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 20, a.y + 20, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 12 });
    await visible(page.locator('#pmain .ftrash.drop-on'));
    await shot(page, `${engine}-700-folder-over-trash`, true);
    await page.mouse.up(); await sheetOpen(page);
    assert(/Delete ui-test fdrag\?/.test(await page.textContent('#sheet')), 'no delete confirm for the folder');
    await page.click('#sheet [data-a="confirm"]'); await sheetClosed(page);
    await until(page, () => ![...document.querySelectorAll('#pmain .ftile')].some(t => t.textContent.includes('ui-test fdrag')), null, 'the folder is gone');
  });
  /* parity: what one width or one input can do, the others can too */
  const paint = (from, to) => page.evaluate(async ([s, t]) => {
    const a = document.querySelector(s).getBoundingClientRect(), b = document.querySelector(t).getBoundingClientRect(); let x = a.left + a.width / 2, y = a.top + a.height / 2;
    const fire = type => (type === 'pointerdown' ? document.elementFromPoint(x, y) : document).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 44, pointerType: 'touch', isPrimary: true, button: type === 'pointermove' ? -1 : 0, clientX: x, clientY: y }));
    const wait = ms => new Promise(f => setTimeout(f, ms)), x0 = x, y0 = y, tx = b.left + b.width / 2, ty = b.top + b.height / 2;
    fire('pointerdown'); await wait(40);
    for (let i = 1; i <= 14; i++) { x = x0 + (tx - x0) * i / 14; y = y0 + (ty - y0) * i / 14; fire('pointermove'); await wait(20); }
    fire('pointerup');
  }, [from, to]);
  await check('700 px: after Select, a click on a card and a Shift click on another take the range', async () => {
    await inbox(); await page.click('#pmain .vbar [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk'));
    await card(1).click(); await until(page, () => document.querySelectorAll('#app article.picked').length === 1, null, 'the click picks one');
    await card(3).click({ modifiers: ['Shift'] });
    await until(page, () => document.querySelectorAll('#app article.picked').length === 3, null, 'a range of three from the clicked card');
  });
  await check('700 px: F2 on a focused card opens Rename, as it renames on the desktop', async () => {
    await inbox(); await card(2).locator('.pt-in').focus(); await page.keyboard.press('F2'); await sheetOpen(page);
    assert(await page.locator('#sheet form[data-name] button.save', { hasText: 'Save' }).count() === 1, 'no Rename sheet');
    assert(await page.inputValue('#sheet input[name=v]') === 'ui-test seed inbox 2', 'the field does not hold the title');
  });
  await check('700 px: the search lists Trash under Views, as on the desktop, and opens it', async () => {
    await page.keyboard.press('/'); await visible(page.locator('#pal.open')); await page.keyboard.type('Trash');
    await page.locator('#pal .pal-view[data-view="trash"]').click(); await gone(page.locator('#pal'));
    await visible(page.locator('#pmain .ptbar .ptb-t', { hasText: 'Trash' }));
  });
  await check('700 px Folders screen: a folder carried to another place saves the new order', async () => {
    for (const x of ['a', 'b']) await apiIn(page, 'POST', '/api/folders', { name: `ui-test ford ${x}`, parent_id: null });
    await page.reload(); await page.click('.ptbar.tabs [data-tab="folders"]');
    const ft = x => page.locator('#pmain .fscreen .ftile[data-ftile]', { hasText: `ui-test ford ${x}` }), order = async () => {
      const s = (await apiIn(page, 'GET', '/api/state')).data, top = s.folders.filter(f => f.parent_id == null).sort((p, q) => p.position - q.position || p.id - q.id).map(f => f.name);
      return [top.indexOf('ui-test ford a'), top.indexOf('ui-test ford b')]; };
    const [a0, b0] = await order(); assert(a0 < b0, 'a does not start before b');
    const a = await centre(ft('a')), b = await centre(ft('b'));
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 12, a.y + 6, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.waitForTimeout(200);
    await page.mouse.up(); await toastWith(page, 'Order saved');
    const [a1, b1] = await order(); assert(a1 > b1, 'the order did not change');
    assert(await page.locator('#pmain .vbar [data-a="fsort"]', { hasText: 'Your order' }).count() === 1, 'the screen is not in Your order');
  });
  await check('a finger paints a selection over folders on the 700 px Folders screen and over desktop cards at 1440', async () => {
    await page.click('.ptbar.tabs [data-tab="folders"]'); await page.click('#pmain .vbar [data-a="select"]'); await visible(page.locator('#pbulkwrap .pbulk'));
    const fa = await page.locator('#pmain .fscreen .ftile[data-ftile]', { hasText: 'ui-test ford a' }).getAttribute('data-ftile'), fb = await page.locator('#pmain .fscreen .ftile[data-ftile]', { hasText: 'ui-test ford b' }).getAttribute('data-ftile');
    await paint(`#pmain .ftile[data-ftile="${fb}"]`, `#pmain .ftile[data-ftile="${fa}"]`);
    await until(page, ([a, b]) => document.querySelector(`#pmain .ftile[data-ftile="${a}"]`).classList.contains('picked') && document.querySelector(`#pmain .ftile[data-ftile="${b}"]`).classList.contains('picked'), [fa, fb], 'both folders painted');
    assert((await page.textContent('#pbulkwrap .pbulk .n')).trim().startsWith(String(await page.locator('#pmain .ftile.picked').count())), 'the bar does not count the painted folders');
    await page.keyboard.press('Escape'); await gone(page.locator('#pbulkwrap .pbulk'));
    try { await page.setViewportSize({ width: 1440, height: 900 }); await visible(page.locator('#side .si')); await page.click('#side [data-view="inbox"]');
      const t = n => `#body article.tile[data-id="${n}"]`, ids = await page.locator('#body article.tile[data-id]').evaluateAll(l => l.map(e => e.dataset.id));
      await page.click('#tbwrap [data-a="select"]'); await visible(page.locator('#dbulk .tb.bulk'));
      assert(await page.locator(t(ids[0])).evaluate(e => getComputedStyle(e).touchAction) === 'none', 'a selecting card still scrolls under a finger');
      await paint(t(ids[0]), t(ids[2]));
      await until(page, ids => ids.slice(0, 3).every(i => document.querySelector(`#body article.tile[data-id="${i}"]`).classList.contains('picked')), ids, 'three cards painted');
      assert((await page.textContent('#dbulk .n')).trim().startsWith('3'), 'the bar does not count 3');
      await page.keyboard.press('Escape'); await gone(page.locator('#screen.selecting')); }
    finally { await page.setViewportSize({ width: 700, height: 1000 }); await visible(page.locator('#papp')); }
  });
  await check('widening from the phone Settings screen lands on the Dashboard with More open', async () => {
    await page.click('.ptbar.tabs [data-tab="dashboard"]'); await page.click('#pmain .phead .gear'); await visible(page.locator('#pmain .pset'));
    try { await page.setViewportSize({ width: 1440, height: 900 }); await visible(page.locator('#side .side-foot.open'));
      assert(await page.locator('#tbwrap .tb.dash').count() === 1, 'not the Dashboard'); }
    finally { await page.setViewportSize({ width: 700, height: 1000 }); await visible(page.locator('#papp')); }
  });
  await check('1440 px: a card carried onto the sidebar Trash lights it and goes to Trash with Undo', async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); await visible(page.locator('#side .si'));
    const made = (await apiIn(page, 'POST', '/api/bookmarks', { title: 'ui-test to trash', url: 'https://ui-test.example/seed/to-trash', folder_id: null })).data;
    await page.reload(); await page.click('#side [data-view="inbox"]');
    const c = page.locator(`#body article.tile[data-id="${made.id}"]`); await visible(c);
    const a = await centre(c), b = await centre(page.locator('#side .si.trash'));
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 20, a.y + 10, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 14 });
    await visible(page.locator('#side .si.trash.drop-on'));
    await shot(page, `${engine}-1440-card-over-trash`, true);
    await page.mouse.up(); await toastWith(page, 'Moved to Trash');
    const s = (await apiIn(page, 'GET', '/api/state')).data; assert(s.bookmarks.find(x => x.id === made.id).deleted_at, 'the card is not in Trash');
    await page.click('#toasts .toast button', { timeout: 3000 }).catch(() => {});
  });
  await check('1440 px: a mouse hold selects, and a selection carried onto Trash goes together', async () => {
    await page.click('#side [data-view="inbox"]'); await page.waitForTimeout(400); await visible(page.locator('#body article.tile', { hasText: 'ui-test seed inbox 1' }));
    await mouseHold(page.locator('#body article.tile', { hasText: 'ui-test seed inbox 1' }));
    await visible(page.locator('#dbulk .tb.bulk'));
    await page.locator('#body article.tile', { hasText: 'ui-test seed inbox 2' }).click({ position: { x: 110, y: 110 } });
    await until(page, () => document.querySelectorAll('#body article.tile.picked').length === 2, null, 'two picked');
    const a = await centre(page.locator('#body article.tile.picked').first()), b = await centre(page.locator('#side .si.trash'));
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 20, a.y + 10, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 14 });
    await page.mouse.up(); await toastWith(page, '2 moved to Trash');
    await page.click('#toasts .toast button'); await until(page, () => document.querySelectorAll('#body article.tile').length && [...document.querySelectorAll('#body article.tile')].some(t => t.textContent.includes('ui-test seed inbox 1')), null, 'Undo brings them back');
  });
  await check('no script errors', async () => assert(!errors.length, errors.join('; ')));
  beforeEach = null;
  await cleanup(page);
  await ctx.close();
}

/* one search at every width: the field at the top of the desktop and at the foot of the phone looks the same, an open
   search keeps its query and results when the layout changes, and /search?q= opens it filled at any width */
async function oneSearch(browser, engine) {
  console.log(`\n${engine}, one search across widths`);
  const word = `oneq${stamp}`, title = `ui-test ${word}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); await cleanup(page);
  await apiIn(page, 'POST', '/api/bookmarks', { title, url: `https://ui-test.example/${stamp}/one-search`, folder_id: null });
  await page.reload(); await visible(page.locator('#side .si'));
  const open = (what, layout) => until(page, ([w, l]) => { const p = document.getElementById('pq'), f = l === 'desk' ? document.getElementById('q') : document.getElementById('qt');
    return !!document.querySelector('#pal.open') && p && p.value === w && f && (f.value ?? f.textContent) === w && document.body.classList.contains(l)
      && [...document.querySelectorAll('#pal .pal-it')].some(r => r.textContent.includes('ui-test ' + w)); }, [what, layout], `${layout}: the search shows ${what} with its result`);
  const field = () => page.evaluate(() => { const f = document.querySelector('#papp .pbottom .search, #head .search'), c = getComputedStyle(f), t = f.querySelector('input, .sf-t'), k = f.querySelector('.kcap');
    return { height: c.height, radius: c.borderRadius, bg: c.backgroundColor, border: c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor, padding: c.padding, gap: c.gap,
      font: getComputedStyle(t).fontSize + ' ' + getComputedStyle(t).fontWeight + ' ' + getComputedStyle(t).fontFamily, ink: getComputedStyle(t).color, icon: getComputedStyle(f.querySelector('svg')).width,
      width: f.getBoundingClientRect().width, kcap: !!(k && k.offsetWidth), coarse: matchMedia('(pointer: coarse)').matches }; });
  const same = (a, b, where) => { for (const k of ['height', 'radius', 'bg', 'border', 'padding', 'gap', 'font', 'ink', 'icon']) assert(a[k] === b[k], `${where}: ${k} ${b[k]} against the desktop's ${a[k]}`); };
  let desk;
  await check('1440 to 600 to 1440: an open search keeps its word and results in the other place', async () => {
    desk = await field();
    await page.click('#q'); await page.keyboard.type(word); await open(word, 'desk');
    await page.setViewportSize({ width: 600, height: 900 }); await open(word, 'phone');
    assert(await page.evaluate(() => document.activeElement.id === 'pq'), 'the search field lost focus at 600');
    await page.setViewportSize({ width: 1440, height: 900 }); await open(word, 'desk');
    await page.keyboard.press('Escape'); await until(page, () => document.getElementById('pq').value === '' && !!document.querySelector('#pal.open'), null, 'the first Escape clears');
    await page.keyboard.press('Escape'); await gone(page.locator('#pal'));
    assert(await page.inputValue('#q') === '', 'the field kept the word after the search closed');
  });
  await check('600 to 1440 and back with the search open from the phone field', async () => {
    await page.setViewportSize({ width: 600, height: 900 }); await visible(page.locator('#papp'));
    await page.click('#qs'); await visible(page.locator('#pal.open')); await page.keyboard.type(word); await open(word, 'phone');
    await page.setViewportSize({ width: 1440, height: 900 }); await open(word, 'desk');
    await page.setViewportSize({ width: 600, height: 900 }); await open(word, 'phone');
    await page.click('#pal .pal-cancel'); await gone(page.locator('#pal'));
    assert(await page.textContent('#qt') === '', 'the phone field kept the word after Cancel');
    await page.setViewportSize({ width: 1440, height: 900 }); await visible(page.locator('#side .si'));
  });
  await check('the phone field is the desktop field, only its width differs; 16 px text; the / hint only with a mouse', async () => {
    assert(desk.font.startsWith('16px'), 'desktop text is ' + desk.font); assert(desk.kcap, 'no / hint on the desktop');
    await page.setViewportSize({ width: 600, height: 900 }); await visible(page.locator('#papp'));
    const p = await field(); same(desk, p, '600 mouse'); assert(p.kcap, 'no / hint at 600 with a mouse'); assert(p.width !== desk.width, 'the same width');
    const ph = await page.evaluate(() => { const t = document.getElementById('qt'); return getComputedStyle(t, '::before').color === getComputedStyle(t.closest('.search')).color && (getComputedStyle(t, '::before').content.includes('Search') || (getComputedStyle(t, '::before').content === 'attr(data-ph)' && t.dataset.ph.includes('Search'))); }); /* Firefox reports content as attr(data-ph) */
    assert(ph, 'the phone placeholder is not in the field\'s weak ink');
    await page.keyboard.press('/'); await visible(page.locator('#pal.open')); await page.keyboard.press('Escape'); await gone(page.locator('#pal'));
    await page.setViewportSize({ width: 1440, height: 900 }); await visible(page.locator('#side .si'));
  });
  const T2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US' });
  const tp = await T2.newPage(); tp.on('pageerror', e => errors.push(e.message)); await login(tp);
  await check('390 touch: the same field, no / hint where the finger is the input', async () => {
    await visible(tp.locator('#papp')); const p = await tp.evaluate(() => { const f = document.querySelector('.pbottom .search'), c = getComputedStyle(f), t = f.querySelector('.sf-t'), k = f.querySelector('.kcap');
      return { height: c.height, radius: c.borderRadius, bg: c.backgroundColor, border: c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor, padding: c.padding, gap: c.gap,
        font: getComputedStyle(t).fontSize + ' ' + getComputedStyle(t).fontWeight + ' ' + getComputedStyle(t).fontFamily, ink: getComputedStyle(t).color, icon: getComputedStyle(f.querySelector('svg')).width, kcap: !!k.offsetWidth, coarse: matchMedia('(pointer: coarse)').matches, ph: t.dataset.ph }; });
    same(desk, p, '390 touch');
    assert(p.kcap === !p.coarse, `the / hint shows ${p.kcap} with a coarse pointer ${p.coarse}`);
    if (p.coarse) assert(p.ph === 'Search bookmarks', 'touch placeholder is ' + p.ph);
  });
  for (const [w, pg, layout] of [[390, tp, 'phone'], [600, page, 'phone'], [1440, page, 'desk']]) await check(`/search?q= at ${w}${pg === tp ? ' touch' : ' mouse'} fills the search and shows the match`, async () => {
    if (pg === page) await page.setViewportSize({ width: w, height: 900 });
    await pg.goto(BASE + '/search?q=' + encodeURIComponent(word));
    await until(pg, ([w, l]) => { const p = document.getElementById('pq'); return !!document.querySelector('#pal.open') && p && p.value === w && document.body.classList.contains(l) && document.activeElement === p
      && [...document.querySelectorAll('#pal .pal-it')].some(r => r.textContent.includes('ui-test ' + w)); }, [word, layout], `the search at ${w}`);
    assert(!/#q=/.test(pg.url()), 'the query stays in the address');
    if (pg === tp) await shot(tp, `${engine}-390-search-link`);
    await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape'); await gone(pg.locator('#pal'));
  });
  await check('no script errors', async () => assert(!errors.length, errors.join('; ')));
  await cleanup(page); await T2.close(); await ctx.close();
}

/* the selection bar is one bar: the same actions in the same order with the same words at 390, 700, 1024 and 1440;
   Copy writes the clipboard, Share hands the addresses to the share sheet, or starts an email where there is none */
async function barParity(browser, engine) {
  console.log(`\n${engine}, the selection bar at 390, 700, 1024 and 1440`);
  const STUB = noShare => { window.__clip = null; window.__shared = null; window.__opened = []; window.open = u => { window.__opened.push(String(u)); return null; };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: noShare ? undefined : d => { window.__shared = d; return Promise.resolve(); } }); };
  const errors = [];
  for (const noShare of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' }); await ctx.addInitScript(STUB, noShare);
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); await login(page); await cleanup(page); await seed(page);
    const pick = async w => { await page.setViewportSize({ width: w, height: 900 }); await page.goto(BASE + '/');
      const phone = w < 720; if (phone) await page.click('.ptbar.tabs [data-tab="inbox"]'); else await page.click('#side [data-view="inbox"]');
      const card = phone ? '#pmain article.pt .pt-in' : '#body article.tile'; await visible(page.locator(card));
      await page.click(phone ? '#pmain [data-a="select"]' : '#tbwrap [data-a="select"]');
      const urls = []; for (const i of [0, 1]) { await page.locator(card).nth(i).click(); urls.push(await page.locator(phone ? '#pmain article.pt' : '#body article.tile').nth(i).evaluate(a => a.dataset.id)); }
      await page.waitForTimeout(400); return { phone, ids: urls }; };
    const bar = () => page.evaluate(() => { const b = document.querySelector('#dbulk .bulk, #pbulkwrap .pbulk');
      return [...b.querySelectorAll('button')].map(x => [x.dataset.a, x.dataset.a === 'sel-all' ? 'Select all' : x.getAttribute('aria-label') || x.textContent.trim()].join(':')).join(','); });
    const want = 'sel-all:Select all,bulk-move:Move,bulk-copy:Copy,bulk-share:Share,bulk-trash:Trash,sel-more:More actions';
    if (!noShare) for (const w of [390, 700, 1024, 1440]) await check(`${w}: Select all, Move, Copy, Share, Trash and More, in that order with those words; More holds the same items`, async () => {
      const { phone } = await pick(w); const got = await bar(); assert(got === want, w + ': ' + got);
      if (phone) for (const l of ['Copy', 'Share', 'Trash', 'More']) assert(await page.locator('#pbulkwrap .bb', { hasText: l }).count() === 1, w + ': no visible word ' + l);
      else for (const l of ['Move', 'Copy', 'Share', 'Trash', 'More']) assert(await page.locator('#dbulk .btn:not(.ic) .t:visible', { hasText: new RegExp('^' + l + '$') }).count() === 1, w + ': no visible word ' + l);
      await page.click(phone ? '#pbulkwrap [data-a="sel-more"]' : '#dbulk [data-a="sel-more"]');
      const items = phone ? (await page.locator('#sheet .sh-row').allTextContents()) : (await page.locator('.menu [role^=menuitem]').allTextContents());
      assert(items.map(x => x.trim()).join(',').match(/^(Pin|Unpin)$/), w + ': More holds ' + items.join(','));
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    });
    for (const w of noShare ? [390, 1440] : [390, 1440]) await check(`${w}: Copy writes the addresses to the clipboard; Share ${noShare ? 'starts an email with them where there is no share sheet' : 'hands them to the share sheet'}`, async () => {
      await pick(w); const s = (await apiIn(page, 'GET', '/api/state')).data;
      const sel = await page.evaluate(() => [...document.querySelectorAll('#app article.picked')].map(a => +a.dataset.id)); const urls = sel.map(id => s.bookmarks.find(b => b.id === id).url).join('\n');
      await page.click('[data-a="bulk-copy"]:visible'); await until(page, u => window.__clip === u, urls, 'the clipboard holds the addresses');
      await visible(page.locator('#toasts .toast', { hasText: '2 links copied' }));
      await page.click('[data-a="bulk-share"]:visible');
      if (noShare) await until(page, u => window.__opened.includes('mailto:?body=' + encodeURIComponent(u)), urls, 'a mailto with the addresses');
      else await until(page, u => window.__shared && window.__shared.text === u, urls, 'navigator.share with the addresses');
    });
    await cleanup(page); await ctx.close();
  }
  await check('no script errors', async () => assert(!errors.length, errors.join('; ')));
}

/* the 0.1.11 flow test fixes: waits with the real time, the stale save error, Share in the folder menu, Move with Undo,
   Close on lock dialogs, More at 800 px high, the token's next step, Export without locked folders, a busy Import,
   an unreachable server, the Firefox note and the share page wait */
async function flowFixes(browser, engine) {
  console.log(`\n${engine}, flow test fixes 1280x800`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); await cleanup(page);
  const mk = async name => (await apiIn(page, 'POST', '/api/folders', { name: `ui-test ${name} ${stamp}`, parent_id: null })).data;
  const A = await mk('fa'), B = await mk('fb');
  for (const n of ['f1', 'f2', 'f3', 'f4', 'f5']) await mk(n);
  const card = (await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test mover ${stamp}`, url: `https://ui-test.example/${stamp}/mover`, folder_id: A.id })).data;
  await page.reload(); await visible(page.locator('#side .si'));
  const openFolder = async f => { await page.click(`#side .sf[data-fid="${f.id}"]`); await until(page, n => (document.querySelector('#tbwrap h2') || {}).textContent === n, f.name, 'folder view'); };

  await check('login page: a wait says the time the server sent; the wrong try that starts it says both', async () => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c.clock.install(); const lp = await c.newPage();
    for (const [q, want] of [['error=1&wait=30', 'Wrong password. Wait 30 seconds before the next try.'], ['error=wait&wait=75', 'Too many tries. Wait 75 seconds, then try again.'], ['error=wait&wait=600', 'Too many tries. Wait 10 minutes, then try again.'], ['error=1&wait=1e9', 'Wrong password.'], ['error=1&wait=-5', 'Wrong password.'], ['error=wait&wait=Infinity', 'Too many tries. Wait a little, then try again.'], ['error=wait&wait=99999999', 'Too many tries. Wait a little, then try again.'], ['error=wait&wait=12abc', 'Too many tries. Wait a little, then try again.'], ['error=wait', 'Too many tries. Wait 30 seconds, then try again.']]) {
      await lp.goto(`${BASE}/login?${q}`); const got = (await lp.textContent('#login-err')).trim(); assert(got === want, q + ': ' + got); }
    await c.close();
  });

  await check('Add sheet: the error about the address goes as soon as the address is typed again', async () => {
    await page.click('#side [data-view="inbox"]'); await page.click('#tbwrap .add'); await sheetOpen(page);
    await page.fill('#sheet [data-f=url]', 'ftp://example.com'); await page.click('#sheet [data-a="save-go"]');
    await visible(page.locator('#sheet .fld-err', { hasText: 'Enter an address' }));
    /* the caret waits at the end of the address, so typing goes on from there (End on macOS scrolls, it does not move it) */
    await page.keyboard.type('/x');
    await gone(page.locator('#sheet .fld-err'));
    assert(await page.evaluate(() => document.activeElement && document.activeElement.dataset.f === 'url'), 'the caret left the address');
    assert(await page.inputValue('#sheet [data-f=url]') === 'ftp://example.com/x', 'typing after the error landed elsewhere: ' + await page.inputValue('#sheet [data-f=url]'));
    await page.keyboard.press('Escape'); await sheetClosed(page);
  });

  await check('folder three dots: Share is the first item and opens the share sheet', async () => {
    await openFolder(B); await page.click('#tbwrap [data-a="folder-menu"]'); await visible(page.locator('.menu'));
    const first = (await page.locator('.menu [role="menuitem"]').first().textContent()).trim();
    assert(first === 'Share', 'first item: ' + first);
    await menuItem(page, 'Share').first().click(); await sheetOpen(page);
    await visible(page.locator('#sheet [data-a="share-toggle"]'));
    await page.keyboard.press('Escape'); await sheetClosed(page);
  });

  await check('Move from a card\'s More: the toast says where with Undo, and Undo puts it back', async () => {
    await openFolder(A); const t = page.locator(`#body article[data-id="${card.id}"]`); await visible(t);
    await t.hover(); await t.locator('[data-a="more"]').click(); await menuItem(page, 'Move').first().click(); await sheetOpen(page);
    await page.locator(`#sheet [data-dest="${B.id}"]`).click(); await sheetClosed(page);
    const tt = page.locator('#toasts .toast', { hasText: `Moved to ${B.name}` }); await visible(tt);
    assert(await tt.locator('button', { hasText: 'Undo' }).count() === 1, 'no Undo');
    await tt.locator('button', { hasText: 'Undo' }).click();
    let back = false; for (let i = 0; i < 40 && !back; i++) { const b = (await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.id === card.id); back = b && b.folder_id === A.id; if (!back) await page.waitForTimeout(100); }
    assert(back, 'Undo did not put it back');
  });

  await check('lock dialogs: a Close button in the head closes them', async () => {
    await openFolder(B); await page.click('#tbwrap [data-a="folder-menu"]'); await menuItem(page, 'Lock with a password').click();
    await visible(page.locator('#layer.dialog.open #sheet'));
    const x = page.locator('#sheet .sh-head [data-a="close"][aria-label="Close"]'); await visible(x);
    /* the dialog scales in; measure once its transitions have ended */
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
    await page.waitForTimeout(50);
    const box = await x.boundingBox(); assert(box.width >= 44 && box.height >= 44, 'Close is smaller than 44 px');
    await shot(page, `${engine}-fix-lock-close`);
    await x.click(); await sheetClosed(page);
  });

  await check('1280x800: with More open the folder list keeps four folders in view, and the actions scroll in their own space', async () => {
    await openFoot(page); await page.waitForTimeout(400);
    const g = await page.evaluate(() => { const side = document.getElementById('side'), tree = side.querySelector('.side-tree'), fi = side.querySelector('.foot-in'), row = tree.querySelector('.sf');
      return { tree: tree.clientHeight, row: row ? row.getBoundingClientRect().height : 40, over: side.scrollHeight - side.clientHeight, fiScroll: fi.scrollHeight - fi.clientHeight, fiOverflow: getComputedStyle(fi).overflowY }; });
    assert(g.tree >= 4 * g.row, `the folder list shows less than four folders: ${g.tree} px for ${g.row} px rows`);
    assert(g.over <= 1, 'the sidebar overflows by ' + g.over);
    assert(g.fiScroll <= 0 || g.fiOverflow === 'auto', 'the actions are cut off without a scroll');
    await shot(page, `${engine}-fix-more-800`);
    await page.locator('#side [data-a="logout"]').scrollIntoViewIfNeeded(); await visible(page.locator('#side [data-a="logout"]'));
  });

  await check('API tokens: the new token says the next step with this address', async () => {
    await page.route('**/api/tokens', r => r.request().method() === 'POST' ? r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 99999, name: 'ui-test next', token: 'tk_uitestnext' }) }) : r.fallback());
    await openFoot(page); await page.click('#side [data-a="tokens"]'); await sheetOpen(page);
    await page.fill('#sheet form[data-token] input[name=name]', 'ui-test next'); await page.fill('#sheet form[data-token] input[name=password]', PASSWORD);
    await page.press('#sheet form[data-token] input[name=password]', 'Enter');
    await visible(page.locator('#sheet .tk-next'));
    const txt = (await page.textContent('#sheet .tk-next')).trim(), origin = new URL(BASE).origin;
    assert(txt === `Next, paste it into the extension's options with the address ${origin}, or into your script.`, 'next step: ' + txt);
    await shot(page, `${engine}-fix-token-next`);
    await page.unroute('**/api/tokens'); await page.keyboard.press('Escape'); await sheetClosed(page);
  });

  await check('Export with a folder locked in this browser says it is left out and how to include it', async () => {
    await apiIn(page, 'POST', `/api/folders/${B.id}/lock`, { password: T.lockPw });
    await page.reload(); await visible(page.locator(`#side .sf.locked[data-fid="${B.id}"]`)); await openFoot(page);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#side a[href="/api/export"]')]);
    assert(dl.suggestedFilename() === 'bookmarks.html', 'download: ' + dl.suggestedFilename());
    await toastWith(page, `Exported without ${B.name}: it is locked. Unlock it first to include it.`);
    await shot(page, `${engine}-fix-export-note`);
    await apiIn(page, 'DELETE', `/api/folders/${B.id}/lock`, { app_password: PASSWORD }); await page.reload(); await visible(page.locator('#side .si'));
  });

  await check('Import: while it runs, a toast says so and every Import is disabled and busy, also after a redraw', async () => {
    let release; const held = new Promise(r => { release = r; });
    await page.route('**/api/import', async r => { await held; await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ added: 3, skipped: 1 }) }); });
    await openFoot(page);
    await page.setInputFiles('#import-file', { name: 'b.html', mimeType: 'text/html', buffer: Buffer.from('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p></DL>') });
    await toastWith(page, 'Importing');
    await visible(page.locator('#side [data-a="import"][disabled][aria-busy="true"]'));
    await page.click('#side [data-view="inbox"]'); await page.waitForTimeout(200);
    assert(await page.locator('#side [data-a="import"][disabled]').count() === 1, 'Import came back enabled after a redraw');
    await shot(page, `${engine}-fix-import-busy`);
    release(); await toastWith(page, 'Imported 3, skipped 1');
    await until(page, () => !document.querySelector('[data-a="import"][disabled]'), null, 'Import enabled again');
    await gone(page.locator('#toasts .toast', { hasText: 'Importing' }));
    await page.unroute('**/api/import');
  });

  await check('S23.15: a "locked" in an /api/check or 409 answer, which the server never sends, changes nothing in the save sheet', async () => {
    await page.route('**/api/check?*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ duplicate: null, icon: null, locked: true }) }));
    await page.route('**/api/bookmarks', r => r.request().method() === 'POST' ? r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Already saved', duplicate: null, locked: true }) }) : r.fallback());
    await page.click('#side [data-view="inbox"]'); await page.click('#tbwrap .add'); await sheetOpen(page);
    const checked = page.waitForResponse(r => r.url().includes('/api/check'));
    await page.fill('#sheet [data-f=url]', `https://ui-test.example/${stamp}/locked-answer`);
    await checked; await page.waitForTimeout(100);
    await until(page, () => { const d = document.querySelector('#sheet .dupe'); return d && d.classList.contains('off') && d.textContent.includes('Not saved yet'); }, null, 'the status stays Not saved yet, hidden as for any new address');
    assert(!(await page.locator('#sheet [data-a="save-go"]').isDisabled()), 'Save disabled by a locked check answer');
    await page.click('#sheet [data-a="save-go"]');
    await visible(page.locator('#sheet .fld-err', { hasText: 'Already saved' }));
    assert(!(await page.locator('#sheet [data-a="save-go"]').isDisabled()), 'Save disabled by a locked 409');
    await page.keyboard.press('Escape'); await sheetClosed(page);
    await page.unroute('**/api/check?*'); await page.unroute('**/api/bookmarks');
  });

  await check('no server: a save and a load say Cannot reach your Pinned server', async () => {
    await page.route('**/api/bookmarks', r => r.request().method() === 'POST' ? r.abort('connectionrefused') : r.fallback());
    /* each wait names its step, and the save waits for the address check first, so a late check answer cannot race the
       save (WebKit timed out here once in four runs on 05.11.2026 without saying where) */
    const step = async (what, p) => { try { await p; } catch (e) { throw new Error(what + ': ' + e.message.split('\n')[0]); } };
    await page.click('#side [data-view="inbox"]'); await page.click('#tbwrap .add'); await sheetOpen(page);
    const checked = page.waitForResponse(r => r.url().includes('/api/check'), { timeout: 8000 });
    await page.fill('#sheet [data-f=url]', `https://ui-test.example/${stamp}/offline`);
    await step('the address check answers', checked);
    await page.click('#sheet [data-a="save-go"]');
    await step('the save error shows', visible(page.locator('#sheet .fld-err', { hasText: 'Cannot reach your Pinned server. Check your connection, then try again.' }), 10000));
    await page.keyboard.press('Escape'); await step('the sheet closes', sheetClosed(page)); await page.unroute('**/api/bookmarks');
    await page.route('**/api/state', r => r.abort('connectionrefused'));
    await page.reload(); await step('the load notice shows after a reload', visible(page.locator('.notice', { hasText: 'Cannot reach your Pinned server.' }), 10000));
    await shot(page, `${engine}-fix-unreachable`);
    await page.unroute('**/api/state'); await page.click('.notice [data-a="retry"]'); await step('the notice goes after Retry', gone(page.locator('.notice'), 10000));
  });

  await check('How to save, Extension: Firefox needs the add-on loaded again and a new token after a restart', async () => {
    await page.goto(BASE + '/bookmarklet'); await page.click('#t-ext');
    const n = (await page.textContent('[data-ff-note]')).trim();
    assert(n === 'Firefox removes it when it quits. After a restart, load it again and give it a new token.', 'note: ' + n);
    await shot(page, `${engine}-fix-howto-firefox`);
    await page.goto(BASE + '/'); await visible(page.locator('#side .si'));
  });

  await check('share page: a wait names the seconds the server sends', async () => {
    const sh = (await apiIn(page, 'POST', `/api/folders/${A.id}/share`, { password: 'ui-test-share-pw' })).data;
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }), sp = await c.newPage();
    await sp.route('**/unlock', r => r.fulfill({ status: 429, headers: { 'Retry-After': '90', 'Content-Type': 'application/json' }, body: '{"error":"Too many tries."}' }));
    await sp.goto(sh.url); await sp.fill('#unlock input[name=password]', 'whatever-it-is'); await sp.press('#unlock input[name=password]', 'Enter');
    await until(sp, () => (document.getElementById('uerr') || {}).textContent === 'Too many tries. Wait 90 seconds, then try again.', null, 'the wait from Retry-After');
    await c.close(); await apiIn(page, 'DELETE', `/api/shares/${encodeURIComponent(sh.token)}`);
  });

  await check('no script errors', async () => assert(!errors.length, errors.join('; ')));
  await cleanup(page); await ctx.close();
}

/* the items of 0.1.12 (docs/spec.md section 23), one check or more each */
const SMALL_OK = '.ft-faces .fav, .gc-row .fav, .ios-apps, .ios-cap'; /* letter marks in a tile and the drawing of the iOS share menu (S23.9.3) */
const smallText = page => page.evaluate(ok => { const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg, script, style, template') || el.closest(ok) || !el.getClientRects().length) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const st = getComputedStyle(el), r = el.getBoundingClientRect();
    if (st.visibility === 'hidden' || r.width <= 2 || el.closest('.vh, [hidden]')) continue;
    if (parseFloat(st.fontSize) < 12) out.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 16)}" ${st.fontSize}`);
  }
  return [...new Set(out)]; }, SMALL_OK);
async function release0112(browser, engine) {
  console.log(`\n${engine}, 0.1.12 items`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); await cleanup(page);
  const F = (await apiIn(page, 'POST', '/api/folders', { name: `ui-test r12 ${stamp}`, parent_id: null })).data;
  const L = (await apiIn(page, 'POST', '/api/folders', { name: `ui-test r12 lock ${stamp}`, parent_id: null })).data;
  const saved = (await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test r12 saved ${stamp}`, url: `https://ui-test.example/${stamp}/r12-saved`, folder_id: F.id })).data;
  await apiIn(page, 'PATCH', `/api/bookmarks/${saved.id}`, { pinned: true });
  for (const n of [1, 2]) await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test r12 card ${n}`, url: `https://ui-test.example/${stamp}/r12-${n}`, folder_id: F.id });
  const trashed = (await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test r12 trashed ${stamp}`, url: `https://ui-test.example/${stamp}/r12-trashed`, folder_id: null })).data;
  await apiIn(page, 'DELETE', `/api/bookmarks/${trashed.id}`);
  const share = (await apiIn(page, 'POST', `/api/folders/${F.id}/share`, {})).data;
  await apiIn(page, 'POST', `/api/folders/${L.id}/lock`, { password: T.lockPw });
  await page.reload(); await visible(page.locator('#side .si'));
  const cookies = await ctx.cookies();
  const phoneCtx = async (w, h, extra = {}) => { const o = { viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US', ...extra };
    if (engine !== 'firefox') o.isMobile = true; const c = await browser.newContext(o); await c.addCookies(cookies); return c; };

  await check('S23.5 360 to 440: Show the Save code takes a 44 px tap that ends at the code; below it, closed, nothing; open, the code', async () => {
    for (const w of [360, 390, 430, 440]) { const c = await phoneCtx(w, 800); const p = await c.newPage();
      try {
        await p.goto(BASE + '/bookmarklet'); await visible(p.locator('.hs-code summary'));
        const probe = () => p.evaluate(() => { const sm = document.querySelector('.hs-code summary'); sm.scrollIntoView({ block: 'center' });
          const r = sm.getBoundingClientRect(), a = getComputedStyle(sm, '::after'), x = r.left + 12;
          const bottom = r.bottom - parseFloat(a.bottom), top = bottom - parseFloat(a.height);
          const at = y => document.elementFromPoint(x, y);
          const inSum = y => { const e = at(y); return !!e && e.closest('summary') === sm; };
          const below = at(bottom + 1);
          return { h: bottom - top, top: inSum(top + 0.5), bot: inSum(bottom - 0.5), out: !inSum(bottom + 1), below: below ? (below.closest('code') ? 'code' : below.closest('a, button, summary, input, [role=button]') ? 'control' : 'none') : 'none', textH: r.height }; });
        const shut = await probe();
        assert(shut.h >= 44 && shut.top && shut.bot && shut.out, w + ' closed: ' + JSON.stringify(shut));
        assert(shut.below === 'none', w + ': under the closed summary sits ' + shut.below);
        await p.tap('.hs-code summary'); await visible(p.locator('.hs-code code'));
        const open = await probe();
        assert(open.h >= 44 && open.top && open.bot && open.below === 'code', w + ' open: ' + JSON.stringify(open));
        if (w === 390) await shot(p, `${engine}-r12-save-code-390`);
      } finally { await c.close(); } }
  });

  await check('S23.6 Add sheet with an already saved address: at 360x780 the Folder row shows whole above the foot; it grows no further than the end of the Folder row, so where the row fits in 60 percent the sheet keeps that bound; with the keyboard stand-in (--vvh, --kb) the sheet keeps its top and Save in view at 360, 390 and 440', async () => {
    for (const [w, h] of [[360, 780], [390, 844], [440, 956]]) { const c = await phoneCtx(w, h); const p = await c.newPage();
      try {
        await p.goto(BASE + '/'); await visible(p.locator('#papp .ptbar.tabs'));
        await p.tap('.pbottom .padd'); await sheetOpen(p);
        await p.fill('#sheet [data-f=url]', saved.url); await visible(p.locator('#sheet .dupe:not(.off)'));
        await p.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); await p.waitForTimeout(100);
        const g = await p.evaluate(() => { const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
          const body = r('#sheet .sh-body'), lbl = r('#sheet #sv-fl'), row = r('#sheet .sv-folder .fpick'), sheet = r('#sheet');
          return { body: [body.top, body.bottom], lbl: [lbl.top, lbl.bottom], row: row && row.height ? [row.top, row.bottom] : null, sheetH: sheet.height, sheetTop: sheet.top, vvh: innerHeight }; });
        assert(g.row && g.lbl[0] >= g.body[0] && g.row[1] <= g.body[1] + 0.5, w + ': the Folder row is cut: ' + JSON.stringify(g));
        const need = await p.evaluate(() => parseFloat(document.querySelector('#sheet').style.getPropertyValue('--sv-need')) || 0);
        assert(need > 0 && g.sheetH <= Math.max(0.6 * h, need) + 1, w + ': the sheet is taller than 60 percent or the Folder row needs: ' + JSON.stringify({ h: g.sheetH, need }));
        if (w === 360) await shot(p, `${engine}-r12-add-sheet-360`);
        /* the keyboard stand-in: what phone.js sets when a 336 px keyboard is up (S23.6.3) */
        await p.evaluate(kb => { const d = document.documentElement.style; d.setProperty('--vvh', (innerHeight - kb) + 'px'); d.setProperty('--kb', kb + 'px'); }, 336);
        await p.waitForTimeout(100);
        const k = await p.evaluate(kb => { const s = document.querySelector('#sheet').getBoundingClientRect(), b = document.querySelector('#sheet [data-a="save-go"]').getBoundingClientRect(), x = document.querySelector('#sheet [data-a="close"]').getBoundingClientRect();
          return { top: s.top, bottom: s.bottom, save: [b.top, b.bottom], close: x.top, vis: innerHeight - kb }; }, 336);
        assert(k.top >= 0 && k.close >= 0 && k.save[0] >= 0 && k.save[1] <= k.vis + 0.5 && Math.abs(k.bottom - k.vis) < 1, w + ' keyboard: ' + JSON.stringify(k));
        if (w === 360) await shot(p, `${engine}-r12-add-sheet-360-keyboard`);
      } finally { await c.close(); } }
  });

  await check('S23.7 phone, server unreachable at the first load, 390 and 320: the head with the gear shows and opens Settings, the notice shows, and no "0 bookmarks" before the data', async () => {
    for (const [w, h] of [[390, 844], [320, 640]]) { const c = await phoneCtx(w, h); const p = await c.newPage();
      try {
        await p.route('**/api/state', r => r.abort('connectionrefused'));
        await p.goto(BASE + '/'); await visible(p.locator('.pnotice', { hasText: 'Cannot reach your Pinned server.' }));
        await visible(p.locator('#pmain .phead .gear')); await visible(p.locator('#pmain .phead .bulb'));
        if (w === 390) await shot(p, `${engine}-r12-unreachable-390`);
        await p.tap('#pmain .phead .gear');
        await until(p, () => (document.querySelector('.ptb-t') || {}).textContent === 'Settings', null, 'settings screen');
        const sum = (await p.textContent('.pset .pset-sum')).trim();
        assert(!/bookmark|folder/.test(sum), w + ': the summary reads "' + sum + '" before any data');
        await p.unroute('**/api/state');
      } finally { await c.close(); } }
    /* while loading, the head is there too, and with the data the summary counts */
    const c = await phoneCtx(390, 844); const p = await c.newPage();
    try {
      let go; const held = new Promise(r => { go = r; });
      await p.route('**/api/state', async r => { await held; await r.fallback(); });
      await p.goto(BASE + '/'); await visible(p.locator('#pmain .phead .gear')); await visible(p.locator('#pmain .pgrid[aria-busy="true"]'));
      go(); await visible(p.locator('#pmain .precent')); await p.tap('#pmain .phead .gear');
      await until(p, () => /bookmarks? in \d+ folders?/.test((document.querySelector('.pset .pset-sum') || {}).textContent || ''), null, 'the summary with the data');
    } finally { await c.close(); }
  });

  await check('S23.9 no text below 12 px: desktop Dashboard, a folder, More and What\'s new; phone Dashboard, a folder and Settings; the 320 selection bar keeps every word on one line', async () => {
    const found = [];
    await page.click('#side [data-view="dashboard"]'); await page.waitForTimeout(300); found.push(...(await smallText(page)).map(x => 'dashboard ' + x));
    await page.click(`#side .sf[data-fid="${F.id}"]`); await visible(page.locator('#body article.tile')); found.push(...(await smallText(page)).map(x => 'folder ' + x));
    await openFoot(page); found.push(...(await smallText(page)).map(x => 'more ' + x));
    await page.click('#side .app-ver'); await visible(page.locator('#sheet .rel'));
    const code = await page.evaluate(() => { const c = document.querySelector('#sheet .rel code'); return c ? parseFloat(getComputedStyle(c).fontSize) : 12; });
    found.push(...(await smallText(page)).map(x => 'whats-new ' + x)); if (code < 12) found.push('whats-new code ' + code);
    await page.keyboard.press('Escape'); await sheetClosed(page);
    const c = await phoneCtx(390, 844); const p = await c.newPage();
    try {
      await p.goto(BASE + '/'); await visible(p.locator('#pmain .precent')); found.push(...(await smallText(p)).map(x => 'phone dashboard ' + x));
      await p.evaluate(id => { window.Pinned.U.view = id; window.Pinned.render(); }, F.id); await visible(p.locator('#pmain article.pt')); found.push(...(await smallText(p)).map(x => 'phone folder ' + x));
      await p.evaluate(() => { window.Pinned.U.view = 'settings'; window.Pinned.render(); }); await visible(p.locator('.pset')); found.push(...(await smallText(p)).map(x => 'phone settings ' + x));
      assert(!found.length, found.join('; '));
      await p.setViewportSize({ width: 320, height: 640 });
      for (const v of ['trash', F.id]) {
        await p.evaluate(v => { window.Pinned.U.view = v; window.Pinned.render(); }, v); await visible(p.locator('#pmain article.pt'));
        await p.tap('#pmain [data-a="select"]'); await p.locator('#pmain article.pt .pt-in').first().tap(); await visible(p.locator('#pbulkwrap .pbulk .bb:not([disabled])'));
        const bb = await p.evaluate(() => [...document.querySelectorAll('#pbulkwrap .bb')].map(b => { const t = [...b.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()), rg = document.createRange(); rg.selectNodeContents(t);
          const q = [...rg.getClientRects()], r = b.getBoundingClientRect(); return { t: t.textContent.trim(), lines: new Set(q.map(x => Math.round(x.top))).size, in: q.every(x => x.left >= r.left - 0.1 && x.right <= r.right + 0.1), fs: parseFloat(getComputedStyle(b).fontSize) }; }));
        const bad = bb.filter(b => b.lines !== 1 || !b.in || b.fs < 12);
        assert(!bad.length, v + ' at 320: ' + JSON.stringify(bad));
        if (v === 'trash') await shot(p, `${engine}-r12-bar-320-trash`);
        await p.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(p.locator('#pbulkwrap .pbulk'));
      }
    } finally { await c.close(); }
  });

  await check('S23.10 lock dialog: the note sits 6 px below the Repeat password field, at 1440 and 390', async () => {
    const gap = q => q.evaluate(() => { const f = document.querySelector('#sheet input[name=pw2]').closest('.fld').getBoundingClientRect(), n = document.querySelector('#sheet .fld + .sh-text').getBoundingClientRect(); return n.top - f.bottom; });
    await page.click(`#side .sf[data-fid="${F.id}"]`); await page.click('#tbwrap [data-a="folder-menu"]'); await menuItem(page, 'Lock with a password').click();
    await visible(page.locator('#layer.dialog.open #sheet input[name=pw2]')); await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
    const d = await gap(page); await shot(page, `${engine}-r12-lock-1440`); await page.keyboard.press('Escape'); await sheetClosed(page);
    assert(Math.abs(d - 6) < 0.5, '1440: the note is ' + d + ' px below the field');
    const c = await phoneCtx(390, 844); const p = await c.newPage();
    try {
      await p.goto(BASE + '/'); await visible(p.locator('#papp .ptbar.tabs'));
      await p.evaluate(id => { window.Pinned.U.view = id; window.Pinned.render(); }, F.id); await p.tap('#pmain [data-a="folder-menu"]');
      await p.locator('#sheet .sh-row', { hasText: 'Lock with a password' }).first().tap();
      await visible(p.locator('#layer.dialog.open #sheet input[name=pw2]')); await p.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
      const m = await gap(p); await shot(p, `${engine}-r12-lock-390`);
      assert(Math.abs(m - 6) < 0.5, '390: the note is ' + m + ' px below the field');
    } finally { await c.close(); }
  });

  await check('S23.11 and the review\'s item 3: the spoken names hold the visible ones: sidebar folders "name count" or "name locked", the phone pinned row and the share page cards', async () => {
    const side = await page.evaluate(() => [...document.querySelectorAll('#side .sf')].map(b => { const n = b.querySelector('.si-n').textContent, c = b.querySelector('.si-c'), lk = c && c.classList.contains('si-lock');
      const vis = [...b.childNodes].map(x => x.nodeType === 3 ? x.textContent : x.matches('.si-n, .si-c') ? x.textContent : '').join('').replace(/\s+/g, ' ').trim();
      return { label: b.getAttribute('aria-label'), want: n + ' ' + (lk ? 'locked' : c.textContent), vis, lk }; }));
    assert(side.length >= 2 && side.every(r => r.label === r.want && r.label.startsWith(r.vis)), 'sidebar: ' + JSON.stringify(side.filter(r => r.label !== r.want || !r.label.startsWith(r.vis))));
    assert(side.some(r => r.lk && / locked$/.test(r.label)), 'no locked folder named "<name> locked"');
    const c = await phoneCtx(390, 844); const p = await c.newPage();
    try {
      await p.goto(BASE + '/'); await visible(p.locator('#pmain .precent .prc'));
      const pr = await p.evaluate(t => { const a = [...document.querySelectorAll('#pmain .prc')].find(x => x.querySelector('.prc-l').textContent === t);
        return a && { label: a.getAttribute('aria-label'), icon: a.querySelector('.prc-ic').getAttribute('aria-hidden'), vh: (a.querySelector('.vh') || {}).textContent }; }, saved.title);
      assert(pr && pr.label === null && pr.icon === 'true' && pr.vh === ', pinned', 'pinned row: ' + JSON.stringify(pr));
      await p.goto(share.url); await visible(p.locator('#share article.pt .pt-in'));
      const sc = await p.evaluate(() => [...document.querySelectorAll('#share article.pt .pt-in')].map(a => ({ label: a.getAttribute('aria-label'), fav: a.querySelector('.fav').getAttribute('aria-hidden'), strip: a.querySelector('.pt-strip').getAttribute('aria-hidden'), sep: (a.querySelector('.pt-main .vh') || {}).textContent })));
      assert(sc.length === 3 && sc.every(x => x.label === null && x.fav === 'true' && x.strip === 'true' && x.sep === ', '), 'share cards: ' + JSON.stringify(sc));
    } finally { await c.close(); }
  });

  await check('S23.13 What\'s new marks "This version" for the running v-tagged version, beside that heading only; not for dev or a missing version', async () => {
    const md = await page.evaluate(async () => (await fetch('/changelog', { credentials: 'same-origin' })).text());
    const first = (md.match(/^## (\S+?)(?:, \d{4}-\d{2}-\d{2})?\s*$/m) || [])[1]; assert(first, 'no release heading in /changelog');
    const was = await page.evaluate(() => window.Pinned.U.version);
    const marks = async (v, keep) => { await page.evaluate(v => { window.Pinned.U.version = v; window.Pinned.render(); }, keep ? 'dev' : v);
      await openFoot(page); await page.click('#side .app-ver');
      if (keep) await page.evaluate(v => { window.Pinned.U.version = v; }, v);
      await visible(page.locator('#sheet .rel'));
      const m = await page.evaluate(() => [...document.querySelectorAll('#sheet .rel-now')].map(n => [n.textContent, n.closest('.rel').querySelector('.rel-v').textContent]));
      await page.keyboard.press('Escape'); await sheetClosed(page); return m; };
    try {
      const a = await marks('v' + first); assert(a.length === 1 && a[0][0] === 'This version' && a[0][1] === first, 'v' + first + ': ' + JSON.stringify(a));
      const b = await marks(first); assert(b.length === 1 && b[0][1] === first, first + ': ' + JSON.stringify(b));
      const d = await marks('dev'); assert(!d.length, 'dev: ' + JSON.stringify(d));
    } finally { await page.evaluate(v => { window.Pinned.U.version = v; window.Pinned.render(); }, was); }
    /* without a version (null until /health answers) the sheet still draws: the button that opens it is shown for a version, so it is opened with one and the version taken away before the releases draw */
    await page.route('**/changelog', async r => { await new Promise(ok => setTimeout(ok, 300)); await r.fallback(); });
    try { const n = await marks(null, true); assert(!n.length, 'null: ' + JSON.stringify(n)); }
    finally { await page.unroute('**/changelog'); await page.evaluate(v => { window.Pinned.U.version = v; window.Pinned.render(); }, was); }
  });

  await check('no script errors', async () => assert(!errors.length, errors.join('; ')));
  await cleanup(page); await ctx.close();
}

/* 0.1.13 (spec S24): the wait counts down, an address gets its scheme, the folder list scroll bar, the phone tip,
   Signed in rows told apart, a browser signed out elsewhere leaves while in view, the token form stays */
async function release0113(browser, engine) {
  console.log(`\n${engine}, 0.1.13`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); await cleanup(page); await seed(page); await page.reload(); await visible(page.locator('#side .si'));

  await check('S24.1 login page: the wait counts down to zero, then Log in works again; the address forgets the error', async () => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c.clock.install(); const lp = await c.newPage();
    try {
      const err = async () => (await lp.textContent('#login-err')).trim();
      await lp.goto(`${BASE}/login?next=%2Fx&error=1&wait=3`);
      assert(await err() === 'Wrong password. Wait 3 seconds before the next try.', 'start: ' + await err());
      assert(await lp.locator('button[type=submit]').isDisabled(), 'Log in is not disabled during the wait');
      /* the first message is written while the line is an alert; the role goes right after, before the first tick */
      await c.clock.runFor(1000); assert(await err() === 'Wrong password. Wait 2 seconds before the next try.', 'after 1 s: ' + await err());
      assert(await lp.getAttribute('#login-err', 'role') === null, 'the ticks are announced: role is still alert');
      await lp.fill('input[name=password]', 'typed ahead'); assert(await lp.inputValue('input[name=password]') === 'typed ahead', 'the password field is not editable during the wait');
      await c.clock.runFor(2000);
      assert(await err() === '', 'after 3 s the line is not empty: ' + await err());
      assert(!(await lp.locator('button[type=submit]').isDisabled()), 'Log in is still disabled');
      assert((await lp.textContent('#login-live')).trim() === 'You can try again now.', 'the closing line was not said');
      assert(await lp.getAttribute('#login-err', 'role') === 'alert', 'the alert role did not come back');
      const q = new URL(lp.url()).searchParams; assert(q.get('next') === '/x' && !q.has('error') && !q.has('wait'), 'address: ' + lp.url());
      await lp.goto(`${BASE}/login?error=wait&wait=125`);
      assert(await err() === 'Too many tries. Wait 3 minutes, then try again.', '125 s: ' + await err());
      await c.clock.runFor(5000); assert(await err() === 'Too many tries. Wait 2 minutes, then try again.', '120 s left: ' + await err());
      await c.clock.runFor(1000); assert(await err() === 'Too many tries. Wait 119 seconds, then try again.', '119 s left: ' + await err());
      await lp.goto(`${BASE}/login?error=1`); assert(await lp.getAttribute('#login-err', 'role') === 'alert', 'a new message after the wait is not an alert');
      /* longer than the password limiter ever waits (a made up link, or the code backoff): it counts down, Log in stays usable */
      for (const w of ['601', '86400']) { await lp.goto(`${BASE}/login?error=wait&wait=${w}`);
        assert(!(await lp.locator('button[type=submit]').isDisabled()), `wait=${w} disabled Log in`); }
      await lp.goto(`${BASE}/login?error=wait&wait=600`); assert(await lp.locator('button[type=submit]').isDisabled(), 'wait=600 did not disable Log in');
      for (const w of ['1e9', '-5', 'Infinity', '99999999', '12abc']) { await lp.goto(`${BASE}/login?error=1&wait=${encodeURIComponent(w)}`);
        assert(await err() === 'Wrong password.', w + ': ' + await err()); assert(!(await lp.locator('button[type=submit]').isDisabled()), w + ' started a wait'); }
    } finally { await c.close(); }
  });

  await check('S24.2 Add sheet: an address without a scheme is saved with one, http:// on the own network; the rest is refused', async () => {
    const sent = [];
    await page.route('**/api/bookmarks', async r => { if (r.request().method() !== 'POST') return r.fallback(); const b = r.request().postDataJSON(); sent.push(b.url);
      r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 999990 + sent.length, title: b.title, url: b.url, folder_id: null, position: 0, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) }) }); });
    try {
      await page.click('#side [data-view="inbox"]');
      const open = async () => { await page.click('#tbwrap .add'); await sheetOpen(page); };
      const want = [['example.com', 'https://example.com'], ['localhost:8080', 'http://localhost:8080'], ['192.168.1.5:9000', 'http://192.168.1.5:9000'], ['10.1:9000', 'http://10.1:9000'], ['nas.local', 'http://nas.local'], ['[::1]:9095', 'http://[::1]:9095'], ['nas.tailnet.ts.net', 'https://nas.tailnet.ts.net']];
      for (const [typed, url] of want) { await open(); await page.fill('#sheet [data-f=url]', typed); await page.click('#sheet [data-a="save-go"]'); await sheetClosed(page);
        assert(sent[sent.length - 1] === url, `${typed} was sent as ${sent[sent.length - 1]}`); }
      const n = sent.length;
      for (const typed of ['mailto:a@b.c', 'javascript:alert(1)', 'user@host', 'https//example.com', 'http//nas']) { await open(); await page.fill('#sheet [data-f=url]', typed); await page.click('#sheet [data-a="save-go"]');
        await visible(page.locator('#sheet .fld-err', { hasText: 'Enter an address, such as example.com or 10.0.0.5:9000.' }));
        await page.keyboard.press('Escape'); await sheetClosed(page); }
      assert(sent.length === n, 'a refused address was sent: ' + sent.slice(n).join(', '));
    } finally { await page.unroute('**/api/bookmarks'); }
  });

  await check('S24.4 sidebar: with More open at 800 px high the folder list scrolls and shows a thin scroll bar; no rule hides it in WebKit', async () => {
    for (let i = 1; i <= 9; i++) await apiIn(page, 'POST', '/api/folders', { name: `ui-test sb${i} ${stamp}`, parent_id: null });
    await page.reload(); await visible(page.locator('#side .si')); await openFoot(page); await page.waitForTimeout(400);
    const g = await page.evaluate(() => { const t = document.querySelector('#side .side-tree'); return { w: getComputedStyle(t).scrollbarWidth, scrolls: t.scrollHeight > t.clientHeight }; });
    assert(g.scrolls, 'the folder list does not scroll, so the check proves nothing');
    assert(g.w === 'thin', 'scrollbar-width: ' + g.w);
    /* read as text: Firefox drops ::-webkit-scrollbar rules when it parses, so the style sheets cannot show them there */
    const css = await page.evaluate(async () => (await fetch('/static/app.css')).text());
    assert(!/\.side-tree::-webkit-scrollbar/.test(css), 'a rule hides the folder list scroll bar in WebKit');
  });

  await check('S24.7 Signed in: each row says the minute it signed in, local time; Sign out names differ', async () => {
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } }), op = await other.newPage();
    try {
      await login(op);
      await openFoot(page); await page.click('#side [data-a="sessions"]'); await sheetOpen(page); await visible(page.locator('#sheet .tk-row', { hasText: 'This browser' }));
      await until(page, () => document.querySelectorAll('#sheet .tk-row').length >= 2, null, 'two rows');
      const rows = (await page.locator('#sheet .tk-row .tk-m').allTextContents()).map(x => x.trim());
      const re = /^(This browser, signed in|Signed in) on \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)( \d{4})? at \d\d:\d\d(, last used .+)?$/;
      assert(rows.every(r => re.test(r)), 'rows: ' + JSON.stringify(rows));
      await page.keyboard.press('Escape'); await sheetClosed(page);
    } finally { await other.close(); }
    for (const tz of ['UTC', 'America/Los_Angeles']) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: tz, storageState: await ctx.storageState() }), p = await c.newPage();
      try {
        await p.goto(BASE + '/'); await visible(p.locator('#side .si'));
        const [a, b] = await p.evaluate(() => [[9, 5], [14, 32]].map(([h, m]) => { const d = new Date(); d.setHours(h, m, 0, 0); return Math.floor(d / 1000); }));
        const now = Math.floor(Date.now() / 1000);
        await p.route('**/api/sessions', r => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
          { id: 990001, browser: 'Safari on macOS', created_at: now - 60, used_at: now, current: true },
          { id: 990002, browser: 'Chrome on macOS', created_at: a, used_at: now - 30, current: false },
          { id: 990003, browser: 'Chrome on macOS', created_at: b, used_at: now - 30, current: false }]) }) : r.fallback());
        await openFoot(p); await p.click('#side [data-a="sessions"]'); await sheetOpen(p); await until(p, () => document.querySelectorAll('#sheet .tk-row').length === 3, null, 'three rows');
        const m = (await p.locator('#sheet .tk-row .tk-m').allTextContents()).map(x => x.trim());
        assert(/^Signed in on \d{1,2} \w{3}( \d{4})? at 09:05, last used just now$/.test(m[1]) && /^Signed in on \d{1,2} \w{3}( \d{4})? at 14:32, last used just now$/.test(m[2]), tz + ': ' + JSON.stringify(m));
        const names = await p.locator('#sheet [data-a="ss-end"]').evaluateAll(bs => bs.map(x => x.getAttribute('aria-label')));
        assert(names.length === 2 && names[0] !== names[1] && /^Sign out Chrome on macOS, signed in on .+ at 09:05$/.test(names[0]), tz + ' names: ' + JSON.stringify(names));
        await p.locator('#sheet [data-a="ss-end"]').first().click();
        await until(p, () => /^Sign out Chrome on macOS, signed in on .+ at 09:05$/.test((document.querySelector('#sheet form[data-session] .sh-lbl') || {}).textContent || ''), null, 'the confirm label names the sign in time');
      } finally { await c.close(); }
    }
  });

  await check('S24.8 a browser signed out elsewhere leaves for the login within 30 s while in view; hidden, it asks nothing; proxy answers keep it', async () => {
    const mk = async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c.clock.install(); const p = await c.newPage(); await login(p); await visible(p.locator('#side .si')); return [c, p]; };
    let [c, b] = await mk();
    try {
      const mine = (await apiIn(b, 'GET', '/api/sessions')).data.find(x => x.current);
      const r = await apiIn(page, 'DELETE', `/api/sessions/${mine.id}`, { password: PASSWORD }); assert(r.status < 300, 'ending B: ' + r.status);
      await c.clock.runFor(31000);
      await until(b, () => location.pathname === '/login', null, 'B did not leave for the login');
      assert(new URL(b.url()).searchParams.get('next') === '/', 'next: ' + b.url());
      assert(!(await b.locator('article[data-id]').count()), 'cards still in B');
    } finally { await c.close(); }
    [c, b] = await mk();
    try {
      let asked = 0; b.on('request', q => { if (new URL(q.url()).pathname === '/health') asked++; });
      await b.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await c.clock.runFor(60000); await b.waitForTimeout(200);
      assert(asked === 0, `asked /health ${asked} times while hidden`);
    } finally { await c.close(); }
    [c, b] = await mk();
    try {
      for (const res of [{ status: 200, contentType: 'text/html', body: '<html>proxy login</html>' }, { status: 502, contentType: 'text/html', body: 'bad gateway' }, { status: 200, contentType: 'application/json', body: '{"ok":true,"version":""}' }]) {
        let hits = 0; await b.route('**/health', r => { hits++; r.fulfill(res); }); await c.clock.runFor(31000); await b.waitForTimeout(200);
        assert(hits >= 1, `the poll did not ask /health under ${res.status} ${res.body}`);
        assert(new URL(b.url()).pathname === '/', `left the app on ${res.status} ${res.body}`); await b.unroute('**/health'); }
    } finally { await c.close(); }
  });

  await check('S24.9 API tokens: after Create the form stays, empty, for a second token; Copy has focus', async () => {
    await openFoot(page); await page.click('#side [data-a="tokens"]'); await sheetOpen(page);
    const made = async name => { await page.fill('#sheet form[data-token] input[name=name]', name); await page.fill('#sheet form[data-token] input[name=password]', PASSWORD);
      await page.press('#sheet form[data-token] input[name=password]', 'Enter'); await until(page, n => (document.querySelector('#sheet .tk-new .sh-lbl') || {}).textContent === n, name, 'the new token ' + name); };
    await made(`ui-test token A ${stamp}`);
    assert(await page.locator('#sheet form[data-token]').count() === 1, 'the form is gone after Create');
    { const nv = await page.inputValue("#sheet form[data-token] input[name=name]"), pv = await page.inputValue("#sheet form[data-token] input[name=password]"); assert(nv === "" && pv === "", "the form is not empty: " + JSON.stringify([nv, pv.length])); }
    assert(await page.evaluate(() => document.activeElement && document.activeElement.dataset.a === 'tk-copy'), 'Copy has no focus');
    const first = (await page.textContent('#sheet .tk-val')).trim();
    await made(`ui-test token B ${stamp}`);
    assert((await page.textContent('#sheet .tk-val')).trim() !== first, 'the second token shows the first value');
    await until(page, s => [...document.querySelectorAll('#sheet .tk-row .tk-n')].filter(n => n.textContent.includes(s)).length === 2, stamp, 'both tokens listed');
    await shot(page, `${engine}-0113-token-second`);
    await page.keyboard.press('Escape'); await sheetClosed(page); await cleanup(page);
  });

  await check('no script errors', async () => assert(!errors.length, errors.join('; ')));

  /* the phone tip: its own contexts, made with { tip: true } */
  const phoneCtx = async (w = 390) => { const c = await browser.newContext({ tip: true, viewport: { width: w, height: 844 }, hasTouch: true, locale: 'en-US', ...(engine !== 'firefox' ? { isMobile: true } : {}), storageState: { cookies: (await ctx.storageState()).cookies, origins: [] } }); return [c, await c.newPage()]; };
  await seed(page);
  const f = (await apiIn(page, 'POST', '/api/folders', { name: `ui-test tipf ${stamp}`, parent_id: null })).data;
  await apiIn(page, 'POST', '/api/folders', { name: `ui-test tipsub ${stamp}`, parent_id: f.id });
  await apiIn(page, 'POST', '/api/bookmarks', { title: `ui-test tip card ${stamp}`, url: `https://ui-test.example/${stamp}/tip`, folder_id: f.id });
  await check('S24.5 phone tip: first in the view on Dashboard, Inbox and a folder, a note in the flow; not on Folders or Settings; a tap ends it for good', async () => {
    const [c, p] = await phoneCtx();
    try {
      await p.goto(BASE + '/'); const tip = p.locator('#pmain .bd > .ptip:first-child'); await visible(tip);
      const g = await tip.evaluate(t => ({ text: t.querySelector('span').textContent, role: t.getAttribute('role'), pos: getComputedStyle(t).position, close: t.querySelector('button').getAttribute('aria-label') }));
      assert(g.text === 'Tip: hold a card to select it.' && g.role === 'note' && g.pos === 'static' && g.close === 'Close tip', JSON.stringify(g));
      await shot(p, `${engine}-0113-phone-tip`);
      await p.tap('#pmain .ptab[data-tab="inbox"]'); await visible(tip);
      await p.tap('#pmain .ptab[data-tab="folders"]'); await p.waitForTimeout(300); assert(!(await p.locator('#pmain .ptip').count()), 'tip on Folders');
      await p.locator(`#pmain [data-ftile="${f.id}"]`).first().tap(); await visible(tip);
      assert(await p.evaluate(() => { const t = document.querySelector('#pmain .bd > .ptip'); return !!t && !!t.nextElementSibling; }), 'the tip is not above the folder section');
      await p.evaluate(() => { window.Pinned.U.view = 'settings'; window.Pinned.render(); }); await p.waitForTimeout(200); assert(!(await p.locator('#pmain .ptip').count()), 'tip on Settings');
      await p.evaluate(() => { window.Pinned.U.view = 'inbox'; window.Pinned.render(); }); await visible(tip);
      await tip.locator('span').tap(); await gone(p.locator('#pmain .ptip'));
      assert(await p.evaluate(() => localStorage.getItem('pinned.tip-hold')) === '1', 'the flag is not set');
      await p.reload(); await visible(p.locator('#pmain article[data-id]')); assert(!(await p.locator('#pmain .ptip').count()), 'the tip is back after a reload');
    } finally { await c.close(); }
  });
  await check('S24.5 phone tip: a hold that starts selecting ends it, nothing moves; a tap closes it and keeps the selection; it stays gone', async () => {
    const [c, p] = await phoneCtx();
    try {
      await p.goto(BASE + '/'); await p.tap('#pmain .ptab[data-tab="inbox"]'); await visible(p.locator('#pmain .bd > .ptip')); await visible(p.locator('#pmain article.pt .pt-in'));
      const top = () => p.evaluate(() => document.querySelector('#pmain .bd > .ptip').nextElementSibling.getBoundingClientRect().top);
      const t0 = await top();
      await p.evaluate(async () => { const el = document.querySelector('#pmain article.pt .pt-in'), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const fire = (type, target) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 42, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y }));
        fire('pointerdown', document.elementFromPoint(x, y) || el); await new Promise(f => setTimeout(f, 600)); fire('pointerup', document); });
      await visible(p.locator('#pbulkwrap .pbulk')); await p.waitForTimeout(400);
      assert(await p.evaluate(() => localStorage.getItem('pinned.tip-hold')) === '1', 'the flag is not set by the hold');
      assert(await p.locator('#pmain .ptip').count() === 1, 'the tip went while selecting');
      assert(Math.abs(await top() - t0) < 1, `the content under the tip moved by ${await top() - t0} px`);
      /* a tap on the tip while selecting closes the tip and keeps the selection */
      await p.locator('#pmain .ptip span').tap(); await gone(p.locator('#pmain .ptip'));
      assert(await p.locator('#pbulkwrap .pbulk').isVisible(), 'a tap on the tip ended the selection');
      await p.tap('#pmain [data-a="select"][aria-pressed="true"]'); await gone(p.locator('#pbulkwrap .pbulk'));
      await p.tap('#pmain .ptab[data-tab="dashboard"]'); await p.waitForTimeout(250); await p.tap('#pmain .ptab[data-tab="inbox"]'); await p.waitForTimeout(250);
      assert(!(await p.locator('#pmain .ptip').count()), 'the tip is still there after a change of view');
      await p.reload(); await visible(p.locator('#pmain article[data-id]')); assert(!(await p.locator('#pmain .ptip').count()), 'the tip is back after a reload');
    } finally { await c.close(); }
  });
  await check('S24.5 phone tip: none with 2 bookmarks; at 320 px whole, nothing overflows; never on the desktop', async () => {
    let [c, p] = await phoneCtx();
    try {
      await p.route('**/api/state', async r => { const res = await r.fetch(), j = await res.json(); let n = 0; j.bookmarks = j.bookmarks.filter(b => !b.deleted_at && n++ < 2); r.fulfill({ response: res, json: j }); });
      await p.goto(BASE + '/'); await p.tap('#pmain .ptab[data-tab="inbox"]').catch(() => {}); await p.waitForTimeout(600);
      assert(!(await p.locator('#pmain .ptip').count()), 'tip with 2 bookmarks');
    } finally { await c.close(); }
    [c, p] = await phoneCtx(320);
    try {
      await p.goto(BASE + '/'); await p.tap('#pmain .ptab[data-tab="inbox"]'); const tip = p.locator('#pmain .bd > .ptip'); await visible(tip);
      const g = await tip.evaluate(t => { const s = t.querySelector('span'), r = t.getBoundingClientRect(); return { right: r.right, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, clip: s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1 }; });
      assert(g.right <= g.vw && g.sw <= g.vw && !g.clip, '320: ' + JSON.stringify(g));
      await shot(p, `${engine}-0113-phone-tip-320`);
    } finally { await c.close(); }
    const d = await browser.newContext({ tip: true, viewport: { width: 1440, height: 900 }, storageState: { cookies: (await ctx.storageState()).cookies, origins: [] } }), dp = await d.newPage();
    try { await dp.goto(BASE + '/'); await visible(dp.locator('#side .si')); await dp.waitForTimeout(300); assert(!(await dp.locator('.ptip').count()), 'tip on the desktop'); } finally { await d.close(); }
  });

  await cleanup(page); await ctx.close();
}

const pw = await loadPlaywright();
for (const engine of ['chromium', 'webkit', 'firefox']) {
  if (only && only !== engine) continue;
  console.log(`\n${engine}`);
  let browser;
  /* a browser that does not start is a failure of the run, and the other engines still run */
  try { browser = await pw[engine].launch({ timeout: 60000, ...(engine === 'firefox' && process.env.PW_FIREFOX_CHANNEL ? { channel: process.env.PW_FIREFOX_CHANNEL } : {}) }); }
  catch (e) { failures++; console.log(`  FAIL  ${engine} did not start\n        ${String(e.message || e).split('\n')[0]}`); continue; }
  /* 0.1.13: the one-time phone tip is ended in every context, so the checks run on the screens of 0.1.12; a context made with { tip: true } shows it */
  { const nc = browser.newContext.bind(browser);
    browser.newContext = async (o = {}) => { const { tip, ...rest } = o; const c = await nc(rest); if (!tip) await c.addInitScript(() => { try { localStorage.setItem('pinned.tip-hold', '1'); } catch (e) { /* no storage */ } }); return c; }; }
  if (process.env.UI_SECTION === '0113') { try { await release0113(browser, engine); } finally { await browser.close(); } continue; }
  try { await desktop(browser, engine); await flowFixes(browser, engine); await phone(browser, engine); await narrow(browser, engine); await oneSearch(browser, engine); await barParity(browser, engine); await release0112(browser, engine); await release0113(browser, engine); } finally { await browser.close(); }
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
