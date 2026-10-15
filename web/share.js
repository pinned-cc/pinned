/* The public, read only page for a shared folder. No session, no links into the app. */
import { byId, esc, fmtDate, highlight, ic, installIconFallback, PHONE_MQ, SPRITE, truncStart } from './js/util.js';

const HUES = ['cyan', 'coral', 'lilac', 'lime', 'mint', 'rose'];
const base = '/s/' + location.pathname.split('/')[2];
let shared = null, query = '', VIEW = 'all';

const hl = s => highlight(s, query);
const hostLine = (h, cls = '') => truncStart(hl(h), cls);
const fav = (b, size) => { const l = esc(b.letter || (b.title || '?').charAt(0).toUpperCase());
  return `<span class="fav" data-l="${l}"${b.icon ? ` style="--tile:${esc(b.tile || '#2a303b')}"` : ''}>${b.icon ? `<img src="${esc(b.icon)}" alt="" width="${size}" height="${size}" loading="lazy" draggable="false">` : l}</span>`; };

/* folders inside the shared one: the root has no id in the response, its children point at it */
const folders = () => shared.folders || [];
const known = () => new Set(folders().map(f => f.id));
const rootId = () => { const k = known(); const f = folders().find(x => !k.has(x.parent_id)); return f ? f.parent_id : (shared.bookmarks.find(b => !k.has(b.folder_id)) || {}).folder_id; };
const tops = () => { const r = rootId(); return folders().filter(f => f.parent_id === r).sort((a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name)); };
const under = id => { const s = new Set([id]), st = [id]; while (st.length) { const x = st.pop(); for (const f of folders()) if (f.parent_id === x && !s.has(f.id)) { s.add(f.id); st.push(f.id); } } return s; };
const nameOf = id => (folders().find(f => f.id === id) || {}).name || '';
const hueOf = id => { const t = tops(); let f = folders().find(x => x.id === id), g = 0; while (f && f.parent_id !== rootId() && g++ < 32) f = folders().find(x => x.id === f.parent_id);
  const i = f ? t.findIndex(x => x.id === f.id) : -1; return i < 0 ? 'plain' : HUES[i % 6]; };
function list() {
  let L = shared.bookmarks.slice();
  if (VIEW !== 'all') { const s = under(VIEW); L = L.filter(b => s.has(b.folder_id)); }
  const q = query.trim().toLowerCase(); if (q) L = L.filter(b => (b.title + ' ' + b.url + ' ' + (b.host || '')).toLowerCase().includes(q));
  return L.sort((a, b) => (b.created_at || 0) - (a.created_at || 0) || a.title.localeCompare(b.title));
}
const deskTile = b => `<article class="tile"><div class="t-main">${fav(b, 40)}<a class="t-title" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${hl(b.title)}</a>
  <p class="t-host">${hostLine(b.host || b.url)}</p></div><div class="t-strip hue-${hueOf(b.folder_id)}"><span class="dot"></span><span class="path">${esc(nameOf(b.folder_id) || shared.folder.name)}</span><time>${fmtDate(b.created_at)}</time></div></article>`;
const phoneTile = b => `<article class="pt"><a class="pt-in" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(b.title)}, ${esc(b.host || b.url)}">
  <span class="pt-main">${fav(b, 36)}<span class="pt-title">${hl(b.title)}</span>${hostLine(b.host || b.url, 'host')}</span>
  <span class="pt-strip hue-${hueOf(b.folder_id)}"><span class="dot"></span><time>${fmtDate(b.created_at)}</time></span></a></article>`;
const chips = () => { const t = tops(); if (!t.length) return '';
  const mini = (id, name, h) => `<button type="button" class="fmini hue-${h}${VIEW === id ? ' fill' : ''}" data-sv="${id}" aria-pressed="${VIEW === id}"><span class="v"><span class="nm">${ic(id === 'all' ? 'all' : 'folder', 'fi')}<span class="nt">${esc(name)}</span></span></span></button>`;
  return `<div class="prow-x frow share-chips" role="group" aria-label="Folders">${mini('all', 'All', 'ink-h')}${t.map(f => mini(f.id, f.name, hueOf(f.id))).join('')}</div>`; };
function body() {
  const L = list(), phone = PHONE_MQ.matches;
  if (!L.length) return query.trim() ? `<p class="${phone ? 'pnores' : 'nores'}">No matches.</p>` : `<div class="${phone ? 'pempty' : 'empty'}">Nothing here yet.</div>`;
  return phone ? `<div class="pgrid">${L.map(phoneTile).join('')}</div>` : `<div class="grid">${L.map(deskTile).join('')}</div>`;
}
function render() {
  const phone = PHONE_MQ.matches, n = shared.bookmarks.length;
  document.title = shared.folder.name; byId('share-h1').textContent = shared.folder.name;
  const field = `<label class="${phone ? 'ps' : 'search'}" for="sq">${ic('search')}<span class="vh">Search</span><input id="sq" type="search" placeholder="Search ${esc(shared.folder.name)}" autocomplete="off" spellcheck="false" enterkeyhint="search" value="${esc(query)}"></label>`;
  byId('share').innerHTML = phone
    ? `<div class="share-phone"><header class="ptbar home"><h2 class="ptb-t">${esc(shared.folder.name)}</h2><span class="ptb-c">${n}</span></header>${chips() ? `<div class="share-chipwrap">${chips()}</div>` : ''}<div class="bd" id="sbody">${body()}</div></div>
       <div class="pbottom share-bottom"><div class="psrow">${field}</div></div>`
    : `<div class="share-col"><header class="share-head"><h2>${esc(shared.folder.name)}</h2><span class="cnt">${n}</span><span class="sp"></span>${field}</header>${chips()}<div class="body" id="sbody">${body()}</div></div>`;
}
function locked(name) {
  byId('share').innerHTML = `<main class="lone share-lock"><div class="lone-box"><span class="lock-ic">${ic('lock')}</span><h2>${esc(name || 'Shared folder')}</h2>
    <form id="unlock"><label class="fld first"><span class="sh-lbl">Password</span><input class="fld-in" type="password" name="password" autocomplete="current-password" required autofocus enterkeyhint="go"></label>
    <p class="fld-err" id="uerr" role="alert"></p><button type="submit" class="save">Open</button></form></div></main>`;
  const f = byId('unlock');
  f.addEventListener('submit', async e => { e.preventDefault(); const btn = f.querySelector('button'); btn.disabled = true;
    const r = await fetch(base + '/unlock', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ password: f.elements.password.value }) }).catch(() => null);
    if (r && r.status === 204) { load(); return; }
    btn.disabled = false; byId('uerr').textContent = r && r.status === 429 ? 'Wait 30 seconds and try again.' : 'Wrong password.'; f.elements.password.select(); });
}
async function load() {
  const r = await fetch(base + '/data', { credentials: 'same-origin' }).catch(() => null);
  if (r && r.status === 401) { const j = await r.json().catch(() => ({})); const name = j && j.folder && j.folder.name; if (name) { document.title = name; byId('share-h1').textContent = name; } locked(name); return; }
  if (!r || !r.ok) { byId('share').innerHTML = `<main class="lone"><div class="lone-box"><h2>This link does not work.</h2></div></main>`; return; }
  shared = await r.json(); shared.folders = shared.folders || []; shared.bookmarks = shared.bookmarks || []; render();
}
document.addEventListener('input', e => { if (e.target.id === 'sq') { query = e.target.value; byId('sbody').innerHTML = body(); } });
document.addEventListener('click', e => { const c = e.target.closest('[data-sv]'); if (!c) return; const v = c.dataset.sv; VIEW = v === 'all' ? 'all' : +v; render(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.id === 'sq') { query = ''; e.target.value = ''; byId('sbody').innerHTML = body(); }
  if (e.key === '/' && e.target.tagName !== 'INPUT' && byId('sq')) { e.preventDefault(); byId('sq').focus(); } });
{ const on = () => shared && render(); if (PHONE_MQ.addEventListener) PHONE_MQ.addEventListener('change', on); else PHONE_MQ.addListener(on); }
installIconFallback();
document.body.insertAdjacentHTML('afterbegin', SPRITE);
load();
