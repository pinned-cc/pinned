/* Markup for the desktop and the phone: sidebar, toolbar, pinned dock, folder tiles, the grid and list, the
   phone Recent row and bottom bar. render() picks the layout and redraws. */
import { galleryHTML, inboxIdle, sortedHTML } from './home.js';
import { closeMenu } from './menu.js';
import { closePalette, openPalette, palFill, palRecentFill } from './palette.js';
import { PHONE_TABS, vvSync } from './phone.js';
import { FSORTS, SORTS, SOURCE_URL, chain, count, data, descSet, dfs, fid, folderById, foldersSel, galLinks, galleryOn, hostOf, hue, hueClass, iconSrc, isLocked, kids, listFor, live, pathOf, pickable, pinned, sections, selectables, sortable, sortedTop, layers, ui, viewName } from './state.js';
import { byId, setBar, COARSE, esc, fmtDate, highlight, ic, isMac, isPhone, isoDate, reduce, store, truncStart } from './util.js';

/* search hits: the query given marks the text, none leaves it plain */
export const hl = (s, query) => highlight(s, query);
/* a host and port on one line, cut at the start; mark highlights the search */
export const hostLine = (host, cls = '', mark, query) => truncStart(mark ? hl(host, query) : esc(host), cls);

/* shared pieces */
export const favHTML = (b, size = 40) => {
  if (!b) return `<span class="fav">${ic('all')}</span>`;
  const src = iconSrc(b), l = esc(b.letter || (b.title || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="fav" data-l="${l}"${src ? ` style="--tile:${esc(b.tile || '#2a303b')}"` : ''}>${src ? `<img src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" draggable="false">` : l}</span>`;
};
export const contAttr = c => c === undefined ? '' : ` data-container="${c === null ? 'inbox' : c}"`;
/* the view's own controls sit on the view, never in a sheet: Sort shows the order in use and opens a short menu of
   the others (the Folders grid has its own orders), Select is the check icon */
export const sortCtl = (folders, cls) => { const S = folders ? FSORTS : SORTS, k = folders ? ui.fsort : ui.sort;
  return `<button type="button" class="sortc ${cls}" data-a="${folders ? 'fsort' : 'sort'}" aria-haspopup="menu" aria-label="Sort, ${S[k]}">${cls === 'btn' ? ic('sort') : ''}<span class="sortc-t">${S[k]}</span>${ic('chev', 'sortc-ch')}</button>`; };
/* grid or list, one choice kept on this device for every view; the phone takes the 44 px form (p) */
export const layoutSwitch = cls => `<div class="vsw${cls}" role="group" aria-label="View">
      <button type="button" data-layout="grid" aria-pressed="${ui.layout === 'grid'}" aria-label="Grid">${ic('grid')}</button>
      <button type="button" data-layout="list" aria-pressed="${ui.layout === 'list'}" aria-label="List">${ic('list')}</button></div>`;
/* Sort and Select have something to act on: the view lists at least one bookmark */
const hasItems = () => data.has && listFor().length > 0;
/* Select stays in its place while selecting and turns into the way out: pressed, named Done; the row never moves */
export const selIb = () => `<button type="button" class="ib weak sel" data-a="select" aria-pressed="${ui.selecting}" aria-label="${ui.selecting ? 'Done' : 'Select'}">${ic('select')}</button>`;
const selBtn = () => `<button type="button" class="btn lbl sel" data-a="select" aria-pressed="${ui.selecting}" aria-label="${ui.selecting ? 'Done' : 'Select'}">${ic('select')}<span class="t"><span>Select</span><span>Done</span></span></button>`;

/* ================= desktop ================= */
export const kHint = isMac ? '⌘K' : 'Ctrl K';
export function mountDesk() {
  byId('app').innerHTML = `<div class="screen" id="screen"><aside class="side" id="side" aria-label="Folders"></aside>
    <main class="content" id="content"><div class="col"><div class="head" id="head"></div><div id="dockwrap"></div><div id="tbwrap"></div><div class="body" id="body"></div></div></main></div>`;
  byId('head').innerHTML = searchField(false) + `<div id="dbulk"></div>`;
  syncSearch();
}
/* one search, one field: at the top on the desktop, at the foot on the phone within thumb reach, the same look in both.
   The field opens the palette, where the search runs; while it runs the field shows the query. The / key hint shows
   only where a keyboard is the input. */
export const searchField = phone => phone
  ? `<button type="button" class="search ps-trigger" id="qs" data-a="palette" aria-label="Search bookmarks">${ic('search')}<span class="sf-t" id="qt"></span><span class="kcap" aria-hidden="true">/</span></button>`
  : `<label class="search" for="q">${ic('search')}<span class="vh">Search</span><input id="q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"><span class="kcap" aria-hidden="true">/</span></label>`;
export const searchPh = () => COARSE.matches ? 'Search bookmarks' : innerWidth > 1100 ? `Search bookmarks or press ${kHint}` : `Search, ${kHint}`;
export function syncSearch() {
  const q = byId('q'), t = byId('qt'), ph = searchPh();
  if (q) { q.placeholder = ph; if (q.value !== ui.q) q.value = ui.q; }
  if (t) { t.dataset.ph = ph; t.textContent = ui.q; }
}
export const sideItem = (v, cls, icon) => `<button type="button" class="si ${cls}" data-view="${v}" aria-current="${ui.view === v}">
  <span class="si-ic">${ic(icon)}</span><span class="si-n">${viewName(v)}</span>${v === 'dashboard' ? '' : `<span class="si-c">${data.has ? count(v) : ''}</span>`}</button>`;
export const sideAction = (name, icon, a) => `<button type="button" class="si" data-a="${a}"><span class="si-ic">${ic(icon)}</span><span class="si-n">${name}</span></button>`;
export function deskTree() {
  const sel = ui.view, path = typeof sel === 'number' ? new Set(chain(sel).map(f => f.id)) : new Set();
  /* folders use the same row as All bookmarks, Inbox and Trash: the icon box carries the folder hue */
  const row = (f, sub) => `<button type="button" class="si sf ${hueClass(f.id)}${sub ? ' sub' : ''}${isLocked(f) ? ' locked' : ''}" data-view="${f.id}" data-fid="${f.id}" aria-current="${f.id === sel}" aria-label="${esc(f.name)}, ${count(f.id)}">
    <span class="si-ic">${ic('folder')}</span><span class="si-n">${esc(f.name)}</span>${f.share ? ic('link', 'lk') : ''}${f.locked && !isLocked(f) ? ic('lock', 'lk') : ''}${isLocked(f) ? `<span class="si-c si-lock" aria-label="locked">${ic('lock')}</span>` : `<span class="si-c">${count(f.id)}</span>`}</button>`;
  const level = (pid, sub) => kids(pid).map(f => row(f, sub) + (path.has(f.id) && kids(f.id).length
    ? `<div class="subs" data-parent="${f.id}" role="group" aria-label="${esc(f.name)} folders">${level(f.id, true)}</div>` : '')).join('');
  return `<div class="fstack" data-parent="" role="group" aria-label="Folders">${level(null, false)}</div>`;
}
export function deskDock() {
  const P = pinned(); if (!P.length) return '';
  return `<nav class="dock" aria-label="Pinned" data-dock>` + P.map(b => { const src = iconSrc(b), l = esc(b.letter || b.title.charAt(0));
    return `<a class="dk" href="${esc(b.url)}" target="_blank" rel="noopener" title="${esc(b.title)}" data-id="${b.id}" data-open="${b.id}" draggable="false">
      <span class="dk-ic" data-l="${l}"${src ? ` style="--tile:${esc(b.tile || '#2a303b')}"` : ''}>${src ? `<img src="${esc(src)}" alt="" width="56" height="56" draggable="false">` : l}</span>
      <span class="dk-l">${esc(b.title)}</span></a>`; }).join('') + `</nav>`;
}
/* one level up: a folder's parent; past the top, the Dashboard on the desktop and the Folders tab on the phone, where
   folders, All bookmarks and Trash are found */
export function backLink(cls) {
  const v = ui.view; if (v === 'inbox' || v === 'dashboard' || (ui.mode === 'phone' && PHONE_TABS.includes(v))) return '';
  const f = folderById.get(v), p = f && f.parent_id != null ? folderById.get(f.parent_id) : null, home = ui.mode === 'phone' ? 'folders' : 'dashboard';
  return `<button type="button" class="uplink ${cls}" data-view="${p ? p.id : home}">${ic('back')}<span>${esc(p ? p.name : viewName(home))}</span></button>`;
}
/* the selection bar takes the search's place at the top, as it takes the search pill's place on the phone; the pressed Select in the toolbar and Escape end it */
export function deskBulk() {
  const v = ui.view; if (!ui.selecting) return '';
  /* picked folders: the count and Delete, which asks once; nothing that acts on links */
  if (foldersSel()) { const n = ui.picked.size, dis = n ? '' : 'disabled';
    return `<div class="tb bulk" role="toolbar" aria-label="Selection"><span class="n num">${n} <span>selected</span></span><span class="sp"></span>
      <button type="button" class="btn lbl" data-a="sel-all" data-fit="1" aria-label="Select all">${ic('select')}<span class="t">Select all</span></button>
      <button type="button" class="btn warn lbl" data-a="bulk-ftrash" data-fit="9" aria-label="Delete" ${dis}>${ic('trash')}<span class="t">Delete</span></button></div>`; }
  const n = ui.picked.size, dis = n ? '' : 'disabled', tr = v === 'trash';
  return `<div class="tb bulk" role="toolbar" aria-label="Selection"><span class="n num">${n} <span>selected</span></span><span class="sp"></span>
      <button type="button" class="btn lbl" data-a="sel-all" data-fit="3" aria-label="Select all">${ic('select')}<span class="t">Select all</span></button>
      ${tr ? `<button type="button" class="btn lbl" data-a="bulk-restore" data-fit="3" aria-label="Restore" ${dis}>${ic('restore')}<span class="t">Restore</span></button><button type="button" class="btn warn lbl" data-a="bulk-purge" data-fit="9" aria-label="Delete" ${dis}>${ic('trash')}<span class="t">Delete</span></button>`
           : `<button type="button" class="btn lbl" data-a="bulk-move" data-fit="4" aria-label="Move" ${dis}>${ic('move')}<span class="t">Move</span></button><button type="button" class="btn lbl" data-a="bulk-copy" data-fit="1" aria-label="Copy" ${dis}>${ic('link')}<span class="t">Copy</span></button><button type="button" class="btn lbl" data-a="bulk-share" data-fit="2" aria-label="Share" ${dis}>${ic('share')}<span class="t">Share</span></button><button type="button" class="btn warn lbl" data-a="bulk-trash" data-fit="9" aria-label="Trash" ${dis}>${ic('trash')}<span class="t">Trash</span></button>
             <button type="button" class="btn icon" data-a="sel-more" aria-haspopup="menu" aria-label="More actions" title="More actions" ${dis}>${ic('more')}</button>`}</div>`;
}
/* the bar keeps every word that fits: where the row runs short, the least needed button folds to its icon first
   (data-fit, low first) and Trash or Delete keeps its word longest; measured before the frame paints */
export function fitBulk() { const bar = document.querySelector('#dbulk .bulk'); if (!bar) return;
  const B = [...bar.querySelectorAll('[data-fit]')].sort((a, b) => a.dataset.fit - b.dataset.fit);
  B.forEach(b => { b.classList.remove('ic'); b.removeAttribute('title'); });
  for (const b of B) { if (bar.scrollWidth <= bar.clientWidth) break; b.classList.add('ic'); b.title = b.getAttribute('aria-label'); } }
export function setDeskBar() { setBar(byId('dbulk'), deskBulk()); if (ui.selecting) fitBulk(); }
export function deskToolbar() {
  const v = ui.view, isF = typeof v === 'number', sel = data.has && (ui.selecting || selectables().length);
  /* the Dashboard: its title, Add, the layout and Select; recents keep their own order, so no Sort */
  if (v === 'dashboard') return `<div class="tb dash" role="toolbar" aria-label="Dashboard"><h2>Dashboard</h2><span class="sp"></span>
    <button type="button" class="add" data-a="add">${ic('plus')}Add</button>
    ${data.has && !galLinks().length ? '' : layoutSwitch('')}
    ${sel ? selBtn() : ''}</div>`;
  /* the Folders screen: its order and New folder, the same places as on the phone */
  if (v === 'folders') return backLink('dback') + `<div class="tb" role="toolbar" aria-label="Folders"><h2>Folders</h2><span class="cnt">${data.has ? count(v) : ''}</span><span class="sp"></span>
    ${kids(null).length > 1 ? sortCtl(true, 'btn') : ''}${sel ? selBtn() : ''}<button type="button" class="add" data-a="new-folder">${ic('plus')}New folder</button></div>`;
  const idle = data.has && inboxIdle(), items = hasItems();
  return backLink('dback') + `<div class="tb" role="toolbar" aria-label="${esc(viewName(v))}"><h2>${esc(viewName(v))}</h2><span class="cnt">${data.has ? count(v) : ''}</span>${isF ? shareBtn(v, 'tb-share') : ''}<span class="sp"></span>
    ${v === 'trash' ? '' : `<button type="button" class="add" data-a="add">${ic('plus')}Add</button>`}
    ${idle ? '' : layoutSwitch('')}
    ${items && sortable(v) ? sortCtl(false, 'btn') : ''}
    ${items || (data.has && ui.selecting) ? selBtn() : ''}
    ${v === 'trash' ? `<button type="button" class="btn warn" data-a="empty-trash" ${count('trash') ? '' : 'disabled'}>${ic('trash')}Empty trash</button>` : ''}
    ${isF ? `<button type="button" class="btn icon" data-a="folder-menu" aria-haspopup="menu" aria-label="Folder actions" title="Folder actions">${ic('more')}</button>` : ''}</div>`;
}
export const actionBar = b => b.deleted_at
  ? `<div class="acts" role="group" aria-label="Actions for ${esc(b.title)}">
      <button type="button" class="ab txt" data-a="restore">${ic('restore')}Restore</button>
      <button type="button" class="ab del" data-a="purge" aria-label="Delete ${esc(b.title)} now" title="Delete now">${ic('trash')}</button></div>`
  : `<div class="acts" role="group" aria-label="Actions for ${esc(b.title)}">
      <button type="button" class="ab" data-a="share" aria-label="Share ${esc(b.title)}" title="Share">${ic('share')}</button>
      <button type="button" class="ab" data-a="open" aria-label="Open ${esc(b.title)}" title="Open">${ic('open')}</button>
      <button type="button" class="ab del" data-a="trash" aria-label="Move ${esc(b.title)} to Trash" title="Trash">${ic('trash')}</button>
      <button type="button" class="ab" data-a="more" aria-label="More for ${esc(b.title)}" aria-haspopup="menu" title="More">${ic('more')}</button></div>`;
export function deskTile(b, ts) {
  const picked = ui.picked.has(b.id), editing = ui.renaming === b.id;
  return `<article class="tile${picked ? ' picked' : ''}${editing ? ' editing' : ''}" data-id="${b.id}">
    <div class="t-main">${favHTML(b)}
      ${editing ? `<input class="t-edit" data-rename="${b.id}" value="${esc(b.title)}" aria-label="Title" spellcheck="false" autocomplete="off" enterkeyhint="done">`
                : b.deleted_at ? `<button type="button" class="t-title" data-a="tile-menu" aria-haspopup="menu">${hl(b.title)}</button>`
                : `<a class="t-title" href="${esc(b.url)}" target="_blank" rel="noopener" draggable="false" data-open="${b.id}">${hl(b.title)}</a>`}
      <p class="t-host">${hostLine(hostOf(b), '', true)}</p></div>
    <div class="t-strip hue-${hue(fid(b))}"><span class="dot"></span><span class="path">${esc(pathOf(fid(b)))}</span>${ts ? `<time datetime="${isoDate(ts)}">${fmtDate(ts)}</time>` : ''}</div>
    ${actionBar(b)}
    <button type="button" class="chk" data-a="pick" role="checkbox" aria-checked="${picked}" aria-label="Select ${esc(b.title)}"${ui.selecting ? '' : ' tabindex="-1"'}>${ic('check')}</button></article>`;
}
export const skel = () => `<div class="tile sk" aria-hidden="true"><div class="t-main"><div class="b"></div><div class="b l1"></div><div class="b l2"></div></div><div class="t-strip"><span class="b"></span></div></div>`;
export const noticeHTML = phone => `<div class="${phone ? 'pnotice' : 'notice'}" role="alert">${ic('warn')}<span>Bookmarks could not load.</span><span class="sp"></span>
  <button type="button" class="${phone ? 'tbtn' : 'btn'}" data-a="retry">${phone ? '' : ic('restore')}Retry</button></div>`;
export function deskBody() {
  const body = byId('body'), gridCls = 'grid' + (ui.layout === 'list' ? ' is-list' : '');
  body.classList.toggle('dim', !!data.error && data.has);
  let h = data.error ? noticeHTML(false) : '';
  if (!data.loaded || (!data.has && !data.error)) { body.innerHTML = `<div class="glbl">&nbsp;</div><div class="${gridCls}" aria-busy="true">${Array.from({ length: 8 }, skel).join('')}</div>`; return; }
  if (!data.has) { body.innerHTML = h; return; }
  if (ui.view === 'folders') { body.innerHTML = h + foldersScreen(false); return; }
  if (galleryOn()) { body.innerHTML = h + galleryHTML(false); return; }
  h += folderSection(false);
  const S = sections();
  if (!S.length) {
    if (onlySubs()) h += `<div class="${gridCls} solo">${addTileHTML('addtile')}</div>`;
    else if (ui.view === 'trash') h += `<div class="glbl">&nbsp;</div><div class="empty">Nothing here yet.</div>`;
    else if (ui.view === 'inbox') h += sortedHTML(false);
    else if (canAddTo()) h += `<div class="glbl">&nbsp;</div>${emptyMerge('empty merge')}`;
    else h += `<div class="glbl">&nbsp;</div><div class="empty">Nothing here yet.<button type="button" class="add" data-a="add">${ic('plus')}Add</button></div>`;
    body.innerHTML = h; return;
  }
  h += S.map((s, n) => `<div class="glbl">${esc(s.label)}</div><div class="${gridCls}"${contAttr(s.container)}>${s.items.map(b => deskTile(b, s.date(b))).join('')}${n === S.length - 1 && showAddTile() ? addTileHTML('addtile') : ''}</div>`).join('');
  body.innerHTML = h;
}
/* the toolbar keeps its nodes while only Select's state differs: Select flips in place */
const selFree = h => h.replace(/ aria-pressed="(true|false)" aria-label="(Select|Done)"/g, '');
export function setTb(w, html) { const s = selFree(html);
  if (w._sig !== s) { w.innerHTML = html; w._sig = s; return; }
  w.querySelectorAll('[data-a="select"]').forEach(b => { b.setAttribute('aria-pressed', ui.selecting); b.setAttribute('aria-label', ui.selecting ? 'Done' : 'Select'); }); }
export function renderDesk() {
  byId('screen').classList.toggle('selecting', ui.selecting);
  const side = byId('side'), st = side.querySelector('.side-tree'), sideScroll = st ? st.scrollTop : 0;
  hideTip();
  /* places first, then the folders under their head with New folder beside it, Trash at the foot above More */
  const sh = `<div class="brand" aria-hidden="true"><span class="brand-t">Pinned</span><svg class="brand-mark"><use href="#app-mark"/></svg></div>
    <div class="nav">${sideItem('dashboard', 'dash', 'grid')}${sideItem('all', 'all', 'all')}${sideItem('inbox', 'inbox', 'inbox')}</div>
    <div class="side-lbl"><span class="side-lt">Folders</span><button type="button" class="side-add" data-a="new-folder" aria-label="New folder">${ic('plus')}</button></div><div class="side-tree">${deskTree()}</div>
    <div class="side-foot${ui.footOpen ? ' open' : ''}">${sideItem('trash', 'trash', 'trash')}<button type="button" class="si foot-tog" data-a="foot" aria-expanded="${!!ui.footOpen}" aria-controls="footacts"><span class="si-ic">${ic('more')}</span><span class="si-n">More</span><span class="foot-chev" aria-hidden="true">${ic('chev')}</span></button>
      <div class="foot-acts" id="footacts"><div class="foot-in">${sideAction('Import', 'import', 'import')}
      <a class="si" href="/api/export" download><span class="si-ic">${ic('export')}</span><span class="si-n">Export</span></a>${sideAction('API tokens', 'key', 'tokens')}
      <a class="si" href="/bookmarklet"><span class="si-ic">${ic('all')}</span><span class="si-n">Save button</span></a>${sideAction('Log out', 'logout', 'logout')}
      <a class="si" href="${SOURCE_URL}" target="_blank" rel="noopener"><span class="si-ic">${ic('open')}</span><span class="si-n">Source</span></a>${ui.version ? `<p class="app-ver">Pinned ${esc(ui.version)}</p>` : ''}</div></div></div>`;
  if (side._h !== sh) { side.innerHTML = sh; side._h = sh; side.querySelector('.side-tree').scrollTop = sideScroll; }
  syncSearch();
  const dk = byId('dockwrap'), dh = deskDock(); if (dk._h !== dh) { dk.innerHTML = dh; dk._h = dh; }
  setTb(byId('tbwrap'), deskToolbar());
  setDeskBar();
  deskBody();
}

/* ================= folders as tiles ================= */
/* folder tiles: short and wide, a folder icon in the folder hue before the name, the count below */
export const showFolders = () => typeof ui.view === 'number';
/* on the Folders screen a tile carries the selection tick; it shows while selecting */
export const ftileHTML = f => { const shut = isLocked(f), pk = foldersSel() && !shut, on = pk && ui.picked.has(f.id);
  return `<button type="button" class="ftile ${hueClass(f.id)}${shut ? ' locked' : ''}${on ? ' picked' : ''}" data-view="${f.id}" data-ftile="${f.id}"${pk && ui.selecting ? ` aria-pressed="${on}"` : ''} aria-label="${esc(f.name)}, ${shut ? 'locked' : count(f.id)}">${pk ? `<span class="chk" aria-hidden="true">${ic('check')}</span>` : ''}
  <span class="ft-n">${ic('folder', 'fi')}<span class="ft-t">${esc(f.name)}</span>${f.share ? ic('link', 'lk') : ''}${f.locked && !shut ? ic('lock', 'lk') : ''}</span><span class="ft-c num">${shut ? ic('lock', 'ft-lock') : ftFaces(f.id)}</span></button>`; };
/* the folder's count as a short row of its newest favicons, then +n for the rest; null is every bookmark */
export function ftFaces(id) {
  const s = id == null ? null : descSet(id), L = live().filter(b => !s || (fid(b) != null && s.has(b.folder_id))).sort((a, b) => b.created_at - a.created_at);
  if (!L.length) return '0';
  const show = L.slice(0, 3), rest = L.length - show.length;
  return `<span class="ft-faces">${show.map(b => favHTML(b, 20)).join('')}${rest ? `<span class="ft-more">+${rest}</span>` : ''}</span>`;
}
/* inside a folder its subfolders sit above the cards as a plain grid */
export function folderSection(phone) {
  if (!data.has || !showFolders()) return '';
  const L = kids(ui.view); if (!L.length) return '';
  return `<div class="${phone ? 'pglbl' : 'glbl'}"><span>Folders</span></div><div class="fgrid${phone ? ' fgrid-p' : ''}" role="group" aria-label="Folders">${L.map(ftileHTML).join('')}</div>`;
}
/* the Folders screen: All bookmarks as the first card, every top level folder in the chosen order, and Trash as a quiet
   row at the foot, always there with its count */
export function foldersScreen(phone) {
  const L = sortedTop(), n = count('all'), nt = count('trash');
  const all = `<button type="button" class="ftile fplace" data-view="all" aria-label="All bookmarks, ${n}"><span class="ft-n">${ic('all', 'fi')}<span class="ft-t">All bookmarks</span></span><span class="ft-c num">${ftFaces(null)}</span></button>`;
  const nf = L.length ? '' : `<button type="button" class="ftile fnew" data-a="new-folder">${ic('plus', 'fi')}<span>New folder</span></button>`;
  return `<div class="fgrid${phone ? ' fgrid-p' : ''} fscreen" role="group" aria-label="Folders">${all}${L.map(ftileHTML).join('')}${nf}</div>
    <button type="button" class="ftrash${phone ? ' p' : ''}" data-view="trash" aria-label="Trash, ${nt}">${ic('trash')}<span class="ftrash-n">Trash</span><span class="ftrash-c num">${nt}</span>${ic('chev', 'ftrash-ch')}</button>`;
}
/* a folder with subfolders and no links of its own shows the small add tile */
export const onlySubs = () => typeof ui.view === 'number' && !ui.selecting && kids(ui.view).length > 0 && !listFor().length && canAddTo();
/* the mini tiles of the folder pickers in the sheets */
export const fmini = (f, o = {}) => { const attr = o.attr || 'view', h = f.hue ? 'hue-' + f.hue : hueClass(f.id);
  const state = o.current != null ? (o.radio ? ` role="radio" aria-checked="${o.current}"` : ` aria-current="${o.current}"`) : '';
  return `<button type="button" class="fmini ${h}${o.fill ? ' fill' : ''}${o.dashed ? ' dashed' : ''}"${o.a ? ` data-a="${o.a}"` : ` data-${attr}="${f.id}"`}${state}>
    <span class="v"><span class="nm">${o.dashed ? ic('plus', 'plus') : ic(f.id === 'inbox' ? 'inbox' : 'folder', 'fi')}<span class="nt">${esc(o.label || f.name)}</span></span>${f.share && attr === 'view' ? ic('link', 'lk') : ''}${f.locked ? ic('lock', 'lk') : ''}${o.noCount || o.dashed ? '' : `<span class="c num">${count(f.id)}</span>`}</span></button>`; };
export const INBOX_F = { id: 'inbox', name: 'Inbox', hue: 'tray' };
/* every folder as a mini tile for the pickers: Inbox, then the tree in order, subfolders by their path */
export function miniPicker(o = {}) {
  const ex = o.exclude || new Set();
  const all = dfs().filter(id => !ex.has(id) && pickable(id)).map(id => folderById.get(id));
  return `<div class="fpick" role="group" aria-label="Folders">${o.pre || ''}${all.map(f => fmini(f, { attr: o.attr || 'dest', current: o.sel === f.id, fill: o.sel === f.id, label: pathOf(f.id), noCount: true })).join('')}${o.post || ''}</div>`;
}

/* ================= phone ================= */
/* the phone opens on the grid: Recent and the title scroll away, search and Add float over the grid at the bottom */
export function mountPhone() {
  byId('app').innerHTML = `<div class="papp" id="papp"><div id="pmain"></div>
    <div class="pbottom" id="pbottom">
      <div class="psrow" id="psrow">${searchField(true)}
        <button type="button" class="padd" data-a="add" aria-label="Add">${ic('plus')}</button></div>
      <div id="pbulkwrap"></div></div></div>`;
  const pb = byId('pbottom');
  if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--pb', pb.offsetHeight + 'px')).observe(pb);
  syncSearch(); vvSync();
}


export const nfMini = () => fmini({ id: 'new', name: 'New folder', hue: 'plain' }, { a: 'nf-open', dashed: true });
/* a div, not a form: it sits inside the save form */
export const nfForm = () => `<div class="nf" data-nf><input class="fld-in" name="nf-name" placeholder="Folder name" aria-label="Folder name" autocomplete="off" enterkeyhint="done"><button type="button" class="tbtn" data-a="nf-create">Create</button></div>`;
/* the card's link, a checkbox while selecting; Select and Done swap only this shell and keep what is inside */
export const ptShell = (b, inner) => { const label = `${esc(b.title)}, ${esc(hostOf(b))}`; return ui.selecting
    ? `<button type="button" class="pt-in" data-a="pick" role="checkbox" aria-checked="${ui.picked.has(b.id)}" aria-label="Select ${esc(b.title)}">${inner}<span class="chk" aria-hidden="true">${ic('check')}</span></button>`
    : b.deleted_at ? `<button type="button" class="pt-in" data-a="tile-acts" aria-label="${label}">${inner}</button>`
    : `<a class="pt-in" href="${esc(b.url)}" target="_blank" rel="noopener" draggable="false" data-open="${b.id}" aria-label="${label}">${inner}</a>`; };
export function phoneTile(b, ts) {
  const inner = `<span class="pt-main">${favHTML(b, 36)}<span class="pt-title">${hl(b.title)}</span>${hostLine(hostOf(b), 'host', true)}</span>
    <span class="pt-strip hue-${hue(fid(b))}"><span class="dot"></span>${ts ? `<time datetime="${isoDate(ts)}">${fmtDate(ts)}</time>` : ''}</span>`;
  return `<article class="pt${ui.layout === 'list' ? ' row' : ''}${ui.picked.has(b.id) ? ' picked' : ''}" data-id="${b.id}">` + ptShell(b, inner) + `</article>`;
}
export const pskel = () => `<div class="pt sk" aria-hidden="true"><div class="b f"></div><div class="b l1"></div><div class="b l2"></div></div>`;
export function phoneTop() {
  const v = ui.view, title = v === 'all' ? 'All bookmarks' : viewName(v);
  if (v === 'settings') return `<header class="ptbar home set"><button type="button" class="ib weak pchev" data-view="dashboard" aria-label="Back to Dashboard">${ic('back')}</button><h2 class="ptb-t">Settings</h2><span class="ptb-sp"></span></header>`;
  if (PHONE_TABS.includes(v)) return phoneTabs();
  /* the title row: on a folder the three dots with what acts on the folder itself; selecting leaves it as it is */
  const right = typeof v === 'number' ? `<button type="button" class="ib weak" data-a="folder-menu" aria-haspopup="menu" aria-label="Folder actions">${ic('more')}</button>`
    : v === 'trash' && data.has && count('trash') ? `<button type="button" class="vbar-a warn" data-a="empty-trash">Empty trash</button>` : '';
  return `<header class="ptbar home"><h2 class="ptb-t">${esc(title)}</h2><span class="ptb-c">${data.has ? count(v) : ''}</span>${typeof v === 'number' ? shareBtn(v, 'ptb-share') : ''}<span class="ptb-sp"></span>${right}</header>`;
}
/* the start screen on the phone: Dashboard, Inbox and Folders as tabs, only the chosen one carries a shape */
export function phoneTabs() {
  const t = ui.view, ni = count('inbox'), nf = count('folders');
  const tab = (k, label, n) => `<button type="button" class="ptab" role="tab" aria-selected="${t === k}" data-a="tab" data-tab="${k}">${label}${n ? `<span class="ptab-n num">${n}</span>` : ''}</button>`;
  return `<header class="ptbar home tabs"><div class="ptabs" role="tablist" aria-label="Start"><span class="ptab-ind" aria-hidden="true"></span>${tab('dashboard', 'Dashboard', 0)}${tab('inbox', 'Inbox', ni)}${tab('folders', 'Folders', nf)}</div><span class="ptb-sp"></span></header>`;
}
/* the phone's view row, where the first section label sat: the order in use on the left (Trash's fixed label in Trash), the view's own actions on the right. The Folders tab: its order, and New folder */
const vbarLabel = () => sortable() ? SORTS[ui.sort] : 'Kept for 30 days';
export function phoneVbar() {
  const v = ui.view;
  if (v === 'folders') return `<div class="vbar">${kids(null).length > 1 ? sortCtl(true, 'p') : ''}<span class="ptb-sp"></span>${ui.selecting || selectables().length ? selIb() : ''}
    <button type="button" class="ib weak vbar-add" data-a="new-folder" aria-label="New folder">${ic('plus')}</button></div>`;
  if (!hasItems()) return '';
  const left = sortable(v) ? sortCtl(false, 'p') : `<span class="vbar-t">${vbarLabel()}</span>`;
  return `<div class="vbar">${left}<span class="ptb-sp"></span>${selIb()}${layoutSwitch(' p')}</div>`;
}
/* the share button beside a folder's title: muted, accent once the folder is shared */
export const shareBtn = (id, cls) => { const f = folderById.get(id), on = !!(f && f.share);
  if (f && f.locked) return `<button type="button" class="share-ic lock-btn ${cls} on" data-a="relock" aria-label="Lock now" title="Lock now">${ic('lock')}</button>`;
  return `<button type="button" class="share-ic ${cls}${on ? ' on' : ''}" data-a="share-open" aria-label="${on ? 'Sharing' : 'Share'}" title="${on ? 'Sharing' : 'Share'}">${ic('link')}</button>`; };
/* the settings screen on the phone: everything about the app itself, plain rows with an icon chip, a fact and a chevron */
export function settingsScreen() {
  const nb = live().length, nf = data.folders.length, nt = count('trash');
  const chip = (icon, hue) => `<span class="sr-ic ${hue}">${ic(icon)}</span>`;
  const body = (label, sub) => `<span class="sr-t"><span>${label}</span>${sub ? `<span class="sr-s">${sub}</span>` : ''}</span>`;
  const row = (a, icon, hue, label, sub, warn) => `<button type="button" class="sr${warn ? ' warn' : ''}" data-a="${a}">${chip(icon, hue)}${body(label, sub)}${warn ? '' : `<span class="sr-ch">${ic('chev')}</span>`}</button>`;
  const link = (href, icon, hue, label, sub, ext) => `<a class="sr" href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}>${chip(icon, hue)}${body(label, sub)}<span class="sr-ch">${ic(ext ? 'open' : 'chev')}</span></a>`;
  const tokens = ui.tokenCount == null ? '' : ui.tokenCount === 0 ? 'No tokens yet' : ui.tokenCount === 1 ? '1 token' : `${ui.tokenCount} tokens`;
  return `<div class="pset">
    <div class="pset-head"><svg class="pset-mark" aria-hidden="true"><use href="#app-mark"/></svg><div><div class="pset-name">Pinned${ui.version ? ` <span class="pset-ver">${esc(ui.version)}</span>` : ''}</div><div class="pset-sum">${nb} ${nb === 1 ? 'bookmark' : 'bookmarks'} in ${nf} ${nf === 1 ? 'folder' : 'folders'}${nt ? `, ${nt} in the Trash` : ''}</div></div></div>
    <div class="pset-lbl">Save</div>
    ${link('/bookmarklet', 'all', 'hue-tray', 'Save button', 'Bookmarklet, Shortcut and extension')}${row('tokens', 'key', 'hue-mint', 'API tokens', tokens)}
    <div class="pset-lbl">Data</div>
    ${row('import', 'import', 'hue-cyan', 'Import', 'A bookmarks file from any browser')}${link('/api/export', 'export', 'hue-lilac', 'Export', 'bookmarks.html, written nightly too')}
    <div class="pset-lbl">About</div>
    ${link(SOURCE_URL, 'open', 'hue-plain', 'Source', 'Open source, AGPL-3.0', true)}
    <div class="pset-lbl"></div>
    ${row('logout', 'logout', 'hue-bin', 'Log out', '', true)}
  </div>`;
}
export function phoneBody() {
  let h = data.error ? noticeHTML(true) : '';
  if (ui.view === 'settings') return settingsScreen();
  if (!data.loaded || (!data.has && !data.error)) return h + `<div class="pglbl"><span>&nbsp;</span></div><div class="pgrid" aria-busy="true">${Array.from({ length: 6 }, pskel).join('')}</div>`;
  if (!data.has) return h;
  if (ui.view === 'folders') return h + phoneVbar() + foldersScreen(true);
  if (galleryOn()) return h + galleryHTML(true);
  const S = sections();
  if (!S.length && onlySubs()) return h + `<div class="pgrid solo${ui.layout === 'list' ? ' is-list' : ''}">${addTileHTML('pt-add')}</div>`;
  if (!S.length) return h + (ui.view === 'inbox' ? sortedHTML(true) : (canAddTo() ? emptyMerge('pempty merge') : `<div class="pempty">Nothing here yet.</div>`));
  /* the view row names the order, so a first section label that says the same is left out */
  const bar = phoneVbar(), same = bar ? vbarLabel() : null;
  return h + bar + S.map((s, i) => `${!i && s.label === same ? '' : `<div class="pglbl"><span>${esc(s.label)}</span></div>`}<div class="pgrid${ui.layout === 'list' ? ' is-list' : ''}"${contAttr(s.container)}>${s.items.map(b => phoneTile(b, s.date(b))).join('')}${s === S[S.length - 1] && showAddTile() ? addTileHTML('pt-add') : ''}</div>`).join('');
}
export function phoneRecents() {
  if (!data.has) return '';
  const head = PHONE_TABS.includes(ui.view) ? `<div class="phead"><h1 class="phead-t">Pinned</h1><button type="button" class="ib gear" data-view="settings" aria-label="Settings">${ic('gear')}</button></div>` : '';
  /* the pinned links, marked with a pin: the phone's dock; the recently opened ones live on the Dashboard */
  const all = pinned();
  if (!all.length) return head;
  return head + `<div class="pglbl prc-lbl"><span>Pinned</span></div><nav class="precent" aria-label="Recent" data-dock>` + all.map(b => { const src = iconSrc(b), l = esc(b.letter || b.title.charAt(0));
    return `<a class="prc${b.pinned ? ' pinned' : ''}" href="${esc(b.url)}" target="_blank" rel="noopener" data-id="${b.id}" data-open="${b.id}" draggable="false" aria-label="${esc(b.title)}${b.pinned ? ', pinned' : ''}">
      <span class="prc-ic" data-l="${l}"${src ? ` style="--tile:${esc(b.tile || '#2a303b')}"` : ''}>${src ? `<img src="${esc(src)}" alt="" width="44" height="44" draggable="false">` : l}</span>${b.pinned ? `<span class="prc-pin" aria-hidden="true">${ic('pin')}</span>` : ''}
      <span class="prc-l">${esc(b.title)}</span></a>`; }).join('') + `</nav>`;
}
export function phoneBulk() { const n = ui.picked.size, dis = n ? '' : 'disabled';
  /* the count and All are one control: a tap on it selects every card; the bar keeps the desktop's actions in the desktop's order */
  return `<div class="pbulk" role="toolbar" aria-label="Selection"><span class="pn"><button type="button" class="pall" data-a="sel-all"><span class="n num">${n}<span class="vh"> selected</span></span><span class="pall-t"><span class="vh">, select </span>All</span></button></span>` + (foldersSel()
    ? `<button type="button" class="bb warn wide" data-a="bulk-ftrash" ${dis}>${ic('trash')}Delete</button>`
    : ui.view === 'trash'
    ? `<button type="button" class="bb" data-a="bulk-restore" ${dis}>${ic('restore')}Restore</button><button type="button" class="bb warn" data-a="bulk-purge" ${dis}>${ic('trash')}Delete</button>`
    : `<button type="button" class="bb" data-a="bulk-move" ${dis}>${ic('move')}Move</button><button type="button" class="bb" data-a="bulk-copy" ${dis}>${ic('link')}Copy</button><button type="button" class="bb" data-a="bulk-share" ${dis}>${ic('share')}Share</button><button type="button" class="bb warn" data-a="bulk-trash" ${dis}>${ic('trash')}Trash</button><button type="button" class="bb" data-a="sel-more" aria-haspopup="menu" aria-label="More actions" ${dis}>${ic('more')}More</button>`) + `</div>`; }
let phoneMainView = null;
const KEEP = '.ptbar, .vbar, .phead, .gal-hr';
export function renderPhoneMain() {
  const m = byId('pmain'), rows = '.precent', sx = [...m.querySelectorAll(rows)].map(e => e.scrollLeft);
  const oi = m.querySelector('.ptab-ind'), from = oi && oi.offsetWidth ? { x: oi.offsetLeft + (oi._x || 0), w: oi.offsetWidth } : null;
  const st = ui.view === 'settings';
  const tabbed = PHONE_TABS.includes(ui.view);
  const fresh = Object.assign(document.createElement('template'), { innerHTML: (st ? '' : phoneRecents()) + (st ? '' : backLink('pback')) + phoneTop() + `<div class="bd">${st || tabbed ? '' : folderSection(true)}${phoneBody()}</div>` }).content;
  /* the title row, the tabs and the view row are the same elements when nothing in them changed, so a tick or a hold redraws nothing up there; Select only flips its state */
  const sig = e => { const c = e.cloneNode(true); c.querySelectorAll('[data-a="select"]').forEach(b => { b.removeAttribute('aria-pressed'); b.removeAttribute('aria-label'); }); return c.outerHTML; }, old = [...m.querySelectorAll(KEEP)];
  fresh.querySelectorAll(KEEP).forEach((e, i) => { const o = old[i], s = sig(e);
    if (o && o._sig === s) { const nb = e.querySelector('[data-a="select"]'), ob = o.querySelector('[data-a="select"]'); if (nb && ob) for (const a of ['aria-pressed', 'aria-label']) ob.setAttribute(a, nb.getAttribute(a)); e.replaceWith(o); } else e._sig = s; });
  m.replaceChildren(fresh);
  const now = [...m.querySelectorAll(rows)], same = phoneMainView === ui.view; phoneMainView = ui.view;
  if (same && sx.length === now.length) now.forEach((e, i) => { if (sx[i]) e.scrollLeft = sx[i]; });
  placeTabInd(m, from);
  syncSearch();
}
/* the selected tab's shape is one element that slides between the tabs; the labels never move */
function placeTabInd(m, from) {
  const ind = m.querySelector('.ptab-ind'), sel = m.querySelector('.ptab[aria-selected="true"]');
  if (!ind || !sel) return;
  const x = sel.offsetLeft, w = sel.offsetWidth, set = (px, pw) => { ind._x = px; ind.style.transform = `translateX(${px}px)`; ind.style.width = pw + 'px'; };
  const jump = (px, pw) => { ind.style.transition = 'none'; set(px, pw); void ind.offsetWidth; ind.style.transition = ''; };
  if (!from || reduce() || (from.x === x && from.w === w)) { jump(x, w); return; }
  jump(from.x, from.w); set(x, w);
}
export function renderPhone() {
  renderPhoneMain();
  byId('papp').classList.toggle('selecting', ui.selecting);
  byId('psrow').hidden = ui.view === 'settings'; byId('papp').classList.toggle('nobar', ui.view === 'settings');
  setBar(byId('pbulkwrap'), ui.selecting ? phoneBulk() : '');
}

/* ================= render ================= */
export function render() {
  if (document.body.dataset.page !== 'app') return;
  if (ui.renaming && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.rename) return; /* the rename field keeps its caret; it redraws when done */
  const mode = isPhone() ? 'phone' : 'desk'; let carry = null;
  if (mode !== ui.mode) { ui.mode = mode; document.body.classList.toggle('phone', mode === 'phone'); document.body.classList.toggle('desk', mode === 'desk');
    /* an open search moves with the layout: the same query and results, now from the other place */
    closeMenu(); carry = layers.palette && { q: ui.q, idx: layers.palette.idx, hist: layers.palette.hist, swap: true }; closePalette(false, !!carry);
    /* the phone's Settings screen is the sidebar's More on the desktop: widening on it lands on the Dashboard with More open */
    if (mode === 'desk' && ui.view === 'settings') { ui.view = 'dashboard'; ui.footOpen = true; }
    if (mode === 'phone') mountPhone(); else mountDesk(); }
  const ae = document.activeElement, tileEl = ae && ae.closest ? ae.closest('#app [data-id]') : null;
  const keep = tileEl ? { id: tileEl.dataset.id, a: ae.dataset.a, title: ae.matches('.t-title,.pt-in,.g-in,.dk'), dock: !!ae.closest('[data-dock]') } : null;
  const cs = byId('content'), top = cs ? cs.scrollTop : 0;
  if (mode === 'phone') renderPhone(); else renderDesk();
  if (cs) cs.scrollTop = top;
  if (carry) openPalette(carry);
  else if (layers.palette && !layers.palette.had && data.has) { palRecentFill(); palFill(); } /* a search opened before the bookmarks loaded */
  if (keep) { const scope = keep.dock ? '[data-dock] ' : '#app article';
    const t = document.querySelector(`${scope}[data-id="${keep.id}"]`);
    const el = t && (keep.title ? (t.matches('a') ? t : t.querySelector('.t-title,.pt-in,.g-in')) : keep.a ? t.querySelector(`[data-a="${keep.a}"]`) : null);
    if (el) el.focus({ preventScroll: true }); }
}
export function renderList() { if (ui.mode === 'phone') renderPhoneMain(); else { deskBody(); const c = document.querySelector('.tb .cnt'); if (c && data.has) c.textContent = count(ui.view); } }

export const canAddTo = () => typeof ui.view === 'number' || ui.view === 'inbox';
/* the dashed "Add bookmark" entry closes every folder, Inbox and All; it is a button, so selection, drag, marquee and arrows, which work on articles, pass over it */
export const showAddTile = () => (typeof ui.view === 'number' || ui.view === 'inbox' || ui.view === 'all');
/* an empty folder: one dashed box, two ways in; the Inbox only takes new ones */
export const emptyMerge = cls => `<div class="${cls}"><span>Nothing here yet.</span><span class="em-acts">
  <button type="button" class="em-a" data-a="add-new">${ic('plus')}Add bookmark</button>${ui.view === 'inbox' ? '' : `<button type="button" class="em-a" data-a="add-to">${ic('move')}Add existing</button>`}</span></div>`;
export const addTileHTML = cls => `<button type="button" class="${cls}" data-a="add-new">${ic('plus')}<span>Add bookmark</span></button>`;
/* grid and list: cards morph into their rows with a view transition, or the body crossfades */
export function switchLayout(to) {
  const swap = () => { ui.layout = to; store.set('layout', to); render(); };
  if (reduce()) { swap(); return; }
  if (document.startViewTransition) {
    const H = innerHeight, seen = new Set();
    const name = (all, only) => all.forEach(el => { const r = el.getBoundingClientRect(), id = el.dataset.id;
      if (only ? only.has(id) : r.bottom > 0 && r.top < H) { el.style.viewTransitionName = 'b' + id; seen.add(id); } });
    const cards = () => document.querySelectorAll('#body article.tile[data-id], #pmain article.pt[data-id]');
    name(cards());
    const keep = new Set(seen);
    const vt = document.startViewTransition(() => { swap(); name(cards(), keep); });
    vt.finished.finally(() => cards().forEach(el => { el.style.viewTransitionName = ''; }));
    return;
  }
  swap(); const b = byId('body'); if (b && b.animate) b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'cubic-bezier(.23,1,.32,1)' });
}


/* the sidebar folds to an icon rail from 720 to 999 px; a row's name shows beside it on hover and on keyboard focus,
   and in the full sidebar wherever a name is cut */
export const RAIL = matchMedia('(min-width:720px) and (max-width:999px)');
let tipEl = null;
export const hideTip = () => { if (tipEl) tipEl.hidden = true; };
function showTip(el) {
  const n = el.querySelector('.si-n'), text = n ? n.textContent : el.getAttribute('aria-label');
  if (!text || (n && !RAIL.matches && n.scrollWidth <= n.clientWidth)) { hideTip(); return; }
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(tipEl); }
  tipEl.textContent = text; tipEl.hidden = false;
  const r = el.getBoundingClientRect(); tipEl.style.left = Math.round(r.right + 8) + 'px'; tipEl.style.top = Math.round(r.top + r.height / 2) + 'px';
}
const TIPS = '#side .si, #side .side-add';

/* listeners on document and window, registered once by app.js */
export function installRender() {
  addEventListener('resize', () => { if (ui.mode === 'desk' && ui.selecting) fitBulk(); });
  addEventListener('resize', () => syncSearch());
  addEventListener('resize', hideTip);
  document.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest(TIPS); if (el && e.pointerType === 'mouse') showTip(el); else hideTip(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest(TIPS); if (el && el.matches(':focus-visible')) showTip(el); else hideTip(); });
  document.addEventListener('scroll', hideTip, true);
}
