/* The keyboard map: / and Cmd K, arrows across tiles, Enter, Delete, F2, Escape, Cmd Z, Cmd A. */
import { actions, nfCreate, startRename } from './actions.js';
import { closeMenu } from './menu.js';
import { openPalette, palKey } from './palette.js';
import { exitSelect, extendByKey, selSync } from './select.js';
import { atKey, closeSheet, sheetEl } from './sheets.js';
import { bm, canSelect, foldersSel, layers, selectables, ui } from './state.js';
import { runUndo } from './toast.js';

/* keyboard */
export function moveFocus(key) {
  const sel = ui.mode === 'phone' ? '#app .pt-in, #app .g-in' : '#app .t-title, #app .g-in';
  const all = [...document.querySelectorAll(sel)]; if (!all.length) return;
  const cur = document.activeElement && document.activeElement.closest('#app article') ? document.activeElement.closest('article').querySelector('.t-title, .pt-in, .g-in') : null;
  let i = all.indexOf(cur), j;
  if (i < 0) j = 0;
  else if (key === 'ArrowLeft') j = Math.max(0, i - 1);
  else if (key === 'ArrowRight') j = Math.min(all.length - 1, i + 1);
  else { const R = el => el.closest('article').getBoundingClientRect(), r = R(cur), cx = r.left + r.width / 2, down = key === 'ArrowDown';
    let best = -1, bd = Infinity;
    all.forEach((el, n) => { const q = R(el); const dy = down ? q.top - r.top : r.top - q.top; if (dy < 4) return;
      const score = dy * 4 + Math.abs(q.left + q.width / 2 - cx); if (score < bd) { bd = score; best = n; } });
    j = best < 0 ? i : best; }
  all[j].focus(); all[j].closest('article').scrollIntoView({ block: 'nearest' });
}
export function onKey(e) {
  const t = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable, mod = e.metaKey || e.ctrlKey;
  if (layers.palette) { palKey(e, mod); return; }
  if (e.key === 'Escape') {
    if (layers.menu) { closeMenu(true); return; }
    if (layers.sheet) { e.preventDefault(); closeSheet(); return; }
    if (ui.renaming) return;
    if (ui.selecting) { exitSelect(); return; }
    if (t.id === 'q') t.blur();
    return;
  }
  if (layers.sheet && e.key === 'Enter' && t.closest && t.closest('[data-nf]')) { e.preventDefault(); nfCreate(); return; }
  if (layers.sheet && layers.sheet.type === 'addto' && atKey(e, t)) return;
  if (document.body.dataset.page !== 'app') return;
  /* Tab stays inside an open sheet or dialog, and comes back into it if a redraw dropped focus outside */
  if (layers.sheet && e.key === 'Tab') { const el = sheetEl(), f = [...el.querySelectorAll('button:not([disabled]), input:not([type=hidden]), textarea, [href], [tabindex="0"]')].filter(x => x.getClientRects().length); if (!f.length) return;
    /* moved by hand, so WebKit (which only tabs to text fields by default) cycles through the buttons too */
    const i = f.indexOf(document.activeElement); e.preventDefault();
    f[i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); return; }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!layers.sheet) openPalette(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) { if (layers.undo) { e.preventDefault(); runUndo(); } return; }
  if (layers.sheet || layers.menu) return;
  if (t.id === 'q' && e.key === 'ArrowDown' && ui.mode === 'desk') { e.preventDefault(); moveFocus('ArrowDown'); return; }
  if (t.id === 'q' && e.key === 'Enter' && ui.mode === 'desk') { const first = document.querySelector('#body .t-title'); if (first) { e.preventDefault(); first.click(); } return; } /* the link itself opens, so it counts as opened */
  /* a keyboard means a keyboard at any width: Cmd A and Shift arrows select in the phone layout too */
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'a' && !typing && canSelect() && selectables().length) { e.preventDefault(); ui.selecting = true; selectables().forEach(id => ui.picked.add(id)); selSync(); return; }
  if (e.shiftKey && !mod && e.key.startsWith('Arrow') && !typing && !foldersSel()) { e.preventDefault(); extendByKey(e.key); return; }
  if (typing || mod || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); openPalette(); return; } /* the same search at any width */
  /* S starts selecting, and ends it again, like the Select button */
  if (e.key.toLowerCase() === 's' && !layers.sheet && canSelect() && (ui.selecting || selectables().length)) { e.preventDefault(); if (ui.selecting) exitSelect(); else { ui.selecting = true; ui.picked.clear(); selSync(); } return; }
  if (e.key.startsWith('Arrow')) { e.preventDefault(); moveFocus(e.key); return; }
  const art = t.closest && t.closest('#app article[data-id]');
  if (art && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); const b = bm(+art.dataset.id); if (!b) return;
    const next = art.nextElementSibling || art.previousElementSibling;
    (b.deleted_at ? actions.purge([b.id]) : actions.trash([b.id])).then(() => { const n = next && document.querySelector(`#app article[data-id="${next.dataset.id}"] :is(.t-title, .pt-in, .g-in)`); if (n) n.focus(); }); return; }
  if (art && e.key === 'F2') { e.preventDefault(); const b = bm(+art.dataset.id); if (b && !b.deleted_at) startRename(b.id); }
}
