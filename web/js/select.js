/* Selection: Finder style Cmd and Shift clicks and Shift arrows with a mouse or keyboard, a marquee drawn on empty
   space, and painting a selection with a finger at any width. On the Folders screen the same gestures pick folders. */
import { moveFocus } from './keys.js';
import { galShell } from './home.js';
import { deskToolbar, phoneBulk, ptShell, render, setDeskBar, setTb } from './render.js';
import { bm, foldersSel, layers, listFor, ui } from './state.js';
import { byId, setBar } from './util.js';

export function exitSelect() { ui.selecting = false; ui.picked.clear(); ui.anchor = null; selSync(); }

/* a tick, Select, Done or a hold changes only the selection: the cards, the folder tiles, the bars and Select change in
   place, so no card is drawn again and no favicon reloads; pop gives a newly ticked card its one motion, the tick popping in */
export function selSync(pop) {
  if (!ui.mode || (typeof ui.view === 'number' && !listFor().length)) { render(); return; }
  if (ui.mode === 'desk') { byId('screen').classList.toggle('selecting', ui.selecting); setTb(byId('tbwrap'), deskToolbar()); setDeskBar(); }
  else barSync();
  for (const a of document.querySelectorAll('#app article[data-id]')) {
    const id = +a.dataset.id, on = ui.picked.has(id), was = a.classList.contains('picked'); a.classList.toggle('picked', on);
    if (a.matches('.tile')) { const c = a.querySelector('.chk'); if (c) { c.setAttribute('aria-checked', on); ui.selecting ? c.removeAttribute('tabindex') : c.setAttribute('tabindex', '-1'); } }
    else { const o = a.firstElementChild; if (!o) continue;
      if ((o.dataset.a === 'pick') !== ui.selecting) { const b = bm(id); if (b) reshell(a, a.matches('.pt') ? ptShell(b, '') : galShell(b, '')); }
      else if (ui.selecting) o.setAttribute('aria-checked', on); }
    if (pop && on && !was) popTick(a);
  }
  if (foldersSel()) for (const f of document.querySelectorAll(FPICK)) { const on = ui.picked.has(+f.dataset.ftile), was = f.classList.contains('picked');
    f.classList.toggle('picked', on); if (ui.selecting) f.setAttribute('aria-pressed', on); else f.removeAttribute('aria-pressed');
    if (pop && on && !was) popTick(f); }
}
/* the new link or checkbox takes over what the old one held: the favicon, the title, the strip */
function reshell(a, html) {
  const o = a.firstElementChild, n = Object.assign(document.createElement('template'), { innerHTML: html }).content.firstElementChild, chk = n.querySelector(':scope > .chk');
  n.replaceChildren(...[...o.childNodes].filter(c => !(c.classList && c.classList.contains('chk'))), ...(chk ? [chk] : []));
  const had = document.activeElement === o; o.replaceWith(n); if (had) n.focus({ preventScroll: true });
}
/* the one tick motion, the same at every width */
export function popTick(el) { clearTimeout(el._pop); el.classList.remove('tick-in'); void el.offsetWidth; el.classList.add('tick-in'); el._pop = setTimeout(() => el.classList.remove('tick-in'), 300); } /* off by time: a pop cut short by Done never replays */

/* ================= drag to select in the grid ================= */
/* select mode: a finger that starts on a card (or a folder on the Folders screen) paints every one it passes with the
   first one's new state, at every width */
let paintState = null;
const paintSel = () => foldersSel() ? FPICK : '#app article[data-id]';
export const tileAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest(paintSel()); };
export function paintSet(t) { const id = pickId(t), on = paintState.on; if (ui.picked.has(id) === on) return;
  on ? ui.picked.add(id) : ui.picked.delete(id); t.classList.toggle('picked', on); const b = t.querySelector('[role="checkbox"]'); if (b) b.setAttribute('aria-checked', on);
  if (t.hasAttribute('aria-pressed')) t.setAttribute('aria-pressed', on);
  if (on) popTick(t); barSync(); }
export function paintLoop() { if (!paintState || !paintState.active) return; const y = paintState.cy, edge = 60, sc = ui.mode === 'desk' ? byId('content') : null;
  const R = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight }, dy = y < R.top + edge ? -10 : y > R.bottom - edge ? 10 : 0;
  if (dy) { if (sc) sc.scrollTop += dy; else window.scrollBy(0, dy); const t = tileAt(paintState.cx, paintState.cy); if (t) paintSet(t); }
  paintState.raf = requestAnimationFrame(paintLoop); }

/* mouse or pen, any width: a drag that starts on empty space draws a marquee and selects what it touches; Shift adds */
let marquee = null;
export const emptySpace = t => (t.closest('#content') && !t.closest('article, button, a, input, label, .tb, .head, #dockwrap'))
  || (t.closest('#pmain') && !t.closest('article, button, a, input, label, .ptbar, .vbar, .precent, .phead'));
/* what a selection can hold here: the folder tiles of the Folders screen, or the cards */
export const FPICK = '#app .fscreen .ftile[data-ftile]:not(.locked)';
export const pickEls = () => [...document.querySelectorAll(foldersSel() ? FPICK : '#app article[data-id]')];
export const pickId = el => +(el.dataset.ftile || el.dataset.id);
/* the selection bar follows without a full redraw, so nothing moves under a marquee */
export function barSync() {
  if (ui.mode === 'desk') { byId('screen').classList.toggle('selecting', ui.selecting); setTb(byId('tbwrap'), deskToolbar()); setDeskBar(); return; }
  for (const b of document.querySelectorAll('#pmain [data-a="select"]')) { b.setAttribute('aria-pressed', ui.selecting); b.setAttribute('aria-label', ui.selecting ? 'Done' : 'Select'); }
  byId('papp').classList.toggle('selecting', ui.selecting); setBar(byId('pbulkwrap'), ui.selecting ? phoneBulk() : '');
}

/* Finder style selection: Cmd click toggles, Shift click and Shift arrows take a range */
export const visualIds = () => pickEls().map(pickId);
export function pickRange(a, b) { const ids = visualIds(); let i = ids.indexOf(a), j = ids.indexOf(b); if (i < 0) i = j; if (i > j) [i, j] = [j, i]; ids.slice(i, j + 1).forEach(id => ui.picked.add(id)); }
export function extendByKey(key) {
  const cur = document.activeElement && document.activeElement.closest && document.activeElement.closest('#app article[data-id]'); if (!cur) { moveFocus(key); return; }
  if (ui.anchor == null || !ui.selecting) { ui.anchor = +cur.dataset.id; ui.picked.clear(); }
  moveFocus(key); const now = document.activeElement.closest('#app article[data-id]'); if (!now) return;
  ui.selecting = true; ui.picked.clear(); pickRange(ui.anchor, +now.dataset.id); selSync();
}
export function toggle(id) { ui.picked.has(id) ? ui.picked.delete(id) : ui.picked.add(id); selSync(true); }


/* listeners on document and window, registered once by app.js */
export function installSelect() {
  document.addEventListener('pointerdown', e => {
    if (!ui.selecting || layers.sheet || e.button > 0 || e.pointerType === 'mouse') return; const t = e.target.closest(paintSel()); if (!t) return;
    paintState = { pid: e.pointerId, x: e.clientX, y: e.clientY, first: t, on: !ui.picked.has(pickId(t)), active: false, raf: 0 };
  });
  document.addEventListener('pointermove', e => {
    if (!paintState || e.pointerId !== paintState.pid) return; paintState.cx = e.clientX; paintState.cy = e.clientY;
    if (!paintState.active) { if (Math.hypot(e.clientX - paintState.x, e.clientY - paintState.y) < 8) return; paintState.active = true; paintSet(paintState.first); paintLoop(); }
    const t = tileAt(e.clientX, e.clientY); if (t) paintSet(t);
  });
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, e => { if (!paintState || e.pointerId !== paintState.pid) return;
    const was = paintState.active; cancelAnimationFrame(paintState.raf); paintState = null; if (was) { ui.suppressClick = performance.now() + 350; selSync(); } }));
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.pointerType === 'touch' || layers.sheet || layers.palette || layers.menu || !emptySpace(e.target)) return;
    marquee = { pid: e.pointerId, x: e.clientX, y: e.clientY, base: e.shiftKey ? new Set(ui.picked) : new Set(), el: null };
  });
  document.addEventListener('pointermove', e => {
    if (!marquee || e.pointerId !== marquee.pid) return;
    if (!marquee.el) { if (Math.hypot(e.clientX - marquee.x, e.clientY - marquee.y) < 5) return; marquee.el = document.createElement('div'); marquee.el.className = 'marquee'; document.body.appendChild(marquee.el); document.body.classList.add('marqueeing'); }
    const l = Math.min(marquee.x, e.clientX), t = Math.min(marquee.y, e.clientY), r = Math.max(marquee.x, e.clientX), b = Math.max(marquee.y, e.clientY);
    Object.assign(marquee.el.style, { left: l + 'px', top: t + 'px', width: r - l + 'px', height: b - t + 'px' });
    const picked = new Set(marquee.base);
    pickEls().forEach(a => { const R = a.getBoundingClientRect(), id = pickId(a);
      const hit = R.left < r && R.right > l && R.top < b && R.bottom > t; if (hit) picked.add(id);
      a.classList.toggle('picked', picked.has(id)); });
    ui.picked = picked; ui.selecting = picked.size > 0 || marquee.base.size > 0; barSync();
  });
  /* a finger tap on empty space ends selecting as a click does: iOS sends no click for a tap on a plain area, and the
     click it may send to a card beside a gutter is swallowed, so only a card's own box toggles it */
  let tapEnd = null;
  document.addEventListener('pointerdown', e => { tapEnd = null; if (!ui.selecting || e.pointerType === 'mouse' || !e.isPrimary || layers.sheet || layers.palette || layers.menu) return;
    const at = document.elementFromPoint(e.clientX, e.clientY) || e.target; /* what is under the finger itself, not a card the browser moved the tap to */
    if (emptySpace(at)) tapEnd = { pid: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; });
  document.addEventListener('pointercancel', () => { tapEnd = null; });
  document.addEventListener('pointerup', e => { const s = tapEnd; tapEnd = null;
    if (!s || e.pointerId !== s.pid || !ui.selecting || performance.now() - s.t > 450 || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) return;
    ui.suppressClick = performance.now() + 350; exitSelect(); });
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, e => { if (!marquee || e.pointerId !== marquee.pid) return;
    const drew = !!marquee.el; if (marquee.el) marquee.el.remove(); document.body.classList.remove('marqueeing'); marquee = null;
    if (drew) { ui.suppressClick = performance.now() + 350; if (!ui.picked.size) ui.selecting = false; selSync(); } }));
}
