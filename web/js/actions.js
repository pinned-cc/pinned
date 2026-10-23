/* What a click, a submit or an input does: bookmark and folder actions, menus of actions, navigation between
   views, and the document level click, submit and input handlers. */
import { api } from './api.js';
import { closeMenu, menuOrSheet, openMenu, selItems, tileMenu } from './menu.js';
import { openPalette } from './palette.js';
import { deskBody, render, switchLayout } from './render.js';
import { FPICK, emptySpace, exitSelect, pickRange, selSync, toggle } from './select.js';
import { atMove, checkUrl, closeSheet, doSave, fillSheet, fitTa, newSave, openAddTo, openReleases, openSheet, openTokens, patchSave, renameSheet, shareCopy, shareLock, shareNative, sharePassword, sharePatch, shareToggle, shareUnlock, sheetEl, submitLock, tokenCopy, tokenCreate, tokenRevoke } from './sheets.js';
import { FSORTS, SORTS, bm, chain, count, data, descSet, fid, folderById, foldersSel, hidesRecent, isLocked, layers, live, load, loadQuiet, lockedAt, ownLock, run, selectables, setFsort, setSort, ui } from './state.js';
import { announce, toast } from './toast.js';
import { byId, copy, errorText, plural, reduce, store, wait } from './util.js';

/* ================= bookmark actions ================= */
export const tileEls = ids => ids.map(id => document.querySelector(`#app article[data-id="${id}"]`)).filter(Boolean);
export const leave = async ids => { const els = tileEls(ids); if (!els.length || reduce()) return; els.forEach(e => { e.classList.remove('lift', 'press'); e.classList.add('leaving'); }); await wait(240); };
export const actions = {
  open(b) { window.open(b.url, '_blank', 'noopener'); actions.opened(b.id); },
  opened(id) { fetch(`/api/bookmarks/${id}/open`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'X-Requested-With': 'fetch' } }).catch(() => {}); },
  async share(b) {
    /* the system share sheet wherever the browser has one; a new email with the address where it does not */
    if (navigator.share) { try { await navigator.share({ title: b.title, url: b.url }); } catch (e) { /* cancelled */ } return; }
    window.open('mailto:?subject=' + encodeURIComponent(b.title) + '&body=' + encodeURIComponent(b.url), '_self');
  },
  async copy(b) { toast(await copy(b.url) ? 'Copied' : 'Could not copy the link.'); },
  async trash(ids) {
    const [r] = await Promise.all([ids.length === 1 ? api('DELETE', `/api/bookmarks/${ids[0]}`).then(() => true, e => e) : api('POST', '/api/bookmarks/bulk', { ids, action: 'trash' }).then(() => true, e => e), leave(ids)]);
    ids.forEach(id => ui.picked.delete(id));
    if (r !== true) { if (!r.auth) toast('That did not work. Try again.'); load(); return; }
    await load();
    toast(ids.length === 1 ? 'Moved to Trash' : `${ids.length} moved to Trash`, { undo: () => run(ids.length === 1 ? api('POST', `/api/bookmarks/${ids[0]}/restore`) : api('POST', '/api/bookmarks/bulk', { ids, action: 'restore' })) });
  },
  async restore(ids) { await leave(ids); const r = await run(ids.length === 1 ? api('POST', `/api/bookmarks/${ids[0]}/restore`) : api('POST', '/api/bookmarks/bulk', { ids, action: 'restore' }));
    if (r.ok) announce(ids.length === 1 ? 'Restored' : `${ids.length} restored`); return r; },
  async purge(ids) { await leave(ids); return run(ids.length === 1 ? api('DELETE', `/api/bookmarks/${ids[0]}?permanent=1`) : api('POST', '/api/bookmarks/bulk', { ids, action: 'delete' })); },
  pin(b) { return run(api('PATCH', `/api/bookmarks/${b.id}`, { pinned: !b.pinned })); },
  pinMany(ids, on) { return run(ids.reduce((p, id) => p.then(() => api('PATCH', `/api/bookmarks/${id}`, { pinned: on })), Promise.resolve())); },
  move(ids, folder) { return run(ids.length === 1 ? api('PATCH', `/api/bookmarks/${ids[0]}`, { folder_id: folder }) : api('POST', '/api/bookmarks/bulk', { ids, action: 'move', folder_id: folder })); },
  rename(b, title) { return run(api('PATCH', `/api/bookmarks/${b.id}`, { title })); },
  async nudge(b, d) {
    const sib = live().filter(x => fid(x) === fid(b)).sort((x, y) => x.position - y.position || x.id - y.id), i = sib.indexOf(b), j = i + d;
    if (i < 0 || j < 0 || j >= sib.length) return;
    [sib[i], sib[j]] = [sib[j], sib[i]]; setSort('manual');
    return run(api('PUT', '/api/bookmarks/order', { folder_id: fid(b), ids: sib.map(x => x.id) }));
  }
};
/* the picked links' addresses, one per line */
const pickedUrls = () => [...ui.picked].map(bm).filter(b => b && !b.deleted_at).map(b => b.url);
/* Copy puts them on the clipboard, at every width */
export async function bulkCopy() { const L = pickedUrls(); if (!L.length) return;
  toast(await copy(L.join('\n')) ? (L.length === 1 ? 'Copied' : `${L.length} links copied`) : 'Could not copy the links.'); }
/* Share hands them to the system share sheet; a browser without one starts a new email with them in the body */
export async function bulkShare() { const L = pickedUrls(); if (!L.length) return; const text = L.join('\n');
  if (navigator.share) { try { await navigator.share({ text }); } catch (e) { /* cancelled */ } return; }
  window.open('mailto:?body=' + encodeURIComponent(text), '_self'); }
export function startRename(id) {
  if (ui.mode === 'phone') { renameSheet(bm(id)); return; }
  ui.renaming = id; deskBody();
  const inp = document.querySelector(`[data-rename="${id}"]`); if (!inp) { ui.renaming = null; return; }
  inp.focus(); inp.select();
  let done = false;
  const finish = save => { if (done) return; done = true; const b = bm(id), v = inp.value.trim(); ui.renaming = null;
    const back = () => { const t = document.querySelector(`#app article[data-id="${id}"] .t-title`); if (t) t.focus({ preventScroll: true }); };
    if (save && b && v && v !== b.title) { b.title = v; render(); back(); actions.rename(b, v); } else { render(); back(); } };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
}
/* ================= folders ================= */
export function newFolder(parent, then) {
  openSheet({ type: 'name', title: parent != null ? 'New folder in ' + folderById.get(parent).name : 'New folder', label: 'Name', value: '', button: 'Create',
    submit: async v => { const f = await api('POST', '/api/folders', { name: v, parent_id: parent == null ? null : parent }); await load();
      if (then) then(f); else goView(f.id); } });
}
export function renameFolder(id) { const f = folderById.get(id); if (!f) return;
  openSheet({ type: 'name', title: 'Rename folder', label: 'Name', value: f.name, button: 'Rename', submit: async v => { await api('PATCH', `/api/folders/${id}`, { name: v }); await load(); } }); }
export function deleteFolder(id) { const f = folderById.get(id); if (!f) return; const n = count(id), subs = descSet(id).size - 1;
  const text = (subs ? `Its ${plural(subs, 'subfolder goes', 'subfolders go')} too. ` : '') + (n ? `${plural(n, 'bookmark goes', 'bookmarks go')} to Trash.` : 'It holds no bookmarks.');
  openSheet({ type: 'confirm', title: `Delete ${f.name}?`, text, button: 'Delete folder', run: async () => {
    const gone = descSet(id);
    try { await api('DELETE', `/api/folders/${id}`); } catch (e) { if (e.status === 409) { toast('Unlock the folders inside first'); return; } throw e; } if (typeof ui.view === 'number' && gone.has(ui.view)) ui.view = 'dashboard';
    await load(); if (n) toast(`${plural(n, 'bookmark', 'bookmarks')} moved to Trash`); } }); }
/* folders picked on the Folders screen or carried to Trash: one confirm with the count, then each goes as a single delete would */
export function deleteFolders(ids) { ids = ids.filter(id => folderById.has(id)); if (!ids.length) return; const one = ids.length === 1;
  const all = new Set(ids.flatMap(id => [...descSet(id)])), n = live().filter(b => fid(b) != null && all.has(b.folder_id)).length, subs = all.size - ids.length;
  const text = (subs ? `${one ? 'Its' : 'Their'} ${plural(subs, 'subfolder goes', 'subfolders go')} too. ` : '') + (n ? `${plural(n, 'bookmark goes', 'bookmarks go')} to Trash.` : one ? 'It holds no bookmarks.' : 'They hold no bookmarks.');
  openSheet({ type: 'confirm', title: one ? `Delete ${folderById.get(ids[0]).name}?` : `Delete ${ids.length} folders?`, text, button: one ? 'Delete folder' : 'Delete folders', run: async () => {
    let held = 0; for (const id of ids) { try { await api('DELETE', `/api/folders/${id}`); } catch (e) { if (e.status === 409) { held++; continue; } await load(); throw e; } }
    if (typeof ui.view === 'number' && all.has(ui.view)) ui.view = 'dashboard';
    ui.selecting = false; ui.picked.clear(); ui.anchor = null; await load();
    if (held) toast('Unlock the folders inside first'); else if (n) toast(`${plural(n, 'bookmark', 'bookmarks')} moved to Trash`); } }); }
export function emptyTrash() { const n = count('trash'); if (!n) return;
  openSheet({ type: 'confirm', title: 'Empty trash?', text: `${plural(n, 'bookmark', 'bookmarks')} will be deleted for good.`, button: 'Empty trash',
    run: async () => { await api('DELETE', '/api/trash'); await load(); } }); }
/* moving into a folder from a drop: one toast with Undo back to where each came from */
export async function moveWithUndo(ids, to) {
  const from = new Map(ids.map(id => [id, fid(bm(id))])); const r = await actions.move(ids, to); if (!r || !r.ok) return;
  toast(`Moved to ${to == null ? 'Inbox' : (folderById.get(to) || { name: 'folder' }).name}`, { undo: async () => {
    for (const [id, f] of from) await api('PATCH', `/api/bookmarks/${id}`, { folder_id: f }).catch(() => {}); load(); } });
}
export const folderSheetItems = id => folderById.get(id) && folderById.get(id).locked ? folderItems(id) : [{ icon: 'link', label: folderById.get(id) && folderById.get(id).share ? 'Sharing' : 'Share', run: () => openSheet({ type: 'share', fid: id }) }, ...folderItems(id)];
export const lockItems = id => { const f = folderById.get(id); if (!f) return [];
  if (!f.locked) return [{ icon: 'lock', label: 'Lock with a password', run: () => openSheet({ type: 'lock', fid: id }) }];
  if (!ownLock(f)) return [];
  return [isLocked(f) ? { icon: 'lock', label: 'Unlock', run: () => openSheet({ type: 'unlock', fid: id, to: id }) } : { icon: 'lock', label: 'Relock now', run: () => relock(id) },
    { icon: 'lock', label: 'Remove lock', run: () => openSheet({ type: 'unlockremove', fid: id }) }]; };
export const folderItems = id => isLocked(folderById.get(id)) ? lockItems(id) : [
  { icon: 'plus', label: 'Add bookmarks', run: () => openAddTo(id) },
  { icon: 'folder-plus', label: 'New folder inside', run: () => newFolder(id) },
  { icon: 'edit', label: 'Rename', run: () => renameFolder(id) },
  { icon: 'move', label: 'Move to', run: () => openSheet({ type: 'fmove', id }) },
  ...recentItems(id),
  ...lockItems(id),
  '-', { icon: 'trash', label: 'Delete', warn: true, run: () => deleteFolder(id) }];
/* Hide from Recent: set on the folder itself; a subfolder hidden through a parent has no item, the parent holds the switch */
export const recentItems = id => { const f = folderById.get(id); if (!f) return [];
  if (!f.hide_recent && f.parent_id != null && hidesRecent(f.parent_id)) return [];
  return [{ icon: 'clock', label: f.hide_recent ? 'Show in Recent' : 'Hide from Recent', run: () => setHideRecent(id, !f.hide_recent) }]; };
export async function setHideRecent(id, on) { const r = await run(api('PATCH', `/api/folders/${id}`, { hide_recent: on })); if (r.ok) toast(on ? 'Hidden from Recent' : 'Shown in Recent'); }
/* relock at once; if the folder is on screen, back to Inbox */
export async function relock(id) { if (lockedAt(ui.view) || (typeof ui.view === 'number' && chain(ui.view).some(f => f.id === id))) ui.view = 'dashboard';
  const r = await run(api('POST', `/api/folders/${id}/relock`)); render(); if (r.ok) announce('Folder locked'); }
export const sortItems = () => Object.keys(SORTS).map(k => ({ label: SORTS[k], check: ui.sort === k, run: () => { setSort(k); render(); } }));
export const fsortItems = () => Object.keys(FSORTS).map(k => ({ label: FSORTS[k], check: ui.fsort === k, run: () => { setFsort(k); render(); } }));
/* the orders open as a small menu under the control on both layouts; on the phone it starts at the control's left edge */
export function sortMenu(a, items) {
  if (layers.menu && layers.menu.anchor === a) { closeMenu(); return; }
  const r = a.getBoundingClientRect(); openMenu(a, items, ui.mode === 'phone' ? { x: r.left, y: r.bottom + 4 } : undefined);
}
export async function logout() { try { await api('POST', '/api/logout'); } catch (e) { /* go anyway */ } location.href = '/login'; }
export async function doImport(file) {
  if (!file) return; const fd = new FormData(); fd.append('file', file);
  const r = await run(api('POST', '/api/import', fd));
  if (r.ok && r.data) toast(`Imported ${r.data.added}, skipped ${r.data.skipped}`);
}

/* ================= navigation ================= */
export function goView(v) {
  if (v === 'settings' && ui.tokenCount == null) api('GET', '/api/tokens').then(l => { ui.tokenCount = l.length; if (ui.view === 'settings') render(); }).catch(() => {});
  const lk = lockedAt(v); if (lk) { openSheet({ type: 'unlock', fid: lk.id, to: v }); return; }
  ui.selecting = false; ui.picked.clear(); closeMenu();
  if (ui.mode === 'phone') { ui.view = v; render(); window.scrollTo(0, 0); return; }
  ui.view = v; render(); const c = byId('content'); if (c) c.scrollTop = 0;
}
/* ================= events (app) ================= */
export function onClick(e) {
  const t = e.target;
  if (t.closest('.menu')) return;
  /* select mode: a click or tap on empty space clears it, like clicking the desktop, at every width */
  if (ui.selecting && emptySpace(t)) { exitSelect(); return; }
  const row = t.closest('[data-row]');
  if (row && layers.sheet && layers.sheet.rows) { const r = layers.sheet.rows[+row.dataset.row]; if (r && !r.disabled) { if (layers.sheet.type === 'rows' || layers.sheet.type === 'acts') closeSheet(); r.run(); } return; }
  const dest = t.closest('[data-dest]');
  if (dest && layers.sheet) { const raw = dest.dataset.dest;
    if (layers.sheet.type === 'save') { const id = +raw; layers.save.folder = id; layers.save.recent = [id, ...layers.save.recent.filter(x => x !== id)].slice(0, 3); layers.save.picker = false; layers.save.nf = false; fillSheet(); return; }
    if (layers.sheet.type === 'move') { const ids = layers.sheet.ids, folder = raw === 'inbox' ? null : +raw; closeSheet(); if (ui.selecting) { ui.selecting = false; ui.picked.clear(); } actions.move(ids, folder); return; }
    if (layers.sheet.type === 'fmove') { const id = layers.sheet.id, parent = raw === 'top' ? null : +raw; closeSheet(); run(api('PATCH', `/api/folders/${id}`, { parent_id: parent })); return; }
  }
  const pk = t.closest('[data-pick]'); if (pk && layers.sheet && layers.save) { layers.save.folder = +pk.dataset.pick; fillSheet(); return; }
  const lay = t.closest('[data-layout]'); if (lay) { if (lay.dataset.layout !== ui.layout) switchLayout(lay.dataset.layout); return; }
  /* the Folders screen picks folders: a click while selecting, Shift click for a range, Cmd click to toggle */
  const ft = foldersSel() && t.closest('#app .fscreen .ftile[data-ftile]');
  if (ft && (ui.selecting || e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!ft.matches(FPICK)) return; const id = +ft.dataset.ftile;
    if (e.shiftKey && ui.anchor != null && ui.selecting) { pickRange(ui.anchor, id); ui.selecting = true; selSync(); return; }
    ui.selecting = true; ui.anchor = id; toggle(id); return; }
  const v = t.closest('[data-view]');
  if (v && !t.closest('.sheet')) { const raw = v.dataset.view; goView(/^\d+$/.test(raw) ? +raw : raw); return; }
  const tileEl = t.closest('#app article[data-id]');
  /* Cmd or Ctrl click opens the link in a new background tab, one after another, as browsers do; a modifier means a
     keyboard and a pointer, so this holds at every width */
  if (tileEl && (e.metaKey || e.ctrlKey) && !e.shiftKey && !t.closest('.acts, .menu')) {
    const b = bm(+tileEl.dataset.id); if (!b || b.deleted_at) return;
    if (!t.closest('a[href]')) { e.preventDefault(); const l = tileEl.querySelector('a[data-open]'); if (l) l.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: e.metaKey, ctrlKey: e.ctrlKey })); else actions.open(b); return; }
    actions.opened(b.id); return;
  }
  /* Shift click selects a range from the last picked card */
  if (tileEl && e.shiftKey && !t.closest('.acts, .menu')) {
    e.preventDefault(); const id = +tileEl.dataset.id; ui.selecting = true;
    if (ui.anchor != null) pickRange(ui.anchor, id); else { ui.picked.add(id); ui.anchor = id; }
    selSync(true); return;
  }
  const op = t.closest('[data-open]'); if (op && !ui.selecting) { actions.opened(+op.dataset.open); return; }
  /* while selecting a click or tap anywhere on a card toggles it and sets where a Shift click range starts, at every width */
  if (tileEl && ui.selecting) { e.preventDefault(); ui.anchor = +tileEl.dataset.id; toggle(+tileEl.dataset.id); return; }
  const a = t.closest('[data-a]'); if (!a) return;
  const k = a.dataset.a, b = tileEl ? bm(+tileEl.dataset.id) : null;
  switch (k) {
    case 'pick': e.preventDefault(); if (tileEl) toggle(+tileEl.dataset.id); break;
    case 'share': actions.share(b); break;
    case 'open': actions.open(b); break;
    case 'trash': actions.trash([b.id]); break;
    case 'restore': actions.restore([b.id]); break;
    case 'purge': actions.purge([b.id]); break;
    case 'more': if (layers.menu && layers.menu.anchor === a) closeMenu(); else openMenu(a, tileMenu(b)); break;
    case 'tile-acts': openSheet({ type: 'acts', id: b.id }); break;
    /* a card in Trash never opens its link: a click offers Restore and Delete, in the menu at the card on the desktop */
    case 'tile-menu': if (layers.menu && layers.menu.anchor === a) closeMenu(); else openMenu(a, tileMenu(b), e.detail ? { x: e.clientX, y: e.clientY } : undefined); break;
    case 'add': layers.save = newSave({ folder: typeof ui.view === 'number' ? ui.view : undefined }); openSheet({ type: 'save' }); break;
    case 'sort': sortMenu(a, sortItems()); break;
    case 'fsort': sortMenu(a, fsortItems()); break;
    case 'select': if (ui.selecting) exitSelect(); else { ui.selecting = true; ui.picked.clear(); selSync(); } break;
    case 'foot': { ui.footOpen = !ui.footOpen; store.set('foot', ui.footOpen ? 'open' : ''); const f = a.closest('.side-foot');
      f.classList.toggle('open', ui.footOpen); a.setAttribute('aria-expanded', ui.footOpen); break; }
    case 'sel-all': selectables().forEach(id => ui.picked.add(id)); selSync(); break;
    case 'sel-more': { const it = selItems(), n = ui.picked.size; if (it.length) menuOrSheet(a, it, n === 1 ? bm([...ui.picked][0]) : `${n} selected`); break; }
    case 'bulk-copy': bulkCopy(); break;
    case 'bulk-share': bulkShare(); break;
    case 'bulk-move': if (ui.picked.size) openSheet({ type: 'move', ids: [...ui.picked] }); break;
    case 'bulk-ftrash': deleteFolders([...ui.picked]); break;
    case 'bulk-trash': { const ids = [...ui.picked]; ui.selecting = false; actions.trash(ids).then(() => { ui.picked.clear(); render(); }); break; }
    case 'bulk-restore': { const ids = [...ui.picked]; ui.selecting = false; ui.picked.clear(); actions.restore(ids); break; }
    case 'bulk-purge': { const ids = [...ui.picked]; ui.selecting = false; ui.picked.clear(); actions.purge(ids); break; }
    case 'folder-menu': menuOrSheet(a, folderItems(ui.view), folderById.get(ui.view)); break;
    case 'empty-trash': emptyTrash(); break;
    case 'new-folder': newFolder(null); break;
    case 'tab': { const to = a.dataset.tab; if (ui.view !== to) goView(to); break; } /* the tab's shape glides; the content is there at once */
    case 'import': byId('import-file').click(); break;
    case 'tokens': openTokens(); break;
    case 'releases': openReleases(); break;
    case 'tk-copy': tokenCopy(); break;
    case 'tk-revoke': layers.sheet.confirm = +a.dataset.id; fillSheet(); { const y = sheetEl().querySelector('[data-a="tk-revoke-yes"]'); if (y) y.focus({ preventScroll: true }); } break;
    case 'tk-cancel': layers.sheet.confirm = null; fillSheet(); break;
    case 'tk-revoke-yes': a.disabled = true; tokenRevoke(+a.dataset.id); break;
    case 'logout': logout(); break;
    case 'retry': data.error = null; data.loaded = false; render(); load(); break;
    case 'close': closeSheet(); break;
    case 'confirm': { const r = layers.sheet.run; a.disabled = true; r().then(() => closeSheet(), err => { if (!err.auth) toast(errorText(err, 'That did not work. Try again.')); closeSheet(); }); break; }
    case 'choose': layers.save.picker = !layers.save.picker; layers.save.nf = false; fillSheet(); break;
    case 'save-inbox': doSave(true); break;
    case 'nf-open': layers.sheet.nf = true; if (layers.save && layers.sheet.type === 'save') layers.save.nf = true; fillSheet(); { const i = sheetEl().querySelector('[data-nf] input'); if (i) i.focus(); } break;
    case 'nf-create': nfCreate(); break;
    case 'palette': openPalette(); break;
    case 'share-open': if (typeof ui.view === 'number') openSheet({ type: 'share', fid: ui.view }); break;
    case 'relock': if (typeof ui.view === 'number') { const f = chain(ui.view).find(x => x.locked); if (f) relock(f.id); } break;
    case 'add-to': openAddTo(ui.view === 'inbox' ? null : ui.view); break;
    case 'add-new': { const last = folderById.has(data.settings.last_folder) ? data.settings.last_folder : null;
      layers.save = newSave({ folder: typeof ui.view === 'number' ? ui.view : last }); openSheet({ type: 'save' });
      const ta = sheetEl().querySelector('textarea'); if (ta) ta.focus({ preventScroll: true }); break; }
    case 'at-move': atMove(); break;
    case 'share-toggle': shareToggle(); break;
    case 'share-copy': shareCopy(); break;
    case 'share-native': shareNative(); break;
    case 'share-lock': shareLock(); break;
    case 'share-pw-change': layers.sheet.pwEdit = true; fillSheet(); { const i = sheetEl().querySelector('[name=pw]'); if (i) i.focus(); } break;
    case 'share-pw-cancel': layers.sheet.pwEdit = false; layers.sheet.pwErr = null; fillSheet(); break;
    case 'share-pw-remove': shareUnlock(); break;
    case 'share-exp': { const n = a.dataset.exp === 'never' ? null : +a.dataset.exp; layers.sheet.days = n; sharePatch({ expires_days: n }); break; }
    case 'done': location.href = '/'; break;
  }
}
export function onSubmit(e) {
  const f = e.target; if (!f.matches('[data-save], [data-name], [data-sharepw], [data-lock], [data-token]')) return; /* the login form posts natively */
  e.preventDefault();
  if (f.matches('[data-lock]')) { submitLock(f); return; }
  if (f.matches('[data-token]')) { tokenCreate(f); return; }
  if (f.matches('[data-sharepw]')) { const v = f.elements.pw.value; if (!v) { f.elements.pw.focus(); return; } sharePassword(f, v); return; }
  if (f.matches('[data-save]')) { doSave(false); return; }
  if (f.matches('[data-name]')) { const v = f.elements.v.value.trim(); if (!v) { f.elements.v.focus(); return; }
    const s = layers.sheet, btn = f.querySelector('button'); btn.disabled = true;
    s.submit(v).then(() => { if (layers.sheet === s) closeSheet(); }, err => { if (err.auth) return; s.err = errorText(err, 'That did not work. Try again.'); s.value = v; fillSheet(); });
    return; }
}
export function nfCreate() {
  { const inp = sheetEl().querySelector('[data-nf] input'); const v = inp ? inp.value.trim() : ''; if (!v) { if (inp) inp.focus(); return; } const s = layers.sheet;
    api('POST', '/api/folders', { name: v, parent_id: null }).then(async nf => { await loadQuiet();
      if (layers.sheet !== s) return;
      if (s.type === 'save') { layers.save.folder = nf.id; layers.save.recent = [nf.id, ...layers.save.recent.filter(x => x !== nf.id)].slice(0, 3); layers.save.picker = false; layers.save.nf = false; fillSheet(); }
      else if (s.type === 'move') { const ids = s.ids; closeSheet(); if (ui.selecting) { ui.selecting = false; ui.picked.clear(); } actions.move(ids, nf.id); } },
    err => { if (!err.auth) toast(errorText(err, 'That did not work. Try again.')); });
  }
}
export function onInput(e) {
  const t = e.target;
  if (t.dataset.f && layers.save) { layers.save[t.dataset.f] = t.value; if (t.tagName === 'TEXTAREA') { fitTa(t); checkUrl(); } patchSave(); }
}
