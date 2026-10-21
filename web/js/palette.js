/* The search palette: Cmd K on desktop, the search pill on the phone. Recent opens, then matches grouped by
   folder. */
import { actions, goView, newFolder } from './actions.js';
import { closeMenu } from './menu.js';
import { favHTML, hl, hostLine, syncSearch } from './render.js';
import { count, data, fid, hostOf, iconSrc, lastOpened, layers, live, pathOf, ui, viewName } from './state.js';
import { announce, resultsText } from './toast.js';
import { byId, esc, ic, isPhone, reduce } from './util.js';

/* ================= palette (Cmd K on desktop, the search field on the phone) ================= */
/* a search over the blurred app: a row of recent opens, then matches grouped by where they live */
export const PAL_CAP = 40;
export const palRecent = () => lastOpened(10);
/* the actions the palette offers, each the same flow as its button */
export const PAL_ACTS = [{ id: 'new-folder', label: 'New folder', icon: 'folder-plus', key: 'N', run: () => newFolder(null) }];
export function palGroups(q) {
  const k = q.toLowerCase(), L = live().filter(b => (b.title + ' ' + b.url + ' ' + hostOf(b)).toLowerCase().includes(k));
  const G = new Map(); for (const b of L) { const f = fid(b); if (!G.has(f)) G.set(f, []); G.get(f).push(b); }
  const groups = [...G.entries()].map(([f, items]) => ({ label: pathOf(f), items: items.sort((a, b) => (b.opened_at || b.created_at) - (a.opened_at || a.created_at)) }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  return { groups, total: L.length };
}
/* the query is ui.q, the one search state: the field shows it while the palette runs it. o.q opens with a query (the
   /search link); o.swap reopens it, already open, after the layout changed under it */
export function openPalette(o = {}) {
  if (layers.palette) { byId('pq').focus(); return; }
  closeMenu(); ui.q = o.q || ''; layers.palette = { idx: o.idx || 0, items: [], back: o.swap ? null : document.activeElement, at: performance.now() };
  const el = document.createElement('div'); el.className = o.swap ? 'pal open' : 'pal'; el.id = 'pal';
  el.innerHTML = `<div class="pal-scrim" data-pal="close"></div><div class="pal-panel" role="dialog" aria-modal="true" aria-label="Search bookmarks">
    <div class="pal-row"><label class="pal-f">${ic('search')}<span class="vh">Search bookmarks</span>
      <input id="pq" type="search" autocomplete="off" spellcheck="false" placeholder="Search bookmarks" enterkeyhint="go" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list">
      <span class="kcap" aria-hidden="true">esc</span></label><button type="button" class="pal-cancel" data-pal="close">Cancel</button></div>
    <div class="pal-scroll"><div id="pal-rec"></div><div class="pal-list" id="pal-list" role="listbox" aria-label="Bookmarks"></div></div></div>`;
  document.body.appendChild(el); byId('pq').value = ui.q; palRecentFill(); palFill(); palViewport(true); document.body.classList.add('pal-on'); syncSearch();
  const panel = el.querySelector('.pal-panel');
  /* phone: the panel moves as a solid surface and turns to glass once it has landed */
  if (isPhone() && !reduce() && !o.swap) { panel.style.willChange = 'transform, opacity';
    panel.addEventListener('transitionend', function done(e) { if (e.target !== panel || e.propertyName !== 'transform') return; panel.removeEventListener('transitionend', done);
      panel.style.willChange = ''; if (layers.palette) panel.classList.add('glass'); }); }
  else panel.classList.add('glass');
  byId('pq').focus(); /* focused before the entrance, so the first keystroke lands */
  /* phone: the back gesture closes the palette instead of leaving the app */
  if (o.hist) layers.palette.hist = true; else if (isPhone()) { try { history.pushState({ pal: 1 }, ''); layers.palette.hist = true; } catch (e) { /* no history entry */ } }
  if (o.swap) return; void el.offsetHeight; el.classList.add('open');
}
/* the Recent row is built once per open */
export function palRecentFill() {
  const q = ui.q.trim(), R = palRecent();
  byId('pal-rec').innerHTML = R.length ? `<div class="pal-lbl">Recent</div><nav class="precent pal-recent" aria-label="Recent">` + R.map(b => { const src = iconSrc(b), l = esc(b.letter || b.title.charAt(0));
    return `<a class="prc pal-rc" href="${esc(b.url)}" target="_blank" rel="noopener" data-open="${b.id}" draggable="false" aria-label="${esc(b.title)}">
      <span class="prc-ic" data-l="${l}"${src ? ` style="--tile:${esc(b.tile || 'var(--tile-blank)')}"` : ''}>${src ? `<img src="${esc(src)}" alt="" width="44" height="44" draggable="false">` : l}</span>
      <span class="prc-l">${esc(b.title)}</span></a>`; }).join('') + `</nav>` : (q ? '' : `<p class="pal-none">Nothing opened yet.</p>`);
}
/* results only: the panel and the Recent row stay as they are */
export function palFill() {
  const q = ui.q.trim();
  layers.palette.items = []; layers.palette.had = data.has; let h = '', found = 0;
  if (q && data.has) {
    const { groups, total } = palGroups(q); let n = 0; found = total;
    const k = q.toLowerCase(), V = ['dashboard', 'folders', 'all', 'inbox', 'trash'].filter(v => viewName(v).toLowerCase().includes(k));
    if (V.length) h += `<div class="pal-grp"><div class="pal-lbl pal-g"><span>Views</span></div>` + V.map(v => { const i = n++; layers.palette.items.push({ view: v });
      return `<button type="button" class="pal-it pal-view" role="option" id="pal-${i}" aria-selected="${i === layers.palette.idx}" tabindex="-1" data-pi="${i}" data-view="${v}">
        <span class="fav pal-vi">${ic(v === 'folders' ? 'folder' : v)}</span><span class="pal-t">${hl(viewName(v), q)}</span><span class="pal-p num">${count(v)}</span></button>`; }).join('') + `</div>`;
    /* actions the query names run like their buttons */
    const A = PAL_ACTS.filter(a => a.label.toLowerCase().includes(k));
    if (A.length) h += `<div class="pal-grp"><div class="pal-lbl pal-g"><span>Actions</span></div>` + A.map(a => { const i = n++; layers.palette.items.push({ act: a });
      return `<button type="button" class="pal-it pal-view pal-act" role="option" id="pal-${i}" aria-selected="${i === layers.palette.idx}" tabindex="-1" data-pi="${i}" data-act="${a.id}">
        <span class="fav pal-vi">${ic(a.icon)}</span><span class="pal-t">${hl(a.label, q)}</span><span class="pal-p">${a.key}</span></button>`; }).join('') + `</div>`;
    for (const g of groups) { if (n >= PAL_CAP) break; const take = g.items.slice(0, PAL_CAP - n);
      h += `<div class="pal-grp"><div class="pal-lbl pal-g"><span>${esc(g.label)}</span><span class="num">${g.items.length}</span></div>` + take.map(b => { const i = n++; layers.palette.items.push(b);
        return `<a class="pal-it" role="option" id="pal-${i}" aria-selected="${i === layers.palette.idx}" href="${esc(b.url)}" target="_blank" rel="noopener" tabindex="-1" data-pi="${i}" data-open="${b.id}">
          ${favHTML(b, 28)}<span class="pal-t">${hl(b.title, q)}</span>${hostLine(hostOf(b), 'pal-h', true, q)}<span class="pal-p">${esc(pathOf(fid(b)))}</span></a>`; }).join('') + `</div>`; }
    if (!total && !layers.palette.items.length) h = `<p class="pal-none">No matches.</p>`;
    else if (total > PAL_CAP) h += `<p class="pal-none pal-more">${total - PAL_CAP} more, keep typing</p>`;
  }
  layers.palette.idx = Math.max(0, Math.min(layers.palette.idx, layers.palette.items.length - 1));
  byId('pal-list').innerHTML = h; byId('pal-rec').hidden = !!q; /* a typed query shows only what it finds */
  if (q && data.has) announce(resultsText(found), 500);
  byId('pq').setAttribute('aria-activedescendant', layers.palette.items.length ? 'pal-' + layers.palette.idx : '');
}
export function palSet(i) { if (!layers.palette || !layers.palette.items.length) return; layers.palette.idx = (i + layers.palette.items.length) % layers.palette.items.length;
  document.querySelectorAll('#pal .pal-it').forEach((r, n) => r.setAttribute('aria-selected', n === layers.palette.idx));
  const r = byId('pal-' + layers.palette.idx); if (r) r.scrollIntoView({ block: 'nearest' }); byId('pq').setAttribute('aria-activedescendant', 'pal-' + layers.palette.idx); }
export function palGo(keep) { const b = layers.palette && layers.palette.items[layers.palette.idx]; if (!b) return; if (b.view) { closePalette(); goView(b.view); return; } if (b.act) { closePalette(); b.act.run(); return; } actions.open(b); if (!keep) closePalette(); }
/* closing ends the search; swap takes the palette down at once, the query kept, for openPalette to put it back */
export function closePalette(fromPop, swap) { if (!layers.palette) return; const el = byId('pal'), back = layers.palette.back, hist = layers.palette.hist; layers.palette = null;
  if (swap) { document.body.classList.remove('pal-on'); clearTimeout(palT); el.remove(); return; }
  ui.q = ''; syncSearch();
  if (hist && !fromPop && history.state && history.state.pal) history.back(); document.body.classList.remove('pal-on'); clearTimeout(palT);
  const panel = el.querySelector('.pal-panel'); if (isPhone()) { panel.classList.remove('glass'); panel.style.willChange = 'transform, opacity'; }
  el.classList.remove('open'); setTimeout(() => el.remove(), reduce() ? 90 : 130);
  if (back && back.isConnected && back !== document.body && back.id !== 'q') back.focus({ preventScroll: true }); else if (document.activeElement) document.activeElement.blur(); }
/* on the phone the panel fits above the keyboard */
/* on the phone the panel sits at the top and stops above the keyboard */
/* the panel height is fixed from the visual viewport once the keyboard settles: debounced, applied in one frame */
let vvT = null;
export function palViewport(now) {
  const apply = () => requestAnimationFrame(() => { const p = document.querySelector('#pal .pal-panel'); if (!p) return;
    const vv = window.visualViewport, h = vv ? vv.height : innerHeight, kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    p.style.setProperty('--vvh', h + 'px'); p.style.setProperty('--vvt', (vv ? vv.offsetTop : 0) + 'px'); p.style.setProperty('--kb', kb + 'px'); });
  clearTimeout(vvT); if (now === true) apply(); else vvT = setTimeout(apply, 80);
}
export function palKey(e, mod) {
  if (e.key === 'Escape') { e.preventDefault(); clearTimeout(palT); if (ui.q) { ui.q = ''; byId('pq').value = ''; layers.palette.idx = 0; palFill(); syncSearch(); } else closePalette(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); palSet(layers.palette.idx + 1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); palSet(layers.palette.idx - 1); return; }
  if (e.key === 'Enter') { e.preventDefault(); if (palT) { clearTimeout(palT); palT = null; palFill(); } palGo(mod); return; }
  if (e.key === 'Tab') { e.preventDefault(); byId('pq').focus(); return; }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); byId('pq').focus(); byId('pq').select(); }
}
let palT = null; /* typing renders after a 60 ms pause */
/* the scrim closes on pointer up (WebKit taps on a plain div give no click); a downward swipe on the panel head closes it too */
let palSwipe = null;


/* listeners on document and window, registered once by app.js */
export function installPalette() {
  if (window.visualViewport) { visualViewport.addEventListener('resize', () => { if (layers.palette) palViewport(); }); visualViewport.addEventListener('scroll', () => { if (layers.palette) palViewport(); }); }
  document.addEventListener('input', e => { if (layers.palette && e.target.id === 'pq') { ui.q = e.target.value; syncSearch(); layers.palette.idx = 0; clearTimeout(palT); palT = setTimeout(() => { if (layers.palette) palFill(); }, 60); } });
  document.addEventListener('pointermove', e => { if (!layers.palette || e.pointerType === 'touch') return; const r = e.target.closest && e.target.closest('#pal .pal-it'); if (r && +r.dataset.pi !== layers.palette.idx) palSet(+r.dataset.pi); });
  document.addEventListener('click', e => { if (!layers.palette) return; const t = e.target;
    if (t.closest('[data-pal="close"]')) { closePalette(); return; }
    const ac = t.closest('#pal [data-act]'); if (ac) { layers.palette.idx = +ac.dataset.pi; palGo(); return; }
    const r = t.closest('#pal .pal-it, #pal .pal-rc'); if (r && !(e.metaKey || e.ctrlKey)) setTimeout(closePalette, 0); }, true); /* the link opens itself; onClick marks it opened */
  /* Cancel on the phone acts on the press: the field keeps focus, so the keyboard does not drop and move the button away first */
  document.addEventListener('pointerdown', e => { if (layers.palette && e.target.closest && e.target.closest('.pal-cancel')) { e.preventDefault(); ui.suppressClick = performance.now() + 350; closePalette(); } }, true);
  document.addEventListener('pointerup', e => { if (layers.palette && e.target.classList && e.target.classList.contains('pal-scrim') && performance.now() - layers.palette.at > 400) { ui.suppressClick = performance.now() + 350; closePalette(); } });
  /* desktop: focus in the search field opens the palette, like Spotlight; the field itself never filters inline */
  document.addEventListener('focusin', e => { if (e.target.id === 'q' && ui.mode === 'desk' && !layers.palette && !layers.sheet) openPalette(); });
  document.addEventListener('pointerdown', e => { if (!layers.palette || !isPhone()) return; const h = e.target.closest('#pal .pal-panel'); if (!h || e.target.closest('a, .pal-scroll')) return;
    palSwipe = { y: e.clientY, pid: e.pointerId, dy: 0 }; });
  document.addEventListener('pointermove', e => { if (!palSwipe || e.pointerId !== palSwipe.pid) return; palSwipe.dy = e.clientY - palSwipe.y; const p = document.querySelector('#pal .pal-panel'); if (p && palSwipe.dy > 0) p.style.transform = `translateY(${palSwipe.dy}px)`; });
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, e => { if (!palSwipe || e.pointerId !== palSwipe.pid) return; const far = palSwipe.dy > 80; palSwipe = null;
    const p = document.querySelector('#pal .pal-panel'); if (p) p.style.transform = ''; if (far) closePalette(); }));
  addEventListener('popstate', () => { if (layers.palette) closePalette(true); });
}
