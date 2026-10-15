/* Selection: Finder style Cmd and Shift clicks and Shift arrows on desktop, a marquee drawn on empty space, and
   painting a selection with a finger on the phone. */
import { moveFocus } from './keys.js';
import { deskToolbar, phoneBulk, render } from './render.js';
import { layers, ui } from './state.js';
import { byId } from './util.js';

export function exitSelect() { ui.selecting = false; ui.picked.clear(); ui.anchor = null; render(); }

/* ================= drag to select in the grid ================= */
/* phone, select mode: a finger that starts on a tile paints every tile it passes with the first tile's new state */
let paintState = null;
export const tileAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('#app article.pt[data-id]'); };
export function paintSet(t) { const id = +t.dataset.id, on = paintState.on; if (ui.picked.has(id) === on) return;
  on ? ui.picked.add(id) : ui.picked.delete(id); t.classList.toggle('picked', on); const b = t.querySelector('[role="checkbox"]'); if (b) b.setAttribute('aria-checked', on);
  const w = byId('pbulkwrap'); if (w) w.innerHTML = phoneBulk(); }
export function paintLoop() { if (!paintState || !paintState.active) return; const y = paintState.cy, edge = 60;
  const dy = y < edge ? -10 : y > innerHeight - edge ? 10 : 0;
  if (dy) { window.scrollBy(0, dy); const t = tileAt(paintState.cx, paintState.cy); if (t) paintSet(t); }
  paintState.raf = requestAnimationFrame(paintLoop); }

/* desktop: a drag that starts on empty grid space draws a marquee and selects what it touches; Shift adds */
let marquee = null;
export const emptySpace = t => t.closest('#content') && !t.closest('article, button, a, input, label, .tb, .head, #dockwrap');

/* Finder style selection on desktop: Cmd click toggles, Shift click and Shift arrows take a range */
export const visualIds = () => [...document.querySelectorAll('#app article[data-id]')].map(a => +a.dataset.id);
export function pickRange(a, b) { const ids = visualIds(); let i = ids.indexOf(a), j = ids.indexOf(b); if (i < 0) i = j; if (i > j) [i, j] = [j, i]; ids.slice(i, j + 1).forEach(id => ui.picked.add(id)); }
export function extendByKey(key) {
  const cur = document.activeElement && document.activeElement.closest && document.activeElement.closest('#app article[data-id]'); if (!cur) { moveFocus(key); return; }
  if (ui.anchor == null || !ui.selecting) { ui.anchor = +cur.dataset.id; ui.picked.clear(); }
  moveFocus(key); const now = document.activeElement.closest('#app article[data-id]'); if (!now) return;
  ui.selecting = true; ui.picked.clear(); pickRange(ui.anchor, +now.dataset.id); render();
}
export function toggle(id) { ui.picked.has(id) ? ui.picked.delete(id) : ui.picked.add(id); render(); }


/* listeners on document and window, registered once by app.js */
export function installSelect() {
  document.addEventListener('pointerdown', e => {
    if (ui.mode !== 'phone' || !ui.selecting || layers.sheet || e.button > 0) return; const t = e.target.closest('#app article.pt[data-id]'); if (!t) return;
    paintState = { pid: e.pointerId, x: e.clientX, y: e.clientY, first: t, on: !ui.picked.has(+t.dataset.id), active: false, raf: 0 };
  });
  document.addEventListener('pointermove', e => {
    if (!paintState || e.pointerId !== paintState.pid) return; paintState.cx = e.clientX; paintState.cy = e.clientY;
    if (!paintState.active) { if (Math.hypot(e.clientX - paintState.x, e.clientY - paintState.y) < 8) return; paintState.active = true; paintSet(paintState.first); paintLoop(); }
    const t = tileAt(e.clientX, e.clientY); if (t) paintSet(t);
  });
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, e => { if (!paintState || e.pointerId !== paintState.pid) return;
    const was = paintState.active; cancelAnimationFrame(paintState.raf); paintState = null; if (was) { ui.suppressClick = performance.now() + 350; render(); } }));
  document.addEventListener('pointerdown', e => {
    if (ui.mode !== 'desk' || e.button !== 0 || e.pointerType === 'touch' || layers.sheet || layers.palette || !emptySpace(e.target)) return;
    marquee = { pid: e.pointerId, x: e.clientX, y: e.clientY, base: e.shiftKey ? new Set(ui.picked) : new Set(), el: null };
  });
  document.addEventListener('pointermove', e => {
    if (!marquee || e.pointerId !== marquee.pid) return;
    if (!marquee.el) { if (Math.hypot(e.clientX - marquee.x, e.clientY - marquee.y) < 5) return; marquee.el = document.createElement('div'); marquee.el.className = 'marquee'; document.body.appendChild(marquee.el); document.body.classList.add('marqueeing'); }
    const l = Math.min(marquee.x, e.clientX), t = Math.min(marquee.y, e.clientY), r = Math.max(marquee.x, e.clientX), b = Math.max(marquee.y, e.clientY);
    Object.assign(marquee.el.style, { left: l + 'px', top: t + 'px', width: r - l + 'px', height: b - t + 'px' });
    const picked = new Set(marquee.base);
    document.querySelectorAll('#app article.tile[data-id]').forEach(a => { const R = a.getBoundingClientRect();
      const hit = R.left < r && R.right > l && R.top < b && R.bottom > t; if (hit) picked.add(+a.dataset.id);
      a.classList.toggle('picked', picked.has(+a.dataset.id)); });
    ui.picked = picked; const on = picked.size > 0 || marquee.base.size > 0;
    if (on !== ui.selecting) { ui.selecting = on; byId('screen').classList.toggle('selecting', on); }
    byId('tbwrap').innerHTML = deskToolbar();
  });
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, e => { if (!marquee || e.pointerId !== marquee.pid) return;
    const drew = !!marquee.el; if (marquee.el) marquee.el.remove(); document.body.classList.remove('marqueeing'); marquee = null;
    if (drew) { ui.suppressClick = performance.now() + 350; if (!ui.picked.size) ui.selecting = false; render(); } }));
}
