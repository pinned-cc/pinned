/* Phone only switches: the bottom bar follows the on screen keyboard, and the More menu rows. */
import { emptyTrash, folderItems, goView, homeItems, sortItems, newFolder } from './actions.js';
import { openSheet } from './sheets.js';
import { SORTS, count, ui } from './state.js';
import { byId } from './util.js';

export function vvSync() {
  if (window.visualViewport) { const r = document.documentElement.style; r.setProperty('--vvh', visualViewport.height + 'px'); r.setProperty('--vvt', visualViewport.offsetTop + 'px'); } /* sheets and dialogs fit the visible screen */
  const el = byId('pbottom'); if (!el || !window.visualViewport) return;
  const vv = window.visualViewport, off = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  el.style.transform = off > 0 ? `translateY(${-off}px)` : '';
}
export const phoneMenu = () => { const v = ui.view, rows = [];
  if (v !== 'inbox') rows.push({ icon: 'inbox', label: `Inbox, ${count('inbox')}`, run: () => goView('inbox') }, '-');
  if (typeof v === 'number') rows.push(...folderItems(v), '-');
  if (v === 'trash') rows.push({ icon: 'trash', label: 'Empty trash', warn: true, disabled: !count('trash'), run: emptyTrash }, '-');
  if (v !== 'trash' && v !== 'recent' && v !== 'folders') rows.push({ icon: 'sort', label: 'Sort, ' + SORTS[ui.sort].toLowerCase(), run: () => openSheet({ type: 'rows', head: 'Sort', rows: sortItems() }) });
  rows.push('-', { icon: 'all', label: `All bookmarks, ${count('all')}`, run: () => goView('all') }, { icon: 'trash', label: `Trash, ${count('trash')}`, run: () => goView('trash') }, '-', { icon: 'folder-plus', label: 'New folder', run: () => newFolder(null) });
  return rows; };


/* listeners on document and window, registered once by app.js */
export function installPhone() {
  if (window.visualViewport) { visualViewport.addEventListener('resize', vvSync); visualViewport.addEventListener('scroll', vvSync); }
}
