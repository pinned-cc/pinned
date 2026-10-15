/* Markup for the desktop and the phone: sidebar, toolbar, pinned dock, folder tiles, the grid and list, the
   phone Recent row and bottom bar. render() picks the layout and redraws. */
import { closeMenu } from './menu.js';
import { closePalette } from './palette.js';
import { vvSync } from './phone.js';
import { SORTS, SOURCE_URL, chain, count, data, descSet, dfs, fid, folderById, hostOf, hue, hueClass, iconSrc, isLocked, kids, listFor, live, pathOf, pickable, pinned, sections, ui, viewName } from './state.js';
import { byId, esc, fmtDate, highlight, ic, isMac, isPhone, isoDate, reduce, store, truncStart } from './util.js';

/* search hits in the app: the current search unless a query is given */
export const hl = (s, query) => highlight(s, query == null ? ui.q : query);
/* a host and port on one line, cut at the start; mark highlights the search */
export const hostLine = (host, cls = '', mark, query) => truncStart(mark ? hl(host, query) : esc(host), cls);

/* shared pieces */
export const favHTML = (b, size = 40) => {
  if (!b) return `<span class="fav">${ic('all')}</span>`;
  const src = iconSrc(b), l = esc(b.letter || (b.title || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="fav" data-l="${l}"${src ? ` style="--tile:${esc(b.tile || '#2a303b')}"` : ''}>${src ? `<img src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" draggable="false">` : l}</span>`;
};
export const contAttr = c => c === undefined ? '' : ` data-container="${c === null ? 'inbox' : c}"`;

/* ================= desktop ================= */
export const kHint = isMac ? '⌘K' : 'Ctrl K';
export function mountDesk() {
  byId('app').innerHTML = `<div class="screen" id="screen"><aside class="side" id="side" aria-label="Folders"></aside>
    <main class="content" id="content"><div class="col"><div class="head" id="head"></div><div id="dockwrap"></div><div id="tbwrap"></div><div class="body" id="body"></div></div></main></div>`;
  byId('head').innerHTML = `<label class="search" for="q">${ic('search')}<span class="vh">Search</span>
    <input id="q" type="search" placeholder="Search bookmarks or press ${kHint}" autocomplete="off" spellcheck="false" enterkeyhint="search"><span class="kcap" aria-hidden="true">/</span></label><div class="scope" id="scope" role="group" aria-label="Show"></div>`;
  byId('q').value = ui.q;
}
export const sideItem = (v, cls, icon) => `<button type="button" class="si ${cls}" data-view="${v}" aria-current="${ui.view === v}">
  <span class="si-ic">${ic(icon)}</span><span class="si-n">${viewName(v)}</span><span class="si-c">${data.has ? count(v) : ''}</span></button>`;
export const sideAction = (name, icon, a) => `<button type="button" class="si" data-a="${a}"><span class="si-ic">${ic(icon)}</span><span class="si-n">${name}</span></button>`;
export function deskTree() {
  const sel = ui.view, path = typeof sel === 'number' ? new Set(chain(sel).map(f => f.id)) : new Set();
  /* folders use the same row as All bookmarks, Inbox and Trash: the icon box carries the folder hue */
  const row = (f, sub) => `<button type="button" class="si sf ${hueClass(f.id)}${sub ? ' sub' : ''}${isLocked(f) ? ' locked' : ''}" data-view="${f.id}" data-fid="${f.id}" aria-current="${f.id === sel}" aria-label="${esc(f.name)}, ${count(f.id)}" title="${esc(f.name)}">
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
/* one level up: a folder's parent, Inbox from everywhere else */
export function backLink(cls) {
  const v = ui.view; if (ui.selecting || v === 'inbox') return '';
  const f = folderById.get(v), p = f && f.parent_id != null ? folderById.get(f.parent_id) : null;
  return `<button type="button" class="uplink ${cls}" data-view="${p ? p.id : 'inbox'}">${ic('back')}<span>${esc(p ? p.name : 'Inbox')}</span></button>`;
}
export function deskToolbar() {
  const v = ui.view;
  if (ui.selecting) { const n = ui.picked.size, dis = n ? '' : 'disabled', tr = v === 'trash';
    return `<div class="tb bulk" role="toolbar" aria-label="Selection"><span class="n num">${n} <span>selected</span></span><span class="sp"></span>
      <button type="button" class="btn lbl" data-a="sel-all" aria-label="Select all">${ic('select')}<span class="t">Select all</span></button>
      ${tr ? `<button type="button" class="btn lbl" data-a="bulk-restore" aria-label="Restore" ${dis}>${ic('restore')}<span class="t">Restore</span></button><button type="button" class="btn warn lbl" data-a="bulk-purge" aria-label="Delete" ${dis}>${ic('trash')}<span class="t">Delete</span></button>`
           : `<button type="button" class="btn lbl" data-a="bulk-move" aria-label="Move" ${dis}>${ic('move')}<span class="t">Move</span></button><button type="button" class="btn warn lbl" data-a="bulk-trash" aria-label="Move to Trash" ${dis}>${ic('trash')}<span class="t">Move to Trash</span></button>`}
      <button type="button" class="btn" data-a="sel-done">Done</button></div>`; }
  const isF = typeof v === 'number';
  if (v === 'folders') return backLink('dback') + `<div class="tb" role="toolbar" aria-label="Folders"><h2>Folders</h2><span class="cnt">${data.has ? count(v) : ''}</span><span class="sp"></span>
    <button type="button" class="btn icon" data-a="folders-menu" aria-haspopup="menu" aria-label="Folder actions" title="Folder actions">${ic('more')}</button></div>`;
  return backLink('dback') + `<div class="tb" role="toolbar" aria-label="${esc(viewName(v))}"><h2>${esc(viewName(v))}</h2><span class="cnt">${data.has ? count(v) : ''}</span>${isF ? shareBtn(v, 'tb-share') : ''}<span class="sp"></span>
    ${v === 'trash' ? '' : `<button type="button" class="add" data-a="add">${ic('plus')}Add</button>`}
    <div class="vsw" role="group" aria-label="View">
      <button type="button" data-layout="grid" aria-pressed="${ui.layout === 'grid'}" aria-label="Grid">${ic('grid')}</button>
      <button type="button" data-layout="list" aria-pressed="${ui.layout === 'list'}" aria-label="List">${ic('list')}</button></div>
    ${v === 'trash' || v === 'recent' ? '' : `<button type="button" class="btn lbl" data-a="sort" aria-haspopup="menu" aria-label="Sort, ${SORTS[ui.sort]}">${ic('sort')}<span class="t">${SORTS[ui.sort]}</span></button>`}
    <button type="button" class="btn lbl" data-a="select" aria-label="Select">${ic('select')}<span class="t">Select</span></button>
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
  if (ui.view === 'folders' && !ui.q.trim()) { body.innerHTML = h + foldersScreen(false); return; }
  h += folderSection(false);
  const S = sections(false);
  if (!S.length) {
    if (ui.q.trim()) h += `<p class="nores">No matches.</p>`;
    else if (onlySubs()) h += `<div class="${gridCls} solo">${addTileHTML('addtile')}</div>`;
    else if (ui.view === 'trash' || ui.view === 'recent') h += `<div class="glbl">&nbsp;</div><div class="empty">Nothing here yet.</div>`;
    else if (canAddTo()) h += `<div class="glbl">&nbsp;</div>${emptyMerge('empty merge')}`;
    else h += `<div class="glbl">&nbsp;</div><div class="empty">Nothing here yet.<button type="button" class="add" data-a="add">${ic('plus')}Add</button></div>`;
    body.innerHTML = h; return;
  }
  h += S.map((s, n) => `<div class="glbl">${esc(s.label)}</div><div class="${gridCls}"${contAttr(s.container)}>${s.items.map(b => deskTile(b, s.date(b))).join('')}${n === S.length - 1 && showAddTile() ? addTileHTML('addtile') : ''}</div>`).join('');
  body.innerHTML = h; setCw();
}
/* the home folder row uses the bookmark card column width: the same auto-fill sum as .grid */
export function setCw() { const b = byId('body'); if (!b || ui.mode !== 'desk') return; const W = b.clientWidth, n = Math.max(1, Math.floor((W + 16) / 216));
  b.style.setProperty('--cw', ((W - 16 * (n - 1)) / n) + 'px'); }
export const deskPlaceholder = () => { const q = byId('q'); if (q && ui.mode === 'desk') q.placeholder = innerWidth > 1100 ? `Search bookmarks or press ${kHint}` : `Search, ${kHint}`; };
export function renderDesk() {
  byId('screen').classList.toggle('selecting', ui.selecting);
  const side = byId('side'), st = side.querySelector('.side-tree'), sideScroll = st ? st.scrollTop : 0;
  side.innerHTML = `<div class="brand" aria-hidden="true">Pinned</div>
    <div class="nav">${sideItem('all', 'all', 'all')}${sideItem('inbox', 'inbox', 'inbox')}${sideItem('trash', 'trash', 'trash')}</div>
    <div class="side-lbl">Folders</div><div class="side-tree">${deskTree()}</div>
    <div class="side-foot">${sideAction('New folder', 'folder-plus', 'new-folder')}${sideAction('Import', 'import', 'import')}
      <a class="si" href="/api/export" download><span class="si-ic">${ic('export')}</span><span class="si-n">Export</span></a>${sideAction('API tokens', 'key', 'tokens')}
      <a class="si" href="/bookmarklet"><span class="si-ic">${ic('all')}</span><span class="si-n">Save button</span></a>${sideAction('Log out', 'logout', 'logout')}
      <a class="si" href="${SOURCE_URL}" target="_blank" rel="noopener"><span class="si-ic">${ic('open')}</span><span class="si-n">Source</span></a>${ui.version ? `<p class="app-ver">Pinned ${esc(ui.version)}</p>` : ''}</div>`;
  side.querySelector('.side-tree').scrollTop = sideScroll;
  byId('scope').innerHTML = `<button type="button" data-view="all" aria-pressed="${ui.view === 'all'}">${ic('grid', 's16')}All <span class="num">${data.has ? count('all') : ''}</span></button>
    <button type="button" data-view="recent" aria-pressed="${ui.view === 'recent'}">${ic('clock', 's16')}Recent</button>`;
  const q = byId('q'); if (document.activeElement !== q && q.value !== ui.q) q.value = ui.q;
  deskPlaceholder();
  byId('dockwrap').innerHTML = deskDock();
  byId('tbwrap').innerHTML = deskToolbar();
  deskBody();
}

/* ================= folders as tiles ================= */
/* folder tiles: short and wide, a folder icon in the folder hue before the name, the count below */
export const showFolders = () => !ui.q.trim() && !ui.selecting && (ui.view === 'inbox' || typeof ui.view === 'number');
export const ftileHTML = f => { const shut = isLocked(f);
  return `<button type="button" class="ftile ${hueClass(f.id)}${shut ? ' locked' : ''}" data-view="${f.id}" data-ftile="${f.id}" aria-label="${esc(f.name)}, ${shut ? 'locked' : count(f.id)}">
  <span class="ft-n">${ic('folder', 'fi')}<span class="ft-t">${esc(f.name)}</span>${f.share ? ic('link', 'lk') : ''}${f.locked && !shut ? ic('lock', 'lk') : ''}</span><span class="ft-c num">${shut ? ic('lock', 'ft-lock') : ftFaces(f.id)}</span></button>`; };
/* the folder's count as a short row of its newest favicons, then +n for the rest */
export function ftFaces(id) {
  const s = descSet(id), L = live().filter(b => fid(b) != null && s.has(b.folder_id)).sort((a, b) => b.created_at - a.created_at);
  if (!L.length) return '0';
  const show = L.slice(0, 3), rest = L.length - show.length;
  return `<span class="ft-faces">${show.map(b => favHTML(b, 20)).join('')}${rest ? `<span class="ft-more">+${rest}</span>` : ''}</span>`;
}
/* home: one sideways row of folder tiles that snaps per tile, See all opens the Folders screen */
export function folderSection(phone) {
  if (!data.has || !showFolders()) return '';
  const L = ui.view === 'inbox' ? kids(null) : kids(ui.view); if (!L.length) return '';
  /* inside a folder its subfolders sit above the cards as a plain grid */
  if (ui.view !== 'inbox') return `<div class="${phone ? 'pglbl' : 'glbl'}"><span>Folders</span></div><div class="fgrid${phone ? ' fgrid-p' : ''}" role="group" aria-label="Folders">${L.map(ftileHTML).join('')}</div>`;
  /* on the phone See all unfolds the row into the grid in place; on the desktop it opens the Folders screen */
  if (phone) { const open = !!ui.foldersOpen;
    return `<div class="pglbl fhead"><span>Folders</span><button type="button" class="see-all" data-a="folders-toggle" aria-expanded="${open}">${open ? 'Fewer' : 'See all'}</button></div>
    <div class="${open ? 'fgrid fgrid-p funfold' : 'fscroll fscroll-p'}" role="group" aria-label="Folders">${L.map(ftileHTML).join('')}</div>`; }
  return `<div class="glbl fhead"><span>Folders</span><button type="button" class="see-all" data-view="folders">See all</button></div>
    <div class="fscroll" role="group" aria-label="Folders">${L.map(ftileHTML).join('')}</div>`;
}
/* the Folders screen: every top level folder as a full tile */
export function foldersScreen(phone) {
  const L = kids(null);
  if (!L.length) return `<div class="${phone ? 'pempty' : 'empty'}">No folders yet.<button type="button" class="tbtn" data-a="new-folder">New folder</button></div>`;
  return `<div class="fgrid${phone ? ' fgrid-p' : ''} fscreen" role="group" aria-label="Folders">${L.map(ftileHTML).join('')}</div>`;
}
/* a folder with subfolders and no links of its own shows the small add tile */
export const onlySubs = () => typeof ui.view === 'number' && !ui.q.trim() && !ui.selecting && kids(ui.view).length > 0 && !listFor().length && canAddTo();
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
  ui.q = ''; /* the phone searches in the palette */
  byId('app').innerHTML = `<div class="papp" id="papp"><div id="pmain"></div>
    <div class="pbottom" id="pbottom">
      <div class="psrow" id="psrow"><button type="button" class="ps ps-trigger" data-a="palette">${ic('search')}<span class="ps-ph" id="psph">Search bookmarks</span></button>
        <button type="button" class="padd" data-a="add" aria-label="Add">${ic('plus')}</button></div>
      <div id="pbulkwrap"></div></div></div>`;
  const pb = byId('pbottom');
  if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--pb', pb.offsetHeight + 'px')).observe(pb);
  vvSync();
}


export const nfMini = () => fmini({ id: 'new', name: 'New folder', hue: 'plain' }, { a: 'nf-open', dashed: true });
/* a div, not a form: it sits inside the save form */
export const nfForm = () => `<div class="nf" data-nf><input class="fld-in" name="nf-name" placeholder="Folder name" aria-label="Folder name" autocomplete="off" enterkeyhint="done"><button type="button" class="tbtn" data-a="nf-create">Create</button></div>`;
export function phoneTile(b, ts) {
  const picked = ui.picked.has(b.id);
  const inner = `<span class="pt-main">${favHTML(b, 36)}<span class="pt-title">${hl(b.title)}</span>${hostLine(hostOf(b), 'host', true)}</span>
    <span class="pt-strip hue-${hue(fid(b))}"><span class="dot"></span>${ts ? `<time datetime="${isoDate(ts)}">${fmtDate(ts)}</time>` : ''}</span>`;
  const label = `${esc(b.title)}, ${esc(hostOf(b))}`;
  return `<article class="pt${picked ? ' picked' : ''}" data-id="${b.id}">` + (ui.selecting
    ? `<button type="button" class="pt-in" data-a="pick" role="checkbox" aria-checked="${picked}" aria-label="Select ${esc(b.title)}">${inner}<span class="chk" aria-hidden="true">${ic('check')}</span></button>`
    : b.deleted_at ? `<button type="button" class="pt-in" data-a="tile-acts" aria-label="${label}">${inner}</button>`
    : `<a class="pt-in" href="${esc(b.url)}" target="_blank" rel="noopener" draggable="false" data-open="${b.id}" aria-label="${label}">${inner}</a>`) + `</article>`;
}
export const pskel = () => `<div class="pt sk" aria-hidden="true"><div class="b f"></div><div class="b l1"></div><div class="b l2"></div></div>`;
export function phoneTop() {
  const v = ui.view, title = v === 'all' ? 'All bookmarks' : viewName(v);
  if (v === 'settings') return `<header class="ptbar home set"><button type="button" class="ib weak pchev" data-view="inbox" aria-label="Back to Inbox">${ic('back')}</button><h2 class="ptb-t">Settings</h2><span class="ptb-sp"></span></header>`;
  if (v === 'inbox' && !ui.selecting) return phoneTabs();
  const right = ui.selecting ? `<button type="button" class="ptb-done" data-a="sel-done">Done</button>`
    : `${v === 'folders' ? '' : `<button type="button" class="ib weak" data-a="select" aria-label="Select">${ic('select')}</button>`}<button type="button" class="ib weak" data-a="phone-menu" aria-label="More">${ic('more')}</button>`;
  return `<header class="ptbar home"><h2 class="ptb-t">${esc(title)}</h2><span class="ptb-c">${data.has ? count(v) : ''}</span>${typeof v === 'number' && !ui.selecting ? shareBtn(v, 'ptb-share') : ''}<span class="ptb-sp"></span>${right}</header>`;
}
/* the start screen on the phone: Inbox and Folders as two tabs, only the chosen one carries a shape */
export function phoneTabs() {
  const t = ui.tab, ni = count('inbox'), nf = count('folders');
  const tab = (k, label, n) => `<button type="button" class="ptab" role="tab" aria-selected="${t === k}" data-a="tab" data-tab="${k}">${label}${n ? `<span class="ptab-n num">${n}</span>` : ''}</button>`;
  return `<header class="ptbar home tabs"><div class="ptabs" role="tablist" aria-label="Start"><span class="ptab-ind" aria-hidden="true"></span>${tab('inbox', 'Inbox', ni)}${tab('folders', 'Folders', nf)}</div><span class="ptb-sp"></span>
    <button type="button" class="ib weak" data-a="select" aria-label="Select">${ic('select')}</button><button type="button" class="ib weak" data-a="phone-menu" aria-label="More">${ic('more')}</button></header>`;
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
  if (ui.view === 'folders' || (ui.view === 'inbox' && ui.tab === 'folders' && !ui.selecting && !ui.q.trim())) return h + foldersScreen(true);
  const S = sections(true);
  if (!S.length && onlySubs()) return h + `<div class="pgrid solo">${addTileHTML('pt-add')}</div>`;
  if (!S.length) return h + (ui.q.trim() ? `<p class="pnores">No matches.</p>` : (canAddTo() ? emptyMerge('pempty merge') : `<div class="pempty">Nothing here yet.</div>`));
  return h + S.map(s => `<div class="pglbl"><span>${esc(s.label)}</span>${ui.q.trim() ? `<span class="num">${s.items.length}</span>` : ''}</div><div class="pgrid"${contAttr(s.container)}>${s.items.map(b => phoneTile(b, s.date(b))).join('')}${s === S[S.length - 1] && showAddTile() ? addTileHTML('pt-add') : ''}</div>`).join('');
}
export function phoneRecents() {
  if (ui.selecting || !data.has) return '';
  const head = ui.view === 'inbox' ? `<div class="phead"><h1 class="phead-t">Pinned</h1><button type="button" class="ib gear" data-view="settings" aria-label="Settings">${ic('gear')}</button></div>` : '';
  /* pinned first, marked with a pin, then the last ten opened that are not pinned */
  const P = pinned(), R = live().filter(b => b.opened_at && !b.pinned).sort((a, b) => b.opened_at - a.opened_at).slice(0, 10), all = [...P, ...R];
  if (!all.length) return head;
  return head + `<div class="pglbl prc-lbl"><span>Recent</span></div><nav class="precent" aria-label="Recent" data-dock>` + all.map(b => { const src = iconSrc(b), l = esc(b.letter || b.title.charAt(0));
    return `<a class="prc${b.pinned ? ' pinned' : ''}" href="${esc(b.url)}" target="_blank" rel="noopener" data-id="${b.id}" data-open="${b.id}" draggable="false" aria-label="${esc(b.title)}${b.pinned ? ', pinned' : ''}">
      <span class="prc-ic" data-l="${l}"${src ? ` style="--tile:${esc(b.tile || '#2a303b')}"` : ''}>${src ? `<img src="${esc(src)}" alt="" width="44" height="44" draggable="false">` : l}</span>${b.pinned ? `<span class="prc-pin" aria-hidden="true">${ic('pin')}</span>` : ''}
      <span class="prc-l">${esc(b.title)}</span></a>`; }).join('') + `</nav>`;
}
export function phoneBulk() { const n = ui.picked.size, dis = n ? '' : 'disabled';
  return `<div class="pbulk" role="toolbar" aria-label="Selection"><span class="n num">${n} <span>selected</span></span>` + (ui.view === 'trash'
    ? `<button type="button" class="bb" data-a="bulk-restore" ${dis}>${ic('restore')}Restore</button><button type="button" class="bb warn" data-a="bulk-purge" ${dis}>${ic('trash')}Delete</button>`
    : `<button type="button" class="bb" data-a="bulk-move" ${dis}>${ic('move')}Move</button><button type="button" class="bb warn" data-a="bulk-trash" ${dis}>${ic('trash')}Trash</button>`) + `</div>`; }
let phoneMainView = null;
export function renderPhoneMain() {
  const m = byId('pmain'), rows = '.fscroll, .precent', sx = [...m.querySelectorAll(rows)].map(e => e.scrollLeft);
  const oi = m.querySelector('.ptab-ind'), from = oi && oi.offsetWidth ? { x: oi.offsetLeft + (oi._x || 0), w: oi.offsetWidth } : null;
  const st = ui.view === 'settings';
  const tabbed = ui.view === 'inbox' && !ui.selecting;
  m.innerHTML = (st ? '' : phoneRecents()) + (st ? '' : backLink('pback')) + phoneTop() + `<div class="bd">${st || tabbed ? '' : folderSection(true)}${phoneBody()}</div>`;
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
  if (!from || reduce() || (from.x === x && from.w === w)) { set(x, w); return; }
  ind.style.transition = 'none'; set(from.x, from.w); void ind.offsetWidth;
  ind.style.transition = ''; set(x, w);
}
export function renderPhone() {
  renderPhoneMain();
  byId('papp').classList.toggle('selecting', ui.selecting);
  byId('psrow').hidden = ui.selecting || ui.view === 'settings';
  byId('pbulkwrap').innerHTML = ui.selecting ? phoneBulk() : '';
}
export function syncSearch() {
  const q = byId('q'); if (!q) return;
  if (document.activeElement !== q && q.value !== ui.q) q.value = ui.q;
}

/* ================= render ================= */
export function render() {
  if (document.body.dataset.page !== 'app') return;
  if (ui.renaming && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.rename) return; /* the rename field keeps its caret; it redraws when done */
  const mode = isPhone() ? 'phone' : 'desk';
  if (mode !== ui.mode) { ui.mode = mode; document.body.classList.toggle('phone', mode === 'phone'); document.body.classList.toggle('desk', mode === 'desk');
    closeMenu(); closePalette(); if (mode === 'phone') mountPhone(); else mountDesk(); }
  const ae = document.activeElement, tileEl = ae && ae.closest ? ae.closest('#app [data-id]') : null;
  const keep = tileEl ? { id: tileEl.dataset.id, a: ae.dataset.a, title: ae.matches('.t-title,.pt-in,.dk'), dock: !!ae.closest('[data-dock]') } : null;
  const cs = byId('content'), top = cs ? cs.scrollTop : 0;
  if (mode === 'phone') renderPhone(); else renderDesk();
  if (cs) cs.scrollTop = top;
  if (keep) { const scope = keep.dock ? '[data-dock] ' : '#app article';
    const t = document.querySelector(`${scope}[data-id="${keep.id}"]`);
    const el = t && (keep.title ? (t.matches('a') ? t : t.querySelector('.t-title,.pt-in')) : keep.a ? t.querySelector(`[data-a="${keep.a}"]`) : null);
    if (el) el.focus({ preventScroll: true }); }
}
export function renderList() { if (ui.mode === 'phone') renderPhoneMain(); else { deskBody(); const c = document.querySelector('.tb .cnt'); if (c && data.has) c.textContent = count(ui.view); } }

export const canAddTo = () => typeof ui.view === 'number' || ui.view === 'inbox';
/* the dashed "Add bookmark" entry closes every folder, Inbox and All; it is a button, so selection, drag, marquee and arrows, which work on articles, pass over it */
export const showAddTile = () => (typeof ui.view === 'number' || ui.view === 'inbox' || ui.view === 'all') && !ui.selecting && !ui.q.trim();
/* an empty folder: one dashed box, two ways in */
export const emptyMerge = cls => `<div class="${cls}"><span>Nothing here yet.</span><span class="em-acts">
  <button type="button" class="em-a" data-a="add-new">${ic('plus')}Add bookmark</button><button type="button" class="em-a" data-a="add-to">${ic('move')}Add existing</button></span></div>`;
export const addTileHTML = cls => `<button type="button" class="${cls}" data-a="add-new">${ic('plus')}<span>Add bookmark</span></button>`;
/* grid and list: cards morph into their rows with a view transition, or the body crossfades */
export function switchLayout(to) {
  const swap = () => { ui.layout = to; store.set('layout', to); render(); };
  if (reduce()) { swap(); return; }
  if (document.startViewTransition) {
    const H = innerHeight, seen = new Set();
    const name = (all, only) => all.forEach(el => { const r = el.getBoundingClientRect(), id = el.dataset.id;
      if (only ? only.has(id) : r.bottom > 0 && r.top < H) { el.style.viewTransitionName = 'b' + id; seen.add(id); } });
    name(document.querySelectorAll('#body article.tile[data-id]'));
    const keep = new Set(seen);
    const vt = document.startViewTransition(() => { swap(); name(document.querySelectorAll('#body article.tile[data-id]'), keep); });
    vt.finished.finally(() => document.querySelectorAll('#body article.tile[data-id]').forEach(el => { el.style.viewTransitionName = ''; }));
    return;
  }
  swap(); const b = byId('body'); if (b && b.animate) b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'cubic-bezier(.23,1,.32,1)' });
}


/* listeners on document and window, registered once by app.js */
export function installRender() {
  addEventListener('resize', () => setCw());
  addEventListener('resize', () => deskPlaceholder());
}
