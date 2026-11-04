// The real app in a headless browser: log in with the password from the environment and fill the throwaway data
// folder with sample bookmarks (made up titles on example addresses, nothing of anyone's own).
import { createRequire } from 'node:module';

export const PW_PATH = process.env.PLAYWRIGHT || 'playwright'; // set PLAYWRIGHT to a Playwright install when it is not in node_modules
export const BASE = process.env.PINNED_URL;
export const VIEWPORT = { desk: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

export function playwright() { return createRequire(import.meta.url)(PW_PATH); }

export async function launch() {
  const { chromium } = playwright();
  return chromium.launch({ timeout: 30000 });
}

export async function context(browser, device, theme = 'dark') {
  const ctx = await browser.newContext({
    viewport: VIEWPORT[device], deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: theme,
    ...(device === 'phone' ? { isMobile: true, hasTouch: true } : {}),
  });
  ctx.setDefaultTimeout(15000);
  await ctx.addInitScript((t) => { try { localStorage.setItem('pinned-theme', t); } catch (e) { /* none */ } }, theme);
  return ctx;
}

export async function login(ctx) {
  const r = await ctx.request.post(`${BASE}/api/login`, { data: { password: process.env.APP_PASSWORD }, headers: { 'X-Requested-With': 'fetch' }, timeout: 15000 });
  if (!r.ok()) throw new Error('login failed: ' + r.status() + ' ' + (await r.text()));
}

async function call(ctx, method, path, data) {
  const r = await ctx.request.fetch(`${BASE}${path}`, { method, data, headers: { 'X-Requested-With': 'fetch' }, timeout: 15000 });
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
  return r.status() === 204 ? null : r.json().catch(() => null);
}

// sample data: folders with subfolders, pins, opened links for the Dashboard, a locked folder, a shared folder, Trash
export async function seed(ctx) {
  const F = {};
  for (const [name, parent] of [['Reading', null], ['Design', null], ['Recipes', null], ['Travel', null], ['Work', null], ['Tools', null], ['Type', 'Design'], ['Colour', 'Design'], ['Private', null]]) {
    F[name] = (await call(ctx, 'POST', '/api/folders', { name, parent_id: parent ? F[parent].id : null })).id;
  }
  const B = [];
  const add = async (title, url, folder) => { const b = await call(ctx, 'POST', '/api/bookmarks', { title, url, folder_id: folder ? F[folder] : null }); B.push(b); return b; };
  const sample = [
    ['Field notes on slow software', 'https://example.com/notes/slow-software', 'Reading'],
    ['A long read about rivers and the towns they make', 'https://example.org/essays/rivers', 'Reading'],
    ['Weekly letter, issue 48', 'https://letters.example.net/48', 'Reading'],
    ['Grid systems in practice', 'https://example.com/design/grids', 'Design'],
    ['Spacing scales compared', 'https://design.example.org/spacing', 'Design'],
    ['Variable fonts, a primer', 'https://type.example.com/variable', 'Type'],
    ['Reading OKLCH', 'https://colour.example.net/oklch', 'Colour'],
    ['Bread with a long rise', 'https://kitchen.example.com/bread', 'Recipes'],
    ['Lentil soup for a cold week', 'https://kitchen.example.com/lentils', 'Recipes'],
    ['Night trains of Europe', 'https://rail.example.org/night-trains', 'Travel'],
    ['Packing list, five days', 'https://example.net/packing', 'Travel'],
    ['Release checklist', 'https://work.example.com/release', 'Work'],
    ['Team calendar', 'https://calendar.example.com/team', 'Work'],
    ['Regex tester', 'https://tools.example.dev/regex', 'Tools'],
    ['JSON viewer', 'https://tools.example.dev/json', 'Tools'],
    ['Unit converter', 'https://tools.example.dev/units', 'Tools'],
    ['Saved for later, no folder yet', 'https://example.com/later', null],
    ['A page to sort', 'https://example.org/sort-me', null],
    ['Private plans', 'https://example.com/private-plans', 'Private'],
  ];
  for (const s of sample) await add(...s);
  for (const i of [0, 3, 7, 9, 13, 11]) await call(ctx, 'PATCH', `/api/bookmarks/${B[i].id}`, { pinned: true });
  for (const i of [0, 4, 8, 10, 13, 2, 14]) await call(ctx, 'POST', `/api/bookmarks/${B[i].id}/open`);
  await call(ctx, 'POST', `/api/folders/${F.Travel}/share`, {});
  const trash = await add('An old link in Trash', 'https://example.com/old-link', 'Work');
  await call(ctx, 'DELETE', `/api/bookmarks/${trash.id}`);
  await call(ctx, 'POST', `/api/folders/${F.Private}/lock`, { password: 'sample-folder-lock-1' });
  return { F, B };
}
