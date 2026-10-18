/* The loaded state (data), what the viewer is looking at (ui), what is open on top (layers), and the selectors
   and derived lists built from them. load() and run() refetch /api/state. */
import { api } from './api.js';
import { render } from './render.js';
import { fillSheet } from './sheets.js';
import { toast } from './toast.js';
import { errorText, groupName, hostFromUrl, store } from './util.js';

/* ---------- data ---------- */
export const data = { folders: [], bms: [], settings: { last_folder: null, recent_folders: [] }, loaded: false, has: false, error: null };
export let folderById = new Map(), childrenOf = new Map(), topIndex = new Map();
export function setData(s) {
  data.folders = s.folders || []; data.bms = s.bookmarks || [];
  data.settings = Object.assign({ last_folder: null, recent_folders: [] }, s.settings || {});
  data.settings.recent_folders = data.settings.recent_folders || [];
  folderById = new Map(data.folders.map(f => [f.id, f])); childrenOf = new Map();
  for (const f of data.folders) { const k = f.parent_id == null ? null : f.parent_id; if (!childrenOf.has(k)) childrenOf.set(k, []); childrenOf.get(k).push(f); }
  for (const a of childrenOf.values()) a.sort((x, y) => x.position - y.position || x.id - y.id);
  /* a folder keeps its hue when reordered: rank among top folders by creation, not by position */
  topIndex = new Map(); [...kids(null)].sort((a, b) => a.id - b.id).forEach((f, i) => topIndex.set(f.id, i));
}
export const kids = id => childrenOf.get(id == null ? null : id) || [];
export const chain = id => { const out = []; let f = folderById.get(id), g = 0; while (f && g++ < 64) { out.unshift(f); f = f.parent_id != null ? folderById.get(f.parent_id) : null; } return out; };
/* locked folders: a lock that is not open hides the folder's links and subfolders until the password is given */
export const isLocked = f => !!(f && f.locked && !f.unlocked);
export const lockedAt = id => typeof id === 'number' ? chain(id).find(isLocked) || null : null;
export const pickable = id => folderById.has(id) && !lockedAt(id);
/* locking is inherited: a folder carries its own lock when its parent is not locked */
export const ownLock = f => !!(f && f.locked && !(f.parent_id != null && folderById.get(f.parent_id) && folderById.get(f.parent_id).locked));
export const HUES = ['cyan', 'coral', 'lilac', 'lime', 'mint', 'rose'];
export const hue = fid => { if (fid == null) return 'tray'; const c = chain(fid); return c.length ? HUES[(topIndex.get(c[0].id) || 0) % 6] : 'plain'; };
/* the folder hue is a class: hue-cyan sets --h and --hp (app.css) */
export const hueClass = fid => 'hue-' + hue(fid);
export const pathOf = fid => fid == null ? 'Inbox' : (chain(fid).map(f => f.name).join(' / ') || 'Inbox');
export const descSet = id => { const s = new Set([id]), st = [id]; while (st.length) for (const k of kids(st.pop())) if (!s.has(k.id)) { s.add(k.id); st.push(k.id); } return s; };
export const dfs = (pid = null) => kids(pid).flatMap(f => [f.id, ...dfs(f.id)]);
export const live = () => data.bms.filter(b => !b.deleted_at);
export const trashed = () => data.bms.filter(b => b.deleted_at);
export const bm = id => data.bms.find(b => b.id === id);
export const nowS = () => Date.now() / 1000;
/* Hide from Recent is set per folder and holds for its subfolders: a link in any such folder stays out of every recent list */
export const hidesRecent = id => typeof id === 'number' && chain(id).some(f => f.hide_recent);
export const recentOk = b => !hidesRecent(b.folder_id);
/* the last opened links, newest first, for the Recent rows */
export const lastOpened = n => live().filter(b => b.opened_at && recentOk(b)).sort((a, b) => b.opened_at - a.opened_at).slice(0, n);
export const fid = b => b.folder_id == null ? null : b.folder_id;
export function count(v) {
  if (v === 'dashboard') return '';
  if (v === 'all') return live().length;
  if (v === 'trash') return trashed().length;
  if (v === 'inbox') return live().filter(b => fid(b) == null).length;
  if (v === 'folders') return kids(null).length;
  if (v === 'settings') return '';
  const s = descSet(v); return live().filter(b => fid(b) != null && s.has(b.folder_id)).length;
}
export const viewName = v => ({ dashboard: 'Dashboard', all: 'All bookmarks', inbox: 'Inbox', trash: 'Trash', folders: 'Folders', settings: 'Settings' })[v] || (folderById.get(v) || { name: 'Folder' }).name;
export const pinned = () => live().filter(b => b.pinned).sort((a, b) => a.pinned_position - b.pinned_position || a.id - b.id);
export const hostOf = b => b.host || hostFromUrl(b.url);
export const iconSrc = b => !b || !b.icon ? null : /^(\/|https?:|data:)/.test(b.icon) ? b.icon : '/icons/' + encodeURIComponent(b.icon);
/* ---------- ui state ---------- */
/* the source of this program, linked from the app menu (AGPL section 13) */
export const SOURCE_URL = 'https://github.com/pinned-cc/pinned';
export const SORTS = { saved: 'Newest', name: 'A to Z', opened: 'Last opened', manual: 'Your order' };
/* the Folders grid has its own order: the sidebar order, by name, or the newest folder first; kept on this device */
export const FSORTS = { manual: 'Your order', name: 'A to Z', saved: 'Newest' };
export const ui = {
  view: 'dashboard', q: '', sort: SORTS[store.get('sort', 'saved')] ? store.get('sort', 'saved') : 'saved', fsort: FSORTS[store.get('fsort', 'manual')] ? store.get('fsort', 'manual') : 'manual', layout: store.get('layout', 'grid') === 'list' ? 'list' : 'grid', footOpen: store.get('foot', '') === 'open',
  selecting: false, picked: new Set(), renaming: null,
  version: null, /* from /health, which tells it only to a logged in session */
  mode: null, /* 'desk' or 'phone', set by render() */
  anchor: null, /* the bookmark id a Shift click or Shift arrow range starts from */
  suppressClick: 0 /* until this time a click is swallowed: it ended a drag or a long press */
};
/* what is open over the page: a sheet and its state, the save form, the palette, a menu, the toast with Undo */
export const layers = { sheet: null, save: null, palette: null, menu: null, undo: null };
/* every opened link that sits in a folder, newest open first: the Dashboard's gallery */
export const galLinks = () => live().filter(b => b.opened_at && fid(b) != null && recentOk(b) && !lockedAt(b.folder_id)).sort((a, b) => b.opened_at - a.opened_at || a.id - b.id);
/* the Dashboard shows the gallery */
export const galleryOn = () => data.has && ui.view === 'dashboard';
const GAL_CAP = 60; /* the Dashboard is a look back, not an archive: the 60 opened last */
export const galShown = () => galLinks().slice(0, GAL_CAP);
/* every view with cards or folders can select, the Dashboard's gallery too; Settings has nothing to pick */
export const canSelect = () => ui.view !== 'settings';
/* on the Folders screen the selection holds folders, everywhere else bookmarks; the two never mix */
export const foldersSel = () => ui.view === 'folders';
export const selectables = () => foldersSel() ? sortedTop().filter(f => !isLocked(f)).map(f => f.id) : galleryOn() ? galShown().map(b => b.id) : listFor().map(b => b.id);
export const setSort = s => { ui.sort = s; store.set('sort', s); };
export const setFsort = s => { ui.fsort = s; store.set('fsort', s); };
/* the top level folders in the Folders grid's order */
export const sortedTop = () => { const L = [...kids(null)];
  if (ui.fsort === 'name') L.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  else if (ui.fsort === 'saved') L.sort((a, b) => b.id - a.id);
  return L; };
/* the bookmark views that carry Sort: Trash lists in a fixed order, by deletion */
export const sortable = (v = ui.view) => v === 'inbox' || v === 'all' || typeof v === 'number';

export function listFor(v = ui.view) {
  let L;
  if (v === 'folders' || v === 'settings') return [];
  if (v === 'dashboard') return []; /* the dashboard lists recents itself */
  if (v === 'trash') L = trashed();
  else if (v === 'all') L = live();
  else if (v === 'inbox') L = live().filter(b => fid(b) == null);
  else L = live().filter(b => fid(b) === v); /* subfolders show as folder tiles above the cards */
  return L;
}
/* single container views can be reordered by drag in any sort; the drop switches the sort to "Your order" */
export const soleContainer = () => { const v = ui.view;
  if (v === 'inbox') return null; if (typeof v === 'number') return v; return undefined; };
export function sections() {
  const L = listFor(), v = ui.view;
  if (!L.length) return [];
  const by = k => (a, b) => (b[k] || 0) - (a[k] || 0) || a.title.localeCompare(b.title);
  const grouped = (items, k) => { const out = []; for (const b of items) { const g = groupName(b[k]); let s = out.find(x => x.label === g);
    if (!s) { s = { label: g, items: [], date: x => x[k] }; out.push(s); } s.items.push(b); } return out; };
  const sole = soleContainer();
  const mark = S => { if (sole !== undefined) S.forEach(s => { s.container = sole; }); return S; };
  if (v === 'trash') return [{ label: 'Kept for 30 days', items: L.sort(by('deleted_at')), date: b => b.deleted_at }];
  if (ui.sort === 'name') return mark([{ label: 'A to Z', items: L.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })), date: b => b.created_at }]);
  if (ui.sort === 'opened') {
    const o = L.filter(b => b.opened_at).sort(by('opened_at')), n = L.filter(b => !b.opened_at).sort(by('created_at'));
    const S = grouped(o, 'opened_at');
    if (n.length) S.push({ label: 'Not opened', items: n, date: b => b.created_at }); return mark(S);
  }
  if (ui.sort === 'manual') {
    const S = [];
    for (const c of [null, ...dfs()]) { const it = L.filter(b => fid(b) === c).sort((a, b) => a.position - b.position || a.id - b.id);
      if (it.length) S.push({ label: pathOf(c), items: it, date: b => b.created_at, container: c }); }
    return S;
  }
  const it = L.sort(by('created_at'));
  return mark(grouped(it, 'created_at'));
}
let loadSeq = 0;
export async function load() {
  const my = ++loadSeq;
  try { const s = await api('GET', '/api/state'); if (my !== loadSeq) return; setData(s); data.has = true; data.error = null; }
  catch (e) { if (e.auth) return; if (my !== loadSeq) return; data.error = e; }
  data.loaded = true;
  for (const id of [...ui.picked]) if (foldersSel() ? !folderById.has(id) : !bm(id)) ui.picked.delete(id);
  if (typeof ui.view === 'number' && !folderById.has(ui.view)) ui.view = 'dashboard';
  if (lockedAt(ui.view)) { ui.view = 'dashboard'; toast('Folder locked again'); }
  render();
  if (layers.sheet && layers.sheet.type !== 'save' && layers.sheet.type !== 'done' && layers.sheet.type !== 'addto') fillSheet();
}
/* run a mutation, then refetch the state */
export async function run(p, quiet) {
  try { const r = await p; await load(); return { ok: true, data: r }; }
  catch (e) { if (!e.auth && !quiet) toast(errorText(e, 'That did not work. Try again.')); load(); return { ok: false, error: e }; }
}

export async function loadQuiet() { try { setData(await api('GET', '/api/state')); data.has = true; } catch (e) { /* the next load reports */ } if (document.body.dataset.page === 'app') render(); }
