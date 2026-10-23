// UI smoke test for the web front end, Chromium and WebKit, desktop 1440x900 (and 768 to 1280 for the sidebar), phone 390x844 (and 320),
// and a mouse in a 700 px window.
//
// Run against a running instance whose data you do not mind changing (it adds and removes a
// folder, bookmarks and a token, all named "ui-test ..."):
//
//   node tools/ui-test.mjs http://127.0.0.1:9098 <app password> [--shots <dir>] [--only chromium|webkit]
//
// Playwright is not a dependency of the repo. The script takes the first that loads:
//   1. PLAYWRIGHT_MODULE=/path/to/playwright (a folder or its index.mjs)
//   2. import('playwright') from a global or local node_modules
//   3. the driver bundled with the Python package (pip install playwright), found with python3
// Browsers come from `npx playwright install chromium webkit` (or `python3 -m playwright install`)
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
    assert(/^All bookmarks, \d+$/.test(await page.getAttribute('#body .fscreen > .ftile >> nth=0', 'aria-label')), 'All bookmarks has no count');
    assert(/^Trash, \d+$/.test(await page.getAttribute('#body .ftrash', 'aria-label')), 'no Trash row with its count');
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

  await check('save page in a popup sized window: the panel is the window, Save draws the tick, a short fade, then Saved in place', async () => {
    const c = await browser.newContext({ viewport: { width: 392, height: 544 }, locale: 'en-US' }); await c.addCookies(await ctx.cookies());
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
    await visible(sp.locator('#sheet .done-state'), 8000);
    const b = (await apiIn(page, 'GET', '/api/state')).data.bookmarks.find(x => x.url === u && !x.deleted_at);
    assert(b, 'not saved'); await apiIn(page, 'DELETE', `/api/bookmarks/${b.id}?permanent=1`);
    await c.close();
  });

  await check('share sheet from a folder menu: link, password, expiry', async () => {
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
    await pw.fill('short1'); await pw.press('Enter');
    await visible(page.locator('#sheet .share-pwf .fld-err', { hasText: 'at least 8' }));
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
    await page.press('#sheet form[data-token] input[name=name]', 'Enter');
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
    await page.keyboard.press('Home'); assert(await focused() === 'Add bookmarks', 'Home: ' + await focused());
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
    await visible(page.locator('#sheet .fld-err', { hasText: 'at least 4' }));
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
    /* saving a link that sits in the locked folder: the check says nothing, the refused save says Already saved */
    const sp = await ctx.newPage();
    await sp.goto(`${BASE}/save?url=${encodeURIComponent(T.url)}&title=x`);
    await visible(sp.locator('#sheet [data-a="save-go"]')); await sp.waitForTimeout(500);
    assert(await sp.locator('#sheet .dupe.off').count() === 1, 'the check revealed the locked link');
    const inboxBtn = sp.locator('#sheet [data-a="save-inbox"]');
    if (await inboxBtn.count()) await inboxBtn.click(); else await sp.click('#sheet [data-a="save-go"]');
    await visible(sp.locator('#sheet .dupe:not(.off)', { hasText: 'Already saved' }));
    assert(await sp.locator('#sheet [data-a="save-go"][disabled]').count() === 1, 'Save still enabled');
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
    assert(await first.getAttribute('data-view') === 'all' && /^All bookmarks, \d+$/.test(await first.getAttribute('aria-label')), 'All bookmarks is not the first card');
    const fb = await first.boundingBox(), sb = await page.locator('#pmain .fscreen .ftile[data-ftile]').first().boundingBox();
    assert(Math.abs(fb.width - sb.width) < 1 && Math.abs(fb.height - sb.height) < 1, 'All bookmarks is not a folder card in size');
    const tr = page.locator('#pmain .ftrash'); await visible(tr);
    assert(/^Trash, \d+$/.test(await tr.getAttribute('aria-label')), 'Trash row has no count');
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
    for (const want of ['Add bookmarks', 'New folder inside', 'Rename', 'Move to', 'Hide from Recent', 'Lock with a password', 'Delete']) assert(rows.includes(want), want + ' missing: ' + rows.join(', '));
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
    const ph = await page.evaluate(() => { const t = document.getElementById('qt'); return getComputedStyle(t, '::before').color === getComputedStyle(t.closest('.search')).color && getComputedStyle(t, '::before').content.includes('Search'); });
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

const pw = await loadPlaywright();
for (const engine of ['chromium', 'webkit']) {
  if (only && only !== engine) continue;
  const browser = await pw[engine].launch();
  try { await desktop(browser, engine); await phone(browser, engine); await narrow(browser, engine); await oneSearch(browser, engine); await barParity(browser, engine); } finally { await browser.close(); }
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
