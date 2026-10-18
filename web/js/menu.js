/* The small popup menu on desktop (the phone shows the same rows in a sheet). */
import { actions, startRename } from './actions.js';
import { render } from './render.js';
import { openSheet } from './sheets.js';
import { bm, layers, ui } from './state.js';
import { esc, ic } from './util.js';

/* ================= menus (desktop) ================= */
export const menuHTML = items => items.map((it, i) => it === '-' ? '<hr>' : `<button type="button" role="${it.check != null ? 'menuitemradio' : 'menuitem'}"${it.check != null ? ` aria-checked="${!!it.check}"` : ''} data-mi="${i}"${it.warn ? ' class="warn"' : ''}>${it.icon ? ic(it.icon) : ''}${esc(it.label)}${it.check ? `<span class="ck">${ic('check', 's16')}</span>` : ''}</button>`).join('');
export function openMenu(anchor, items, at) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = menuHTML(items);
  document.body.appendChild(m);
  const W = m.offsetWidth, H = m.offsetHeight; let x, y;
  if (at) { x = at.x; y = at.y; } else { const r = anchor.getBoundingClientRect(); x = r.right - W; y = r.bottom + 6; if (y + H > innerHeight - 8) y = r.top - H - 6; }
  m.style.left = Math.max(8, Math.min(x, innerWidth - W - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - H - 8)) + 'px';
  layers.menu = { el: m, anchor }; if (anchor) anchor.setAttribute('aria-expanded', 'true');
  m.addEventListener('click', e => { const b = e.target.closest('[data-mi]'); if (!b) return; const it = items[+b.dataset.mi]; closeMenu(e.detail === 0); it.run(); }); /* from the keyboard, focus goes back to the button that opened the menu */
  m.addEventListener('keydown', e => { const bs = [...m.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); bs[e.key === 'Home' ? 0 : bs.length - 1].focus(); }
    else if (e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) { /* type-ahead: the next item starting with that letter */
      const k = e.key.toLowerCase(), order = [...bs.slice(i + 1), ...bs.slice(0, i + 1)], hit = order.find(b => b.textContent.trim().toLowerCase().startsWith(k));
      if (hit) { e.preventDefault(); hit.focus(); } }
    else if (e.key === 'Tab') { e.preventDefault(); closeMenu(true); } });
  m.querySelector('button').focus();
}
export function closeMenu(refocus) { if (!layers.menu) return; const { el, anchor } = layers.menu; layers.menu = null; el.remove();
  if (anchor && anchor.isConnected) { anchor.removeAttribute('aria-expanded'); if (refocus) anchor.focus(); } }
export function menuOrSheet(anchor, items, head) { if (ui.mode === 'phone' || !anchor) openSheet({ type: 'rows', head, rows: items }); else if (layers.menu && layers.menu.anchor === anchor) closeMenu(); else openMenu(anchor, items); }
/* what acts on one card, in one order everywhere: the right click menu, the three dots on a card, the sheet for a
   card that cannot be selected; the first group is also what the selection bar's three dots hold for one card */
export const oneCardItems = b => [
  { icon: 'open', label: 'Open', run: () => actions.open(b) },
  { icon: 'edit', label: 'Rename', run: () => startRename(b.id) },
  { icon: 'pin', label: b.pinned ? 'Unpin' : 'Pin', run: () => actions.pin(b) }];
export const tileMenu = b => b.deleted_at
  ? [{ icon: 'restore', label: 'Restore', run: () => actions.restore([b.id]) }, '-', { icon: 'trash', label: 'Delete now', warn: true, run: () => actions.purge([b.id]) }]
  : [...oneCardItems(b), '-',
    { icon: 'move', label: 'Move', run: () => openSheet({ type: 'move', ids: [b.id] }) },
    { icon: 'link', label: 'Copy', run: () => actions.copy(b) },
    { icon: 'share', label: 'Share', run: () => actions.share(b) },
    '-', { icon: 'trash', label: 'Trash', warn: true, run: () => actions.trash([b.id]) }];
/* the selection bar's three dots: what the bar has no button for. Open and Rename only with one card selected */
export function selItems() {
  const L = [...ui.picked].map(bm).filter(b => b && !b.deleted_at); if (!L.length) return [];
  const done = run => () => { ui.selecting = false; ui.picked.clear(); ui.anchor = null; render(); run(); };
  if (L.length === 1) return oneCardItems(L[0]).map(it => ({ ...it, run: done(it.run) }));
  const on = L.some(b => !b.pinned);
  return [{ icon: 'pin', label: on ? 'Pin' : 'Unpin', run: done(() => actions.pinMany(L.map(b => b.id), on)) }];
}


/* listeners on document and window, registered once by app.js */
export function installMenu() {
  document.addEventListener('pointerdown', e => { if (layers.menu && !layers.menu.el.contains(e.target) && !(layers.menu.anchor && layers.menu.anchor.contains(e.target))) closeMenu(); });
  addEventListener('resize', () => closeMenu());
}
