// UI smoke test for the web front end, Chromium and WebKit, desktop 1440x900 and phone 390x844.
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
const SOURCE = 'https://github.com/pinnedcc/pinned';
const TOKENS_EMPTY = 'A token lets a Shortcut, an extension or a script read your folders and save links. It cannot export, share, lock or delete anything.';

let failures = 0, passes = 0, beforeEach = null;
async function check(label, fn) {
  try { if (beforeEach) await beforeEach(); await fn(); passes++; console.log(`  ok    ${label}`); }
  catch (e) { failures++; console.log(`  FAIL  ${label}\n        ${String(e.message || e).split('\n')[0]}`); }
}
const visible = (loc, timeout = 6000) => loc.first().waitFor({ state: 'visible', timeout });
const gone = (loc, timeout = 6000) => loc.first().waitFor({ state: 'hidden', timeout });
async function until(page, fn, arg, what, timeout = 6000) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); } catch { throw new Error('timed out: ' + what); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function shot(page, name) { if (!shotsDir) return; await page.mouse.move(1, 1).catch(() => {}); await page.waitForTimeout(350); await page.screenshot({ path: join(shotsDir, name + '.png') }); }

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

async function login(page) {
  await page.goto(BASE + '/login');
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login')), page.click('button[type=submit]')]);
}

/* window.open is recorded instead of opening a tab */
const RECORD_OPEN = () => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; };

const toastWith = (page, text) => visible(page.locator('#toasts .toast', { hasText: text }));
/* the sidebar actions sit folded behind More; open them before using one */
const openFoot = async page => { const t = page.locator('#side .foot-tog'); if (await t.count() && await t.getAttribute('aria-expanded') !== 'true') { await t.click(); await page.waitForTimeout(300); } };
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
  await cleanup(page); await page.reload();
  /* a failed check leaves no sheet, menu or palette open for the next one */
  beforeEach = async () => { for (let i = 0; i < 3; i++) { if (!(await page.locator('#layer.open, .menu, #pal').count())) break; await page.keyboard.press('Escape'); await page.waitForTimeout(350); } };

  await check('Inbox renders with folder tiles', async () => {
    await visible(page.locator('#body article.tile[data-id]'));
    assert((await page.textContent('#tbwrap h2')).trim() === 'Inbox', 'title is not Inbox');
    assert(await page.locator('#body .ftile').count() > 0, 'no folder tiles');
    await shot(page, `${engine}-desktop-inbox`);
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
    assert(/^Pinned \S+$/.test((await page.textContent('#side .side-foot .app-ver')).trim()), 'version line');
  });

  await check('new folder from the sidebar', async () => {
    await openFoot(page); await page.click('#side [data-a="new-folder"]'); await sheetOpen(page);
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

  await check('the search field opens the palette, typing narrows it, Escape closes it', async () => {
    await page.click('#scope [data-view="all"]');
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
    assert((await page.textContent('#tbwrap .bulk .n')).trim().startsWith('4'), 'bulk bar does not say 4');
    await page.locator('#body .glbl').first().click();
    await until(page, () => !document.querySelector('#body article.tile.picked') && !document.querySelector('#tbwrap .bulk'), null, 'selection cleared');
  });

  await check('S starts and ends selecting', async () => {
    await page.locator('#body .glbl').first().click();
    await page.keyboard.press('s');
    await until(page, () => !!document.querySelector('#screen.selecting'), null, 'selecting');
    await page.keyboard.press('s');
    await until(page, () => !document.querySelector('#screen.selecting'), null, 'not selecting');
  });

  await check('share sheet from a folder menu: link, password, expiry', async () => {
    const ft = page.locator(`#body .ftile[data-ftile="${folderId}"]`);
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
    await visible(page.locator('#sheet .at-title', { hasText: 'API tokens' }));
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
    await page.click(`#body .ftile[data-ftile="${folderId}"]`);
    await until(page, n => (document.querySelector('#tbwrap h2') || {}).textContent === n, T.folder, 'folder view');
    /* the folder menu from the keyboard: End, Home, type-ahead, Enter */
    await page.focus('#tbwrap [data-a="folder-menu"]'); await page.keyboard.press('Enter');
    await visible(page.locator('.menu'));
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
    await visible(page.locator(`#body .ftile.locked[data-ftile="${folderId}"]`));
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
    await page.click(`#body .ftile[data-ftile="${folderId}"]`);
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
    await until(page, id => !document.querySelector(`#body .ftile[data-ftile="${id}"]`), folderId, 'folder gone');
  });

  await check('dates follow the browser locale (de-DE shows German months)', async () => {
    const de = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const dp = await de.newPage(); await login(dp); await visible(dp.locator('#body article time'));
    const bad = await dp.evaluate(() => { const f = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
      return [...document.querySelectorAll('#body article time')].map(t => [t.textContent, t.getAttribute('datetime')])
        .filter(([txt, iso]) => !/^(Today|Yesterday)$/.test(txt) && txt !== f.format(new Date(iso + 'T12:00:00'))); });
    await de.close();
    assert(!bad.length, 'not German: ' + JSON.stringify(bad.slice(0, 3)));
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
  await check('Inbox with folder tiles', async () => {
    await visible(page.locator('#pmain article.pt[data-id]'));
    assert(await page.locator('.ptbar.tabs .ptab[aria-selected="true"][data-tab="inbox"]').count() === 1, 'Inbox tab is not the chosen one');
    assert(await page.locator('.ptbar.tabs [data-tab="folders"] .ptab-n').count() === 1, 'Folders tab has no count');
    await shot(page, `${engine}-phone-inbox`);
  });
  await check('the Recent row', async () => {
    await visible(page.locator('#pmain .precent .prc'));
  });
  await check('Inbox and Folders tabs: the chosen one carries the shape, Folders shows the grid, the choice is remembered', async () => {
    await visible(page.locator('.ptbar.tabs .ptab[aria-selected="true"][data-tab="inbox"]'));
    await page.tap('.ptbar.tabs [data-tab="folders"]');
    await until(page, () => !!document.querySelector('#pmain .fscreen .ftile'), null, 'folders grid');
    assert(await page.evaluate(() => localStorage.getItem('pinned.tab')) === '"folders"', 'tab not remembered');
    await page.tap('.ptbar.tabs [data-tab="inbox"]');
    await until(page, () => !document.querySelector('#pmain .fscreen'), null, 'back on Inbox');
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
    await shot(page, `${engine}-phone-palette`);
    await page.tap('#pal .pal-cancel');
    await gone(page.locator('#pal'));
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

  await check('the More sheet keeps only what acts on the view', async () => {
    await page.tap('.ptbar [data-a="phone-menu"]'); await sheetOpen(page);
    const rows = await page.locator('#sheet .sh-row').allTextContents();
    assert(!rows.some(r => /Log out|Import|Export|API tokens|Save button|Source/.test(r)), 'app level rows still in the sheet: ' + rows.join(', '));
    assert(rows.some(r => /New folder/.test(r)), 'New folder missing');
    await page.evaluate(() => document.querySelector('#layer .scrim').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    await sheetClosed(page);
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
  await ctx.close();
}

const pw = await loadPlaywright();
for (const engine of ['chromium', 'webkit']) {
  if (only && only !== engine) continue;
  const browser = await pw[engine].launch();
  try { await desktop(browser, engine); await phone(browser, engine); } finally { await browser.close(); }
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
