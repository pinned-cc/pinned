/* Pinned front end, the entry: wires the modules for the app (desktop and phone), the save page,
   the login page and the bookmarklet page. Pages pick their part with <body data-page="...">.
   No framework, no build step: the browser loads these ES modules as they are. */
import { onClick, onInput, onSubmit, doImport } from './actions.js';
import { api } from './api.js';
import { installDrag } from './drag.js';
import { onKey } from './keys.js';
import { freshHTML, galleryHTML, sortedHTML } from './home.js';
import { installMenu, menuHTML, selItems, tileMenu } from './menu.js';
import { installPalette, openPalette } from './palette.js';
import { installPhone } from './phone.js';
import { addTileHTML, backLink, deskBulk, deskDock, deskTile, deskToolbar, deskTree, emptyMerge, favHTML, fmini, ftileHTML, INBOX_F, installRender, nfMini, nfPlus, foldersScreen, noticeHTML, phoneBulk, phoneRecents, phoneTile, phoneTop, phoneTabs, phoneVbar, pskel, render, searchField, settingsScreen, shareBtn, sideItem, skel } from './render.js';
import { installSelect } from './select.js';
import { bmHead, checkUrl, doneHTML, fHead, grab, installSheets, layer, lockHTML, newSave, openSheet, openTokens, rowsHTML, saveActs, saveHTML, shareHTML, textHead, tokensHTML } from './sheets.js';
import { data, layers, load, setData, ui } from './state.js';
import { toast } from './toast.js';
import { byId, copy, ic, installIconFallback, PHONE_MQ, SPRITE } from './util.js';

/* document and window listeners, in the order they always ran: pointer handlers on the same event
   depend on it (a drag start resets the click suppression the others set) */
installIconFallback();
installRender();
installPhone();
installPalette();
installMenu();
installSheets();
installDrag();
installSelect();

function boot() {
  document.body.insertAdjacentHTML('afterbegin', SPRITE);
  const page = document.body.dataset.page;
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  if (page === 'app') bootApp(); else if (page === 'save') bootSave(); else if (page === 'login') bootLogin(); else if (page === 'bookmarklet') bootBookmarklet();
}
function bootApp() {
  /* /search?q= arrives as #q=: the search opens with the query at any width; results fill in once the bookmarks load */
  const m = /^#q=(.*)$/.exec(location.hash); let q = null; if (m) { try { q = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { q = m[1]; } history.replaceState(null, '', location.pathname); }
  /* /#tokens (the token link on the How to save page) opens the API tokens sheet once */
  const tokens = location.hash === '#tokens'; if (tokens) history.replaceState(null, '', location.pathname);
  render(); if (q && q.trim()) openPalette({ q }); else if (tokens) openTokens(); load();
  /* the version, under Source in the app menu */
  fetch('/health', { credentials: 'same-origin' }).then(r => r.json()).then(h => { if (h && h.version) { ui.version = h.version; render(); } }).catch(() => {});
  let last = 0; const refresh = () => { if (Date.now() - last < 1500 || document.hidden) return; last = Date.now(); load(); };
  addEventListener('focus', refresh); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  PHONE_MQ.addEventListener ? PHONE_MQ.addEventListener('change', () => render()) : PHONE_MQ.addListener(() => render());
  byId('import-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; doImport(f); });
}
async function bootSave() {
  const p = new URLSearchParams(location.search); let url = (p.get('url') || '').trim(), title = (p.get('title') || '').trim(); const text = (p.get('text') || '').trim();
  const found = text.match(/https?:\/\/\S+/i);
  if (!url && found) { url = found[0].replace(/[).,;]+$/, ''); if (!title) title = text.replace(found[0], '').trim(); }
  else if (!title && text && !found) title = text;
  try { setData(await api('GET', '/api/state')); data.has = true; } catch (e) { if (e.auth) return; }
  layers.save = newSave({ title, url });
  layer().classList.add('page-sheet');
  openSheet({ type: 'save' }, false);
  if (url) checkUrl(true);
  fitSaveWindow();
}
/* the popup fits the panel: a window the page opened grows or shrinks to the panel's full height, now and whenever the
   panel changes (the folder list opening, the Already saved line, Saved) */
function fitSaveWindow() {
  let last = 0;
  const need = () => { const s = byId('sheet'), b = s && s.querySelector('.sh-body'); return s && b ? Math.ceil(s.offsetHeight - b.clientHeight + b.scrollHeight) : 0; };
  const fit = () => { if (innerWidth > 720 || !window.opener) return; const h = need(); if (!h || Math.abs(h - last) < 2) return; last = h;
    try { window.resizeBy(0, h - innerHeight); } catch (e) { /* not ours to resize */ } };
  new MutationObserver(() => requestAnimationFrame(fit)).observe(byId('layer'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  requestAnimationFrame(fit); addEventListener('load', () => requestAnimationFrame(fit));
}
function bootLogin() {
  const f = byId('login'), err = byId('login-err'), p = new URLSearchParams(location.search);
  let next = p.get('next') || '/'; if (!next.startsWith('/') || next.startsWith('//')) next = '/';
  f.elements.next.value = next;
  if (p.get('error')) err.textContent = p.get('error') === 'wait' ? 'Wait 30 seconds and try again.' : 'Wrong password.';
  /* the form posts to /login; the server redirects back with error=1 or error=wait */
  f.addEventListener('submit', () => { f.querySelector('button').disabled = true; });
}
function bootBookmarklet() {
  /* the server's view of the scheme can be wrong behind a proxy that ends https (tailscale serve): on the same host, trust the page */
  let base = (document.body.dataset.base || '').replace(/\/+$/, ''); if (base.includes('{{')) base = '';
  try { if (base && new URL(base).host === location.host) base = location.origin; } catch (e) { base = ''; }
  const origin = base || location.origin;
  const code = `javascript:(function(){var u=${JSON.stringify(origin + '/save?url=')}+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);var w=window.open(u,'bookmarks-save','width=392,height=544,menubar=no,toolbar=no,location=no');if(!w)location.href=u;})();`;
  document.querySelectorAll('[data-bm]').forEach(a => { a.href = code; a.addEventListener('click', e => { e.preventDefault(); toast('Drag this button to the bookmarks bar.'); }); });
  document.querySelectorAll('[data-bm-code]').forEach(c => { c.textContent = code; });
  document.querySelectorAll('[data-bm-copy]').forEach(b => b.addEventListener('click', async () => {
    if (!(await copy(code))) return;
    if (b.classList.contains('hs-copy')) { b.classList.add('done'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('done'), 1800); } else toast('Copied');
  }));
  /* a snippet's Copy takes the text of the block it names */
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const el = byId(b.dataset.copy); if (!el || !(await copy(el.textContent))) return;
    b.classList.add('done'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('done'), 1800);
  }));
  /* the device tabs: the one you are on opens first */
  const tabs = [...document.querySelectorAll('.hs-tabs [role=tab]')];
  const pick = t => tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; byId(x.getAttribute('aria-controls')).hidden = !on; });
  if (tabs.length) {
    const ua = navigator.userAgent, ios = /iPhone|iPod/.test(ua), android = /Android/.test(ua);
    pick(byId(ios ? 't-iphone' : android ? 't-android' : 't-mac'));
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => pick(t));
      t.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); const n = tabs[(i + d + tabs.length) % tabs.length]; pick(n); n.focus(); });
    });
  }
}

/* the style guide (tools/styleguide.html) renders its specimens with these builders, so they match the app */
window.Pinned = { render, load, U: ui, D: data, L: layers };
window.Pinned.kit = { setData, ic, searchField, backLink, shareBtn, lockHTML, deskTile, phoneTile, ftileHTML, fmini, INBOX_F, nfMini, addTileHTML, emptyMerge, deskBulk, deskToolbar, phoneTop, phoneTabs, phoneVbar, nfPlus, phoneBulk, foldersScreen, sideItem, deskTree, deskDock, phoneRecents, rowsHTML, fHead, bmHead, grab, favHTML, galleryHTML, sortedHTML, freshHTML, menuHTML, tileMenu, selItems,
  noticeHTML, skel, pskel, settingsScreen, textHead, shareHTML, tokensHTML, newSave, saveHTML, saveActs, doneHTML };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
