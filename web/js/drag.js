/* Drag to reorder tiles, folders and the pinned dock with pointer events, drop a tile on a folder, and the long
   press menu. */
import { folderItems, folderSheetItems, moveWithUndo } from './actions.js';
import { api } from './api.js';
import { openMenu, tileMenu } from './menu.js';
import { closeSheet, openSheet } from './sheets.js';
import { bm, folderById, layers, run, setSort, ui } from './state.js';
import { toast } from './toast.js';
import { byId, reduce } from './util.js';

/* ================= drag to reorder (pointer events, no library) ================= */
/* only the pinned dock reorders; the desktop Recent row wears the same .dk items and does not */
export const DSEL = { tile: '.tile:not(.sk), .pt:not(.sk)', frow: '.sf[data-fid]', dock: '.dock .dk, .prc.pinned', recent: '.prc', ftile: '.ftile' };
let dragState = null;
export function dragKind(t) {
  if (t.closest('.sheet, .menu, .pal, input, textarea, .acts, .chk')) return null;
  for (const k of ['dock', 'recent', 'ftile', 'frow', 'tile']) { const el = t.closest(DSEL[k]); if (el && el.closest('#app')) return { k, el }; }
  return null;
}
export function canReorder(k, el) {
  if (k === 'recent' || k === 'ftile') return false; /* folder tiles open and take drops; folder order is set in the sidebar */
  if (k === 'tile') return ui.selecting ? ui.picked.has(+el.dataset.id) : true; /* a card can always be carried to a folder */
  return !ui.selecting;
}
/* where a carried card lands: a folder tile, a folder in the sidebar, or the Inbox */
const DROPS = '#app .ftile:not(.locked), #app .sf[data-fid]:not(.locked), #app .nav .si[data-view="inbox"]';
const dropFolder = d => d.dataset.ftile ? +d.dataset.ftile : d.dataset.fid ? +d.dataset.fid : null;
/* only the pointer that started the press counts; a second finger or a stray mouse move does not */
/* the scrim closes on pointer up: WebKit does not always synthesise a click for a tap on a plain div */
export function dragCancel() { if (!dragState) return; clearTimeout(dragState.timer); dragState.el.classList.remove('press'); if (!layers.sheet) dragState.el.classList.remove('lift', 'held'); dragState = null; }
export const subsOf = el => { const n = el.nextElementSibling; return el.dataset.fid && n && n.matches('.subs') && n.dataset.parent === el.dataset.fid ? n : null; };
export function dragBegin(e) {
  const el = dragState.el, r = el.getBoundingClientRect(), g = el.cloneNode(true);
  g.classList.remove('lift', 'press', 'held'); g.classList.add('ghost'); g.removeAttribute('id');
  Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  g.setAttribute('aria-hidden', 'true'); document.body.appendChild(g);
  el.classList.remove('lift', 'press', 'held'); el.classList.add('placeholder');
  /* a selection travels together; the order is only rearranged for a single card in a folder or the Inbox */
  dragState.ids = dragState.k === 'tile' && ui.selecting ? [...ui.picked] : [+el.dataset.id];
  dragState.sort = dragState.k !== 'tile' || (!ui.selecting && !!el.parentElement.closest('[data-container]'));
  if (dragState.ids.length > 1) { const n = document.createElement('span'); n.className = 'drag-n'; n.textContent = dragState.ids.length; g.appendChild(n); }
  dragState.active = true; dragState.ghost = g; dragState.ox = e.clientX - r.left; dragState.oy = e.clientY - r.top; dragState.cont = el.parentElement; dragState.cont.classList.add('sorting');
  dragState.before = [...dragState.cont.children].filter(x => x.matches(DSEL[dragState.k])).map(x => x.dataset.id || x.dataset.fid).join(',');
  document.body.classList.add('dragging'); dragMove(e); dragLoop();
}
export function dragMove(e) { dragState.cx = e.clientX; dragState.cy = e.clientY; dragStep(); }
/* hit test against layout boxes, not the boxes mid reflow animation, so items do not chase the pointer */
export function itemAt(x, y) {
  for (const n of dragState.cont.children) { if (n === dragState.el || !n.matches(DSEL[dragState.k])) continue;
    const r = n.getBoundingClientRect(), m = new DOMMatrixReadOnly(getComputedStyle(n).transform === 'none' ? undefined : getComputedStyle(n).transform);
    const l = r.left - m.m41, t = r.top - m.m42; if (x >= l && x <= l + r.width && y >= t && y <= t + r.height) return n; }
  return null;
}
export function dragStep() {
  const g = dragState.ghost, x = dragState.cx, y = dragState.cy;
  g.style.transform = `translate(${x - dragState.x}px, ${y - dragState.y}px)` + (dragState.k === 'tile' ? ' scale(1.04)' : '');
  if (dragState.k === 'tile') { const u = document.elementFromPoint(x, y), f = u && u.closest(DROPS);
    if (dragState.drop !== f) { if (dragState.drop) dragState.drop.classList.remove('drop-on'); dragState.drop = f || null; if (f) f.classList.add('drop-on'); }
    if (f || !dragState.sort) return; }
  const t = itemAt(x, y);
  if (t && t !== dragState.el) {
    /* the rest of the grid reflows around the lifted item: first, last, invert, play */
    const sib = [...dragState.cont.children].filter(n => n !== g), first = new Map(sib.map(n => [n, n.getBoundingClientRect()]));
    const items = [...dragState.cont.children], a = items.indexOf(dragState.el), b = items.indexOf(t), own = subsOf(dragState.el);
    dragState.cont.insertBefore(dragState.el, a < b ? (subsOf(t) || t).nextSibling : t);
    if (own) dragState.cont.insertBefore(own, dragState.el.nextSibling); /* a folder carries its open subfolders */
    if (!reduce()) sib.forEach(n => { if (n === dragState.el) return; const f = first.get(n), l = n.getBoundingClientRect(), dx = f.left - l.left, dy = f.top - l.top; if (!dx && !dy) return;
      n.style.transition = 'none'; n.style.transform = `translate(${dx}px, ${dy}px)`; void n.offsetWidth;
      n.style.transition = 'transform 160ms var(--ease-out)'; n.style.transform = ''; setTimeout(() => { n.style.transition = ''; }, 180); });
  }
}
/* scroll while the finger or mouse rests near an edge */
export function dragLoop() {
  if (!dragState || !dragState.active) return; const y = dragState.cy, edge = 60;
  /* a lifted card held near either end of a folder row scrolls that row slowly */
  if (dragState.k === 'tile') { const row = [...document.querySelectorAll('#app .fscroll')].find(r => { const R = r.getBoundingClientRect(); return y >= R.top && y <= R.bottom; });
    if (row) { const R = row.getBoundingClientRect(), d = dragState.cx < R.left + 48 ? -4 : dragState.cx > R.right - 48 ? 4 : 0;
      if (d) { row.scrollLeft += d; dragStep(); requestAnimationFrame(dragLoop); return; } } }
  if (dragState.k !== 'dock') {
    const sc = ui.mode === 'desk' ? (dragState.k === 'frow' ? document.querySelector('.side-tree') : byId('content')) : null;
    if (sc) { const R = sc.getBoundingClientRect(); const d = y < R.top + edge ? -10 : y > R.bottom - edge ? 10 : 0; if (d) { sc.scrollTop += d; dragStep(); } }
    else if (dragState.k === 'tile') { const d = y < edge ? -10 : y > innerHeight - edge - 84 ? 10 : 0; if (d) { window.scrollBy(0, d); dragStep(); } }
  }
  requestAnimationFrame(dragLoop);
}
export function dragEnd() {
  const { k, el, cont, ghost, before, drop, ids: carried, sort } = dragState; dragState = null;
  ghost.remove(); el.classList.remove('placeholder', 'lift', 'held'); cont.classList.remove('sorting'); document.body.classList.remove('dragging');
  if (drop) { drop.classList.remove('drop-on'); if (ui.selecting) { ui.selecting = false; ui.picked.clear(); } moveWithUndo(carried, dropFolder(drop)); return; }
  if (!sort) return;
  const ids = [...cont.children].filter(x => x.matches(DSEL[k])).map(x => +(x.dataset.id || x.dataset.fid));
  if (ids.join(',') === before) return;
  if (k === 'tile') { const c = cont.dataset.container, folder = c === 'inbox' ? null : +c;
    const all = [...document.querySelectorAll(`#app [data-container="${c}"] > article`)].map(x => +x.dataset.id);
    setSort('manual'); run(api('PUT', '/api/bookmarks/order', { folder_id: folder, ids: all })).then(r => { if (r.ok) toast('Order saved'); }); }
  else if (k === 'frow') { const p = cont.dataset.parent; run(api('PUT', '/api/folders/order', { parent_id: p ? +p : null, ids })).then(r => { if (r.ok) toast('Order saved'); }); }
  else run(api('PUT', '/api/pinned/order', { ids }));
}
export function heldAction(k, el, e) {
  if (k === 'ftile') { const id = +el.dataset.ftile; if (ui.mode === 'phone') openSheet({ type: 'rows', head: folderById.get(id), rows: folderSheetItems(id) }); else openMenu(el, folderSheetItems(id), { x: e.clientX, y: e.clientY }); return; }
  if (k === 'frow') { const id = +el.dataset.fid; if (ui.mode === 'phone') openSheet({ type: 'rows', head: folderById.get(id), rows: folderItems(id) }); else openMenu(el, folderItems(id), { x: e.clientX, y: e.clientY }); return; }
  const id = +el.dataset.id, b = bm(id); if (!b) return;
  if (ui.mode === 'phone') openSheet({ type: 'acts', id }); else openMenu(el, b.deleted_at ? [] : tileMenu(b), { x: e.clientX, y: e.clientY });
}


/* listeners on document and window, registered once by app.js */
export function installDrag() {
  document.addEventListener('pointerdown', e => {
    ui.suppressClick = 0;
    if (document.body.dataset.page !== 'app' || e.button > 0 || layers.sheet) return;
    const hit = dragKind(e.target); if (!hit) return;
    if (hit.k === 'tile' && ui.selecting && !ui.picked.has(+hit.el.dataset.id)) return;
    const touch = e.pointerType === 'touch';
    dragState = { k: hit.k, el: hit.el, x: e.clientX, y: e.clientY, touch, pid: e.pointerId, held: false, active: false, timer: null };
    if (touch) { if (hit.k === 'tile' && ui.mode === 'phone') hit.el.classList.add('press');
      /* 450 ms still: the press registers with a small tick; release opens the sheet, a move lifts it */
      dragState.timer = setTimeout(() => { if (!dragState) return; dragState.held = true; dragState.timer = null; hit.el.classList.remove('press'); hit.el.classList.add('held');
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) { /* ignore */ } }, 450); }
  });
  document.addEventListener('pointermove', e => {
    if (!dragState || e.pointerId !== dragState.pid) return; const d = Math.hypot(e.clientX - dragState.x, e.clientY - dragState.y);
    if (!dragState.active) {
      if (dragState.touch && !dragState.held) { if (d > 8) dragCancel(); return; }
      if (d > 8 && canReorder(dragState.k, dragState.el)) dragBegin(e); else if (d > 8 && !dragState.touch) dragState = null;
      return;
    }
    dragMove(e);
  });
  document.addEventListener('pointerup', e => {
    if (!dragState || e.pointerId !== dragState.pid) return;
    if (dragState.active) { dragEnd(); ui.suppressClick = performance.now() + 350; return; }
    if (dragState.touch && dragState.held) { ui.suppressClick = performance.now() + 350; const { k, el } = dragState; dragState = null; heldAction(k, el, e); return; }
    dragCancel();
  });
  document.addEventListener('pointercancel', e => { if (!dragState || e.pointerId !== dragState.pid) return; if (dragState.active) dragEnd(); else dragCancel(); });
  document.addEventListener('touchmove', e => { if (dragState && (dragState.held || dragState.active)) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerup', e => { if (layers.sheet && document.body.dataset.page === 'app' && e.target.classList && e.target.classList.contains('scrim')) { ui.suppressClick = performance.now() + 350; closeSheet(); } });
  document.addEventListener('click', e => { if (ui.suppressClick && performance.now() < ui.suppressClick) { ui.suppressClick = 0; e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('contextmenu', e => {
    if (ui.mode === 'phone' && e.target.closest('.pt, .prc, .ftile, .fmini')) { e.preventDefault(); return; }
    const f = ui.mode === 'desk' && e.target.closest('#app .sf[data-fid]'); if (f) { e.preventDefault(); openMenu(f, folderItems(+f.dataset.fid), { x: e.clientX, y: e.clientY }); return; }
    const t = e.target.closest('#app .ftile'); if (t) { e.preventDefault(); if (ui.mode === 'desk') openMenu(t, folderSheetItems(+t.dataset.ftile), { x: e.clientX, y: e.clientY }); } });
  document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('#app')) e.preventDefault(); });
}
