/* Toasts at the bottom, one of them with Undo (Cmd Z runs it). */
import { layers } from './state.js';
import { byId, esc, plural, reduce } from './util.js';

/* the one live region (#announce): screen readers hear a result count or an outcome, never the redrawn list.
   Emptied first, so the same words twice are read twice. */
let announceTimer = null;
export function announce(msg, delay = 60) {
  const el = byId('announce'); if (!el) return;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); }, delay);
}
export const resultsText = n => n ? plural(n, 'result', 'results') : 'No matches';

/* ================= toasts and undo ================= */
export function toast(msg, o = {}) {
  const box = byId('toasts'); if (!box) return;
  announce(msg);
  const t = document.createElement('div'); t.className = 'toast in' + (o.undo ? '' : ' solo');
  t.innerHTML = `<span class="tx">${esc(msg)}</span>` + (o.undo ? `<button type="button">Undo</button>` : '');
  box.appendChild(t); while (box.children.length > 3) box.firstElementChild.remove();
  const kill = () => { if (!t.isConnected) return; t.classList.add('out'); setTimeout(() => t.remove(), reduce() ? 0 : 200); if (layers.undo && layers.undo.el === t) layers.undo = null; };
  if (o.undo) { layers.undo = { run: o.undo, el: t }; t.querySelector('button').addEventListener('click', () => runUndo()); }
  setTimeout(kill, o.undo ? 6000 : 2400);
  t.kill = kill; return t;
}
export function runUndo() { if (!layers.undo) return; const u = layers.undo; layers.undo = null; u.el.kill(); u.run(); }
