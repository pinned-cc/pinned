// Takes the markup of every part and screen from the real app, as its own templates and scripts render it, and a
// screenshot of each in dark and light. The markup becomes the Storybook fixtures (storybook/fixtures), the screenshots
// the reference the stories are compared with (proof/real).
// Run through scripts/with-real-app.sh, which starts a throwaway Pinned and passes PINNED_URL and APP_PASSWORD.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, context, login, seed, BASE, VIEWPORT } from './lib/real.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'storybook', 'fixtures');
const REAL = join(HERE, '..', 'proof', 'real');
for (const d of ['parts', 'screens', 'sprites']) { rmSync(join(FIX, d), { recursive: true, force: true }); mkdirSync(join(FIX, d), { recursive: true }); }
rmSync(REAL, { recursive: true, force: true });
mkdirSync(REAL, { recursive: true });
const log = [];
const say = (s) => { log.push(s); console.log(s); };

// the state of the page as markup: typed values become attributes, so a static copy shows them
async function freeze(page) {
  await page.evaluate(() => {
    document.querySelectorAll('input,textarea').forEach((e) => {
      if (e.type === 'checkbox' || e.type === 'radio') { if (e.checked) e.setAttribute('checked', ''); else e.removeAttribute('checked'); }
      else if (e.tagName === 'TEXTAREA') e.textContent = e.value;
      else e.setAttribute('value', e.value);
    });
  });
}
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}
async function setTheme(page, t) {
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, t);
  await page.waitForTimeout(80);
}
const sprites = new Set();
async function sprite(page, key) {
  if (sprites.has(key)) return key;
  const html = await page.evaluate(() => [...document.querySelectorAll('svg.sprite')].map((s) => s.outerHTML).join('\n'));
  writeFileSync(join(FIX, 'sprites', `${key}.html`), html);
  sprites.add(key);
  return key;
}
const pageKey = (page) => (new URL(page.url()).pathname.replace(/\//g, '') || 'app').replace(/^s.*/, 'share');

// one part: the element, its ancestors' tags and classes (so every selector still matches), its box
export async function part(page, device, id, group, title, selector, note = '', opts = {}) {
  try {
    await freeze(page);
    await settle(page);
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 5000 });
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
    if (opts.hover) { await loc.hover({ timeout: 5000 }); await settle(page); }
    const info = await loc.evaluate((el) => {
      const attrs = (e) => Object.fromEntries([...e.attributes].filter((a) => ['id', 'class', 'role', 'style', 'open'].includes(a.name) || a.name.startsWith('data-') || a.name.startsWith('aria-')).map((a) => [a.name, a.value]));
      const chain = [];
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) chain.unshift({ tag: p.tagName.toLowerCase(), attrs: attrs(p) });
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const all = [el, ...el.querySelectorAll('*')];
      const a = document.activeElement;
      // the focus counts when it shows: a field, or a control the keyboard reached (:focus-visible)
      const focus = a && (a.matches(':focus-visible') || /^(INPUT|TEXTAREA)$/.test(a.tagName)) ? all.indexOf(a) : -1;
      const hov = [...el.querySelectorAll(':hover')].pop() || (el.matches(':hover') ? el : null);
      const hover = hov ? all.indexOf(hov) : -1;
      return {
        focus, hover, html: el.outerHTML, chain, body: attrs(document.body), htmlAttrs: { style: document.documentElement.getAttribute('style') || '' },
        box: { x: r.x, y: r.y, width: r.width, height: r.height, position: cs.position, margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(parseFloat) },
      };
    });
    const fx = { id, group, title, device, note, viewport: VIEWPORT[device], sprite: await sprite(page, pageKey(page)), ...info };
    writeFileSync(join(FIX, 'parts', `${id}.json`), JSON.stringify(fx, null, 1));
    for (const t of ['dark', 'light']) { await setTheme(page, t); await loc.screenshot({ path: join(REAL, `part-${id}--${t}.png`), timeout: 10000 }); }
    await setTheme(page, 'dark');
    say(`part ${id} ok`);
  } catch (e) { say(`part ${id} FAILED: ${e.message.split('\n')[0]}`); }
}
export async function screen(page, device, id, title, note = '') {
  try {
    await freeze(page);
    await settle(page);
    const info = await page.evaluate(() => {
      const attrs = (e) => Object.fromEntries([...e.attributes].filter((a) => a.name !== 'data-theme').map((a) => [a.name, a.value]));
      const all = [...document.body.querySelectorAll('*')].filter((e) => !e.closest('script'));
      const a = document.activeElement;
      const focus = a && a !== document.body && (a.matches(':focus-visible') || /^(INPUT|TEXTAREA)$/.test(a.tagName)) ? all.indexOf(a) : -1;
      const hov = [...document.body.querySelectorAll(':hover')].pop();
      return { focus, hover: hov ? all.indexOf(hov) : -1, body: attrs(document.body), htmlAttrs: attrs(document.documentElement), inner: document.body.innerHTML, title: document.title, scroll: [scrollX, scrollY] };
    });
    writeFileSync(join(FIX, 'screens', `${id}.json`), JSON.stringify({ id, title, device, note, viewport: VIEWPORT[device], path: new URL(page.url()).pathname, ...info }, null, 1));
    for (const t of ['dark', 'light']) { await setTheme(page, t); await page.screenshot({ path: join(REAL, `screen-${id}--${t}.png`), timeout: 10000 }); }
    await setTheme(page, 'dark');
    say(`screen ${id} ok`);
  } catch (e) { say(`screen ${id} FAILED: ${e.message.split('\n')[0]}`); }
}
const go = async (page, path = '/') => { await page.goto(BASE + path, { timeout: 20000 }); await settle(page); };
const click = async (page, sel) => { await page.locator(sel).first().click({ timeout: 5000 }); await settle(page); };
const esc = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); };
const step = async (name, fn) => { try { await fn(); } catch (e) { say(`step ${name} FAILED: ${e.message.split('\n')[0]}`); } };

const browser = await launch();
try {
  // ---------------------------------------------------------------- desktop
  const ctx = await context(browser, 'desk');
  await login(ctx);
  const data = await seed(ctx);
  await ctx.request.post(`${BASE}/api/folders`, { data: { name: 'Empty for now' }, headers: { 'X-Requested-With': 'fetch' } });
  const st = await (await ctx.request.get(`${BASE}/api/state`)).json();
  const shared = (st.folders || []).find((f) => f.share);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('pageerror ' + e.message));
  await go(page);
  const D = 'desk';
  await screen(page, D, 'desk-dashboard', 'Dashboard, desktop');
  await part(page, D, 'sidebar', 'Folder tiles', 'Sidebar', '.side');
  await part(page, D, 'sidebar-item-current', 'Folder tiles', 'Sidebar item, current', '.si[aria-current="true"]');
  await part(page, D, 'sidebar-folder', 'Folder tiles', 'Sidebar folder with count', '.si.sf.hue-cyan');
  await part(page, D, 'sidebar-folder-locked', 'Folder tiles', 'Sidebar folder, locked', '.si.sf.locked');
  await part(page, D, 'search-desk', 'Fields', 'Search, desktop', '.head .search');
  await part(page, D, 'dock', 'Cards', 'Pinned dock', '.dock');
  await part(page, D, 'gallery-card', 'Cards', 'Dashboard card', '.gb .gk');
  await part(page, D, 'button-add', 'Buttons', 'Add, the primary toolbar button', '.tb .add');
  await part(page, D, 'button-view-switch', 'Buttons', 'Grid and list switch', '.tb .vsw');
  await part(page, D, 'button-select', 'Buttons', 'Select, a quiet button', '.tb .btn.sel');
  await step('dash list', async () => { await click(page, '.tb .vsw button:last-child'); });
  await part(page, D, 'gallery-row', 'Cards', 'Dashboard list row', '.gc-row');
  await step('dash grid', async () => { await click(page, '.tb .vsw button:first-child'); });

  await step('all', async () => { await click(page, '.si[data-view="all"]'); });
  await screen(page, D, 'desk-all', 'All bookmarks, desktop');
  await part(page, D, 'card', 'Cards', 'Bookmark card', '.grid:not(.is-list) .tile');
  await part(page, D, 'button-sort', 'Buttons', 'Sort', '.tb .btn.sortc');
  await step('sort menu', async () => { await click(page, '.tb .btn.sortc'); });
  await part(page, D, 'menu-desk', 'Menus', 'Menu, desktop', '.menu');
  await screen(page, D, 'desk-sort-menu', 'Sort menu open, desktop');
  await esc(page);
  await step('hover card', async () => { await page.locator('.grid .tile').nth(1).hover(); await settle(page); });
  await part(page, D, 'card-hover', 'Cards', 'Bookmark card, pointer on it (actions shown)', '.grid .tile:nth-child(2)', 'The pointer rests on the card.', { hover: true });
  await step('list', async () => { await page.mouse.move(5, 5); await click(page, '.tb .vsw button:last-child'); });
  await screen(page, D, 'desk-all-list', 'All bookmarks as a list, desktop');
  await part(page, D, 'card-row', 'Cards', 'Bookmark list row', '.is-list .tile');
  await step('grid', async () => { await click(page, '.tb .vsw button:first-child'); });
  await step('select', async () => { await click(page, '.tb .btn.sel'); await page.locator('.grid .tile .chk').first().click(); await settle(page); });
  await screen(page, D, 'desk-selecting', 'Selecting, desktop');
  await part(page, D, 'card-picked', 'Cards', 'Bookmark card, picked', '.tile.picked');
  await part(page, D, 'selection-bar-desk', 'Buttons', 'Selection bar, desktop', '#dbulk');
  await step('unselect', async () => { await click(page, '.tb .btn.sel'); });

  await step('folder design', async () => { await click(page, '.si[data-view="2"]'); });
  await screen(page, D, 'desk-folder', 'A folder with subfolders, desktop');
  // at 1440 a folder lists its subfolders in the sidebar only; the folder tiles are the phone's Folders screen
  await part(page, D, 'add-tile', 'Empty and error states', 'The dashed add tile at the end of a list', '.addtile');
  await step('folder menu', async () => { await click(page, '[data-a="folder-menu"]'); });
  await part(page, D, 'menu-folder', 'Menus', 'Folder actions menu, desktop', '.menu');
  await esc(page);

  await step('empty folder', async () => { await click(page, '.si.sf:has-text("Empty for now")'); });
  await screen(page, D, 'desk-folder-empty', 'An empty folder, desktop');
  await part(page, D, 'empty-folder', 'Empty and error states', 'Empty folder', '.empty.merge, .calm');

  await step('share sheet', async () => { await click(page, '.si[data-view="4"]'); await click(page, '.tb-share'); });
  await screen(page, D, 'desk-share-sheet', 'Share a folder, desktop dialog');
  await part(page, D, 'sheet-share', 'Sheets', 'Share sheet, desktop', '#sheet');
  await part(page, D, 'segmented', 'Tabs', 'Segmented control', '#sheet .seg');
  await part(page, D, 'switch', 'Buttons', 'Switch', '#sheet .sh-rows:has(.sh-switch)');
  await esc(page);

  await step('trash', async () => { await click(page, '.si[data-view="trash"]'); });
  await screen(page, D, 'desk-trash', 'Trash, desktop');
  await part(page, D, 'button-warn', 'Buttons', 'A warning button', '.btn.warn');
  await step('trash hover', async () => { await page.locator('.grid .tile').first().hover(); await settle(page); });
  await part(page, D, 'card-trash', 'Cards', 'A card in Trash, Restore and Delete', '.grid .tile', 'The pointer rests on the card.', { hover: true });
  await page.mouse.move(5, 5);

  await step('toast', async () => { await click(page, '.si[data-view="all"]'); await page.locator('.grid .tile').nth(2).hover(); await page.locator('.grid .tile').nth(2).locator('[data-a="trash"]').click(); await page.mouse.move(5, 5); await page.waitForSelector('.toast', { timeout: 5000 }); await settle(page); });
  await part(page, D, 'toast', 'Toasts', 'Toast with an action', '.toast');
  await screen(page, D, 'desk-toast', 'A toast, desktop');
  await step('undo', async () => { await click(page, '.toast button'); });

  await step('add', async () => { await click(page, '.tb .add'); });
  await screen(page, D, 'desk-add', 'Add a bookmark, desktop dialog');
  await part(page, D, 'sheet-add-desk', 'Sheets', 'Add sheet, desktop dialog', '#sheet');
  await part(page, D, 'field-desk', 'Fields', 'Field in a sheet', '#sheet .fld');
  await part(page, D, 'folder-chip', 'Folder tiles', 'Folder chip in the folder picker', '#sheet .fmini');
  await part(page, D, 'button-save', 'Buttons', 'Save, the big primary button', '#sheet .save');
  await step('dupe', async () => { const f = page.locator('#sheet [data-f="url"]').first(); await f.fill('https://example.com/later'); await f.press('Tab'); await page.waitForSelector('#sheet .dupe:not(.off)', { timeout: 5000 }); });
  await part(page, D, 'error-dupe', 'Empty and error states', 'Already saved, in the add sheet', '#sheet .dupe');
  await esc(page);

  await step('palette', async () => { await page.keyboard.press('Meta+k'); await page.waitForSelector('.pal.open', { timeout: 5000 }); await page.keyboard.type('re'); await page.waitForTimeout(400); });
  await screen(page, D, 'desk-palette', 'Search palette with results, desktop');
  await part(page, D, 'palette', 'Sheets', 'Search palette, desktop', '.pal-panel');
  await step('palette none', async () => { await page.keyboard.type('zzzz'); await page.waitForTimeout(400); });
  await part(page, D, 'palette-none', 'Empty and error states', 'Search without results', '.pal-panel');
  await esc(page);

  await step('unlock', async () => { await go(page); await click(page, '.si.sf.locked'); await page.waitForSelector('#sheet input[type="password"]', { timeout: 5000 }); });
  await screen(page, D, 'desk-unlock', 'Unlock a folder, desktop dialog');
  await part(page, D, 'dialog-desk', 'Dialogs', 'Password dialog, desktop', '#sheet');
  await step('unlock wrong', async () => { await page.locator('#sheet input[type="password"]').fill('not the password'); await page.keyboard.press('Enter'); await page.waitForTimeout(900); });
  await part(page, D, 'dialog-wrong', 'Empty and error states', 'Password dialog, wrong password', '#sheet');
  await esc(page);

  await step('whats new', async () => { await click(page, '[data-a="foot"]'); await click(page, '.app-ver'); });
  await screen(page, D, 'desk-whats-new', "What's new, desktop");
  await part(page, D, 'sheet-notes', 'Sheets', "What's new sheet", '#sheet');
  await esc(page);
  await step('tokens', async () => { await click(page, '[data-a="tokens"]'); await page.waitForTimeout(500); });
  await screen(page, D, 'desk-tokens', 'API tokens, desktop');
  await esc(page);
  await step('sessions', async () => { await click(page, '[data-a="sessions"]'); await page.waitForTimeout(500); });
  await screen(page, D, 'desk-sessions', 'Signed in, desktop');
  await esc(page);

  await step('howto', async () => { await go(page, '/bookmarklet'); });
  await screen(page, D, 'desk-how-to-save', 'How to save');
  await part(page, D, 'tabs-howto', 'Tabs', 'How to save tabs', '.hs-tabs');
  await step('save page', async () => { await go(page, '/save?url=' + encodeURIComponent('https://example.com/new-page') + '&title=' + encodeURIComponent('A new page')); });
  await screen(page, D, 'desk-save-page', 'The save page, desktop');
  if (shared) {
    await step('share page', async () => { await go(page, `/s/${shared.share.token}`); });
    await screen(page, D, 'desk-share-page', 'A shared folder, the public page, desktop');
  } else say('no shared folder found for the share page');

  const anon = await context(browser, 'desk');
  const lp = await anon.newPage();
  await go(lp, '/login');
  await screen(lp, D, 'desk-login', 'Log in, desktop');
  await part(lp, D, 'field-login', 'Fields', 'Password field on the ground', '.lone .fld');
  await part(lp, D, 'button-login', 'Buttons', 'Log in', '.lone .save');
  await step('login wrong', async () => { await lp.locator('input[type="password"]').fill('not the password'); await lp.keyboard.press('Enter'); await lp.waitForTimeout(1200); });
  await part(lp, D, 'error-login', 'Empty and error states', 'Log in, wrong password', '.lone-box');
  await screen(lp, D, 'desk-login-error', 'Log in, wrong password, desktop');

  // ---------------------------------------------------------------- phone
  const pc = await context(browser, 'phone');
  await login(pc);
  const p = await pc.newPage();
  p.on('pageerror', (e) => say('pageerror phone ' + e.message));
  await go(p);
  const P = 'phone';
  await screen(p, P, 'phone-dashboard', 'Dashboard, phone');
  await part(p, P, 'tabs-phone', 'Tabs', 'Start tabs, phone', '.ptbar.tabs');
  await part(p, P, 'recent-row', 'Cards', 'Pinned row, phone', '.precent');
  await part(p, P, 'gallery-card-phone', 'Cards', 'Dashboard card, phone', '.gb .gk');
  await part(p, P, 'bottom-bar', 'Fields', 'Search and plus, phone', '.pbottom');
  await part(p, P, 'button-plus', 'Buttons', 'The floating plus', '.pbottom .padd');
  await part(p, P, 'button-gear', 'Buttons', 'Settings, an icon button', '.ib.gear');
  await step('inbox', async () => { await click(p, '.ptab[data-tab="inbox"]'); });
  await screen(p, P, 'phone-inbox', 'Inbox, phone');
  await part(p, P, 'card-phone', 'Cards', 'Bookmark card, phone', '.pgrid .pt');
  await step('folders', async () => { await click(p, '.ptab[data-tab="folders"]'); });
  await screen(p, P, 'phone-folders', 'Folders, phone');
  await part(p, P, 'folder-tile-phone', 'Folder tiles', 'Folder tile, phone', '.fgrid-p .ftile:not(.fnew):not(.fplace)');
  await part(p, P, 'trash-row', 'Folder tiles', 'Trash row', '.ftrash');
  await step('phone folder', async () => { await click(p, '.fgrid-p .ftile:has-text("Reading")'); });
  await screen(p, P, 'phone-folder', 'A folder, phone');
  await step('phone list', async () => { await click(p, '.vsw.p button:last-child'); });
  await part(p, P, 'card-row-phone', 'Cards', 'Bookmark list row, phone', '.pt.row');
  await step('phone grid', async () => { await click(p, '.vsw.p button:first-child'); });
  await step('phone folder menu', async () => { await click(p, '[data-a="folder-menu"]'); });
  await screen(p, P, 'phone-folder-sheet', 'Folder actions, phone sheet');
  await part(p, P, 'sheet-actions', 'Sheets', 'Action sheet, phone', '#sheet');
  await part(p, P, 'menu-phone', 'Menus', 'Menu, phone', '.menu, #sheet .sh-rows');
  await esc(p);
  await step('phone select', async () => { await click(p, '.ib.sel'); await p.locator('.pgrid .pt').first().click(); await settle(p); });
  await screen(p, P, 'phone-selecting', 'Selecting, phone');
  await part(p, P, 'selection-bar-phone', 'Buttons', 'Selection bar, phone', '.pbulk');
  await part(p, P, 'card-picked-phone', 'Cards', 'Bookmark card, picked, phone', '.pt.picked');
  await step('phone unselect', async () => { await click(p, '.ib.sel'); });
  await step('phone add', async () => { await click(p, '.pbottom .padd'); });
  await screen(p, P, 'phone-add', 'Add a bookmark, phone sheet');
  await part(p, P, 'sheet-add-phone', 'Sheets', 'Add sheet, phone', '#sheet');
  await part(p, P, 'button-text', 'Buttons', 'Text button', '#sheet .tbtn');
  await esc(p);
  await step('phone search', async () => { await go(p); await click(p, '.pbottom .ps-trigger'); await p.keyboard.type('re'); await p.waitForTimeout(500); });
  await screen(p, P, 'phone-palette', 'Search, phone');
  await esc(p);
  await step('phone settings', async () => { await go(p); await click(p, '.ib.gear'); });
  await screen(p, P, 'phone-settings', 'Settings, phone');
  await part(p, P, 'settings-rows', 'Settings rows', 'Settings rows', '.pset');
  await part(p, P, 'settings-row', 'Settings rows', 'One settings row', '.pset .sr');
  await step('phone empty', async () => { await go(p); await click(p, '.ptab[data-tab="folders"]'); await click(p, '.fgrid-p .ftile:has-text("Empty for now")'); });
  await screen(p, P, 'phone-folder-empty', 'An empty folder, phone');
  await part(p, P, 'empty-folder-phone', 'Empty and error states', 'Empty folder, phone', '.pempty, .calm');
  await step('phone unlock', async () => { await go(p); await click(p, '.ptab[data-tab="folders"]'); await click(p, '.fgrid-p .ftile.locked'); await p.waitForSelector('#sheet input[type="password"]', { timeout: 5000 }); });
  await screen(p, P, 'phone-unlock', 'Unlock a folder, phone dialog');
  await part(p, P, 'dialog-phone', 'Dialogs', 'Password dialog, phone', '#sheet');
  await esc(p);
  await step('phone toast', async () => { await go(p); await click(p, '.ptab[data-tab="inbox"]'); await click(p, '.ib.sel'); await p.locator('.pgrid .pt').first().click(); await click(p, '.pbulk [data-a="bulk-trash"]'); await p.waitForSelector('.toast', { timeout: 5000 }); await settle(p); });
  await part(p, P, 'toast-phone', 'Toasts', 'Toast, phone', '.toast');
  await screen(p, P, 'phone-toast', 'A toast, phone');

  const anonP = await context(browser, 'phone');
  const lpp = await anonP.newPage();
  await go(lpp, '/login');
  await screen(lpp, P, 'phone-login', 'Log in, phone');
  if (shared) { await step('phone share page', async () => { await go(lpp, `/s/${shared.share.token}`); }); await screen(lpp, P, 'phone-share-page', 'A shared folder, the public page, phone'); }
} finally {
  await browser.close();
  writeFileSync(join(REAL, 'capture-log.txt'), log.join('\n') + '\n');
}
