/* Drag to reorder tiles, folders and the pinned dock with pointer events, drop a tile on a folder or on Trash, a long
   press (finger or mouse) that starts selecting, and the right click menu on a card or folder. */
import { actions, deleteFolders, folderItems, folderSheetItems, goView, moveWithUndo } from './actions.js';
import { api } from './api.js';
import { openMenu, tileMenu } from './menu.js';
import { render } from './render.js';
import { closeSheet, openSheet } from './sheets.js';
import { bm, canSelect, folderById, foldersSel, layers, run, setFsort, setSort, ui } from './state.js';
import { toast } from './toast.js';
import { FPICK, selSync } from './select.js';
import { byId, reduce } from './util.js';

/* ================= drag to reorder (pointer events, no library) ================= */
/* only the pinned dock reorders; the desktop Recent row wears the same .dk items and does not. A tile is any bookmark
   card: the grid and list cards, the phone cards and the Dashboard's gallery cards and rows */
export const DSEL = { tile: '.tile:not(.sk), .pt:not(.sk), .gal article[data-id]', frow: '.sf[data-fid]', dock: '.dock .dk, .prc.pinned', recent: '.prc', ftile: '.ftile[data-ftile]' };
let dragState = null, lastTouch = -1e9;
export function dragKind(t) {
  if (t.closest('.sheet, .menu, .pal, input, textarea, .acts, .chk')) return null;
  for (const k of ['dock', 'recent', 'ftile', 'frow', 'tile']) { const el = t.closest(DSEL[k]); if (el && el.closest('#app')) return { k, el }; }
  return null;
}
export function canReorder(k, el, touch) {
  if (k === 'recent') return false;
  /* folder tiles open and take drops. On the Folders screen a finger or a mouse carries them to Trash, or one of them to a new place in the order */
  if (k === 'ftile') return el.matches(FPICK) && (!ui.selecting || ui.picked.has(+el.dataset.ftile));
  if (k === 'tile') return ui.selecting ? ui.picked.has(+el.dataset.id) : true; /* a card can always be carried to a folder */
  return !ui.selecting;
}
/* where a carried card lands: a folder tile, a folder in the sidebar, or the Inbox (its sidebar row or its tab on the phone) */
const DROPS = '#app .ftile[data-ftile]:not(.locked), #app .sf[data-fid]:not(.locked), #app .nav .si[data-view="inbox"], #app .ptab[data-tab="inbox"]';
const dropFolder = d => d.dataset.ftile ? +d.dataset.ftile : d.dataset.fid ? +d.dataset.fid : null;
/* a card held over the Folders tab opens it, so it can land on a folder or on Trash there */
const SPRING = '#app .ptab[data-tab="folders"]';
function springAt(u) {
  const t = u && u.closest(SPRING), on = !!t && ui.view !== 'folders';
  if (dragState.springEl && dragState.springEl !== t) { dragState.springEl.classList.remove('drop-on'); clearTimeout(dragState.spring); dragState.spring = dragState.springEl = null; }
  if (!on || dragState.springEl) return;
  dragState.springEl = t; t.classList.add('drop-on');
  dragState.spring = setTimeout(() => { if (!dragState || !dragState.active) return; dragState.spring = dragState.springEl = null; dragState.sort = false; goView('folders'); dragStep(); }, 450);
}
/* Trash takes cards and folders: the sidebar Trash and the Trash row of the Folders screen */
const TRASH = '#app .si[data-view="trash"], #app .ftrash';
const trashAt = (x, y) => { if (ui.view === 'trash') return null; const u = document.elementFromPoint(x, y); return u && u.closest(TRASH); };
/* the press that a mouse holds still to start selecting: a card, or a folder on the Folders screen */
const holdable = (k, el) => (k === 'tile' && canSelect()) || (k === 'ftile' && el.matches(FPICK));
/* only the pointer that started the press counts; a second finger or a stray mouse move does not */
/* the scrim closes on pointer up: WebKit does not always synthesise a click for a tap on a plain div */
/* a finger's touch events keep going to the node it first touched, even once a view swap (the Folders tab opening
   under a carried card) takes that node out of the page, where a listener on document no longer hears them: the
   node itself holds the scroll back, so the browser never takes the gesture over and cancels the drag */
const holdScroll = e => { if (dragState && (dragState.held || dragState.active)) e.preventDefault(); };
const letScroll = st => { if (st && st.tgt) st.tgt.removeEventListener('touchmove', holdScroll); };
export function dragCancel() { if (!dragState) return; letScroll(dragState); clearTimeout(dragState.timer); clearTimeout(dragState.spring); dragState.el.classList.remove('press'); if (!layers.sheet) dragState.el.classList.remove('lift', 'held'); dragState = null; }
const dragId = x => +(x.dataset.id || x.dataset.fid || x.dataset.ftile);
export const subsOf = el => { const n = el.nextElementSibling; return el.dataset.fid && n && n.matches('.subs') && n.dataset.parent === el.dataset.fid ? n : null; };
export function dragBegin(e) {
  const el = dragState.el, r = el.getBoundingClientRect(), g = el.cloneNode(true);
  g.classList.remove('lift', 'press', 'held'); g.classList.add('ghost'); g.removeAttribute('id');
  Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  g.setAttribute('aria-hidden', 'true'); document.body.appendChild(g);
  el.classList.remove('lift', 'press', 'held'); el.classList.add('placeholder');
  /* a selection travels together; the order is only rearranged for a single card in a folder or the Inbox */
  const k = dragState.k; dragState.ids = (k === 'tile' || k === 'ftile') && ui.selecting ? [...ui.picked] : [+(el.dataset.id || el.dataset.ftile || el.dataset.fid)];
  dragState.sort = k === 'ftile' ? !ui.selecting && !!el.closest('.fscreen') : k !== 'tile' || (!ui.selecting && !!el.parentElement.closest('[data-container]'));
  if (dragState.ids.length > 1) { const n = document.createElement('span'); n.className = 'drag-n'; n.textContent = dragState.ids.length; g.appendChild(n); }
  for (const w of [byId('side'), byId('dockwrap')]) if (w) w._h = ''; /* the drag moves their nodes: the next render draws them anew */
  dragState.active = true; dragState.ghost = g; dragState.ox = e.clientX - r.left; dragState.oy = e.clientY - r.top; dragState.cont = el.parentElement; dragState.cont.classList.add('sorting');
  dragState.before = [...dragState.cont.children].filter(x => x.matches(DSEL[dragState.k])).map(dragId).join(',');
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
  /* over Trash the carried item shrinks toward the pointer, so the lit target shows */
  const bin = dragState.drop && dragState.drop.matches(TRASH); g.style.transformOrigin = bin ? `${dragState.ox}px ${dragState.oy}px` : '';
  /* the carried item sits under the pointer with no delay; only its size eases (app.css) */
  g.style.translate = `${x - dragState.x}px ${y - dragState.y}px`; g.style.scale = bin ? '.45' : dragState.k === 'tile' ? '1.04' : '';
  const k = dragState.k;
  if (k === 'tile' || k === 'ftile' || k === 'frow') { const u = document.elementFromPoint(x, y); let f = trashAt(x, y) || (k === 'tile' && u && u.closest(DROPS)) || null;
    if (f && f.matches('.ptab') && ui.view === 'inbox') f = null; /* the Inbox tab takes cards from elsewhere */
    if (k === 'tile') springAt(u);
    if (dragState.drop !== f) { if (dragState.drop) dragState.drop.classList.remove('drop-on'); dragState.drop = f; if (f) f.classList.add('drop-on'); dragStep(); return; }
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
  if (dragState.k !== 'dock') {
    const sc = ui.mode === 'desk' ? (dragState.k === 'frow' ? document.querySelector('.side-tree') : byId('content')) : null;
    if (sc) { const R = sc.getBoundingClientRect(); const d = y < R.top + edge ? -10 : y > R.bottom - edge ? 10 : 0; if (d) { sc.scrollTop += d; dragStep(); } }
    else if (dragState.k === 'tile' || dragState.k === 'ftile') { const d = y < edge ? -10 : y > innerHeight - edge - 84 ? 10 : 0; if (d) { window.scrollBy(0, d); dragStep(); } }
  }
  requestAnimationFrame(dragLoop);
}
export function dragEnd() {
  const { k, el, cont, ghost, before, drop, ids: carried, sort, spring, springEl } = dragState; letScroll(dragState); dragState = null;
  clearTimeout(spring); if (springEl) springEl.classList.remove('drop-on');
  ghost.remove(); el.classList.remove('placeholder', 'lift', 'held'); cont.classList.remove('sorting'); document.body.classList.remove('dragging');
  if (drop) { drop.classList.remove('drop-on');
    /* folders on Trash ask first, as Delete does; cards go at once with Undo */
    if (drop.matches(TRASH) && k !== 'tile') { if (k === 'frow') render(); deleteFolders(carried); return; }
    if (ui.selecting) { ui.selecting = false; ui.picked.clear(); }
    if (drop.matches(TRASH)) actions.trash(carried); else moveWithUndo(carried, dropFolder(drop)); return; }
  if (!sort) return;
  const ids = [...cont.children].filter(x => x.matches(DSEL[k])).map(dragId);
  if (ids.join(',') === before) return;
  if (k === 'tile') { const c = cont.dataset.container, folder = c === 'inbox' ? null : +c;
    const all = [...document.querySelectorAll(`#app [data-container="${c}"] > article`)].map(x => +x.dataset.id);
    setSort('manual'); run(api('PUT', '/api/bookmarks/order', { folder_id: folder, ids: all })).then(r => { if (r.ok) toast('Order saved'); }); }
  /* the Folders screen holds the top level: its new order is the sidebar's too, and the screen switches to Your order */
  else if (k === 'ftile') { setFsort('manual'); run(api('PUT', '/api/folders/order', { parent_id: null, ids })).then(r => { if (r.ok) toast('Order saved'); }); }
  else if (k === 'frow') { const p = cont.dataset.parent; run(api('PUT', '/api/folders/order', { parent_id: p ? +p : null, ids })).then(r => { if (r.ok) toast('Order saved'); }); }
  else run(api('PUT', '/api/pinned/order', { ids }));
}
/* hold and let go on a card or a folder on the Folders screen: selecting starts with it ticked, or it joins a running
   selection. A locked folder's hold opens its actions instead */
export function holdSelect(el) {
  const f = el.matches('.ftile'), id = +(f ? el.dataset.ftile : el.dataset.id); if (!ui.selecting) { ui.selecting = true; ui.picked.clear(); }
  el.classList.remove('held', 'press', 'lift'); ui.picked.add(id); ui.anchor = id; selSync(true);
}
export function heldAction(k, el, e, touch) {
  if (k === 'tile' && canSelect()) { holdSelect(el); return; }
  if (k === 'ftile' && el.matches(FPICK)) { holdSelect(el); return; }
  if (k === 'ftile') { const id = +el.dataset.ftile; if (ui.mode === 'phone') openSheet({ type: 'rows', head: folderById.get(id), rows: folderSheetItems(id) }); else openMenu(el, folderSheetItems(id), { x: e.clientX, y: e.clientY }); return; }
  if (k === 'frow') { const id = +el.dataset.fid; if (ui.mode === 'phone') openSheet({ type: 'rows', head: folderById.get(id), rows: folderItems(id) }); else openMenu(el, folderItems(id), { x: e.clientX, y: e.clientY }); return; }
  const id = +el.dataset.id, b = bm(id); if (!b) return;
  if (ui.mode === 'phone' && touch) openSheet({ type: 'acts', id }); else openMenu(el, tileMenu(b), { x: e.clientX, y: e.clientY });
}


/* listeners on document and window, registered once by app.js */
export function installDrag() {
  document.addEventListener('pointerdown', e => {
    ui.suppressClick = 0; if (e.pointerType === 'touch') lastTouch = performance.now();
    if (document.body.dataset.page !== 'app' || e.button > 0 || layers.sheet) return;
    const hit = dragKind(e.target); if (!hit) return;
    const touch = e.pointerType === 'touch';
    if (hit.k === 'tile' && ui.selecting && !ui.picked.has(+hit.el.dataset.id) && !touch) return;
    if (hit.k === 'ftile' && !touch && foldersSel() && (ui.selecting || e.shiftKey || e.metaKey || e.ctrlKey) && !ui.picked.has(+hit.el.dataset.ftile)) return;
    dragState = { k: hit.k, el: hit.el, x: e.clientX, y: e.clientY, touch, pid: e.pointerId, held: false, active: false, timer: null };
    /* a mouse or pen held still for 450 ms on a card does what a finger does: let go and it selects, move and it carries */
    if (!touch && !e.shiftKey && !e.metaKey && !e.ctrlKey && holdable(hit.k, hit.el) && !ui.selecting)
      dragState.timer = setTimeout(() => { if (!dragState || dragState.active) return; dragState.held = true; dragState.timer = null; hit.el.classList.add('held'); }, 450);
    if (touch) { if (hit.k === 'tile') hit.el.classList.add('press');
      dragState.tgt = e.target; e.target.addEventListener('touchmove', holdScroll, { passive: false });
      /* 450 ms still: the press registers with a small tick; release starts selecting, a move lifts it */
      dragState.timer = setTimeout(() => { if (!dragState) return; dragState.held = true; dragState.timer = null; hit.el.classList.remove('press'); hit.el.classList.add('held');
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) { /* ignore */ } }, 450); }
  });
  document.addEventListener('pointermove', e => {
    if (!dragState || e.pointerId !== dragState.pid) return; const d = Math.hypot(e.clientX - dragState.x, e.clientY - dragState.y);
    if (!dragState.active) {
      if (dragState.touch && !dragState.held) { if (d > 8) dragCancel(); return; }
      if (d > 8 && canReorder(dragState.k, dragState.el, dragState.touch)) { clearTimeout(dragState.timer); dragBegin(e); } else if (d > 8 && (!dragState.touch || dragState.k === 'tile')) dragCancel();
      return;
    }
    dragMove(e);
  });
  document.addEventListener('pointerup', e => {
    if (!dragState || e.pointerId !== dragState.pid) return;
    if (dragState.active) { dragEnd(); ui.suppressClick = performance.now() + 350; return; }
    if (dragState.held) { ui.suppressClick = performance.now() + 350; const { k, el, touch } = dragState; if (!touch) el.classList.remove('held'); letScroll(dragState); dragState = null; heldAction(k, el, e, touch); return; }
    dragCancel();
  });
  document.addEventListener('pointercancel', e => { if (!dragState || e.pointerId !== dragState.pid) return; if (dragState.active) dragEnd(); else dragCancel(); });
  document.addEventListener('touchmove', e => { if (dragState && (dragState.held || dragState.active)) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerup', e => { if (layers.sheet && document.body.dataset.page === 'app' && e.target.classList && e.target.classList.contains('scrim')) { ui.suppressClick = performance.now() + 350; closeSheet(); } });
  document.addEventListener('click', e => { if (ui.suppressClick && performance.now() < ui.suppressClick) { ui.suppressClick = 0; e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('contextmenu', e => {
    /* a right click on a card, or the menu key on a focused one: the card's actions. A long touch fires this too; there the hold has its own meaning */
    const c = document.body.dataset.page === 'app' && !e.target.closest('input, textarea') && e.target.closest('#app article[data-id], #app .dock .dk[data-id], #app .prc[data-id]');
    if (c) { e.preventDefault(); const b = bm(+c.dataset.id); if (!b || layers.sheet || performance.now() - lastTouch < 1500) return;
      const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined;
      openMenu(c.querySelector('.t-title') || c, tileMenu(b), at); return; }
    /* a long touch on a folder has its own meaning; a right click opens the folder's menu at any width */
    if (performance.now() - lastTouch < 1500 && e.target.closest('.ftile, .fmini')) { e.preventDefault(); return; }
    const f = ui.mode === 'desk' && e.target.closest('#app .sf[data-fid]'); if (f) { e.preventDefault(); openMenu(f, folderSheetItems(+f.dataset.fid), { x: e.clientX, y: e.clientY }); return; }
    const t = e.target.closest('#app .ftile[data-ftile]'); if (t) { e.preventDefault(); if (!layers.sheet) openMenu(t, folderSheetItems(+t.dataset.ftile), { x: e.clientX, y: e.clientY }); } });
  document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('#app')) e.preventDefault(); });
}
