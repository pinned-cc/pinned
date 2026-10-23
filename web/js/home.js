/* The Dashboard, the start page: the links opened last, grouped by when they were opened (Today, Yesterday,
   Last 7 days, Last 30 days, Earlier). Everything here is a recently opened link, never a folder as an object;
   the folder only says where a link is from. It follows the toolbar's grid or list layout. Only opened links
   count, folders hidden from Recent and locked folders stay out; until one is opened it shows the links saved last. */
import { favHTML, hostLine, layoutSwitch, selIb } from './render.js';
import { fid, folderById, galSaved, galShown, hostOf, hueClass, live, ui } from './state.js';
import { dayDiff, esc, fmtDay, ic } from './util.js';


/* the time groups, by calendar day; an empty group never shows */
const BANDS = [{ name: 'Today', max: 0 }, { name: 'Yesterday', max: 1 }, { name: 'Last 7 days', max: 6 }, { name: 'Last 30 days', max: 29 }, { name: 'Earlier', max: Infinity }];
const bandOf = ts => { const n = dayDiff(ts); return BANDS.findIndex(x => n <= x.max); };

/* the time beside an item says what its group does not: 12m ago today, the clock yesterday, the weekday this week, then the day */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const ago = ts => { const s = Math.max(0, Date.now() / 1000 - ts), n = dayDiff(ts), d = new Date(ts * 1000);
  if (n <= 0) return s < 60 ? 'Just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : Math.floor(s / 3600) + 'h ago';
  if (n === 1) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (n < 7) return WEEKDAYS[d.getDay()];
  return fmtDay(ts); };
const when = ts => `<time datetime="${new Date(ts * 1000).toISOString()}">${esc(ago(ts))}</time>`;
const linkAttrs = b => `href="${esc(b.url)}" target="_blank" rel="noopener" data-open="${b.id}" draggable="false"`;
const folderName = b => b.folder_id == null ? 'Inbox' : (folderById.get(b.folder_id) || { name: '' }).name;
/* the gallery's time: when a link was opened, or when it was saved while nothing has been opened yet */
let at = 'opened_at';
const label = b => `${esc(b.title)}, ${esc(hostOf(b))}, in ${esc(folderName(b))}, ${at === 'opened_at' ? 'opened' : 'saved'} ${esc(ago(b[at]))}`;
/* where a link is from: a small chip in the folder's hue */
const chip = b => `<span class="gc-chip ${hueClass(fid(b))}"><span class="dot"></span><span class="gc-cn">${esc(folderName(b))}</span></span>`;

/* calm empty states, centred in the space below the title: a fresh install, an empty Inbox, a Dashboard with nothing opened yet;
   a fresh install points to How to save, which on the desktop otherwise sits under the sidebar's More */
const calm = (phone, inner) => `<div class="calm${phone ? ' p' : ''}"><div class="calm-in">${inner}</div></div>`;
export const freshHTML = phone => calm(phone, `<p class="calm-h">Nothing here yet</p><span class="calm-a"><button type="button" class="em-a" data-a="add-new">${ic('plus')}Add bookmark</button><button type="button" class="em-a" data-a="import">${ic('import')}Import</button></span><p class="calm-t calm-tip">To save from your browser or phone, see <a href="/bookmarklet">How to save</a>.</p>`);
/* the All sorted picture: three bookmark cards squared up in a tidy pile, the top one checked; the first time it
   shows in a session the cards settle from a slight fan (CSS, only when motion is allowed) */
let settleAt = null; /* when the settle began; a redraw inside the 400 ms carries on from where it was */
const pile = () => {
  if (settleAt == null) { let seen = false; try { seen = !!sessionStorage.getItem('pinned.pile'); sessionStorage.setItem('pinned.pile', '1'); } catch (e) { /* no storage, settle once per load */ }
    settleAt = seen ? 0 : Date.now(); }
  const t = settleAt ? Date.now() - settleAt : 400, on = t < 400;
  const card = n => `<span class="pc pc${n}"><span class="pc-f"></span><span class="pc-l"></span><span class="pc-l s"></span></span>`;
  return `<div class="pile${on ? ' settle' : ''}"${on ? ` style="--pd:-${t}ms"` : ''} aria-hidden="true">${card(3)}${card(2)}${card(1)}<span class="pc-ok">${ic('check')}</span></div>`; };
/* nothing in the Inbox or no bookmarks at all: Select, Sort and the layout switch have nothing to act on */
export const inboxIdle = () => ui.view === 'inbox' && !live().some(b => fid(b) == null);
export const sortedHTML = phone => live().length ? calm(phone, `${pile()}<p class="calm-h">All sorted</p><p class="calm-t">Nothing waiting in the Inbox.</p><span class="calm-a"><button type="button" class="em-a" data-a="add-new">${ic('plus')}Add bookmark</button></span>`) : freshHTML(phone);

/* the items, in the toolbar's layout: grid shows icon led cards, list shows rows. Each is an article like every card,
   so hold, drag, Shift and Cmd clicks, the marquee and the right click menu work on it; while selecting its link is a
   checkbox with the round tick */
export const galShell = (b, html) => ui.selecting
  ? `<button type="button" class="g-in" data-a="pick" role="checkbox" aria-checked="${ui.picked.has(b.id)}" aria-label="Select ${esc(b.title)}">${html}<span class="chk" aria-hidden="true">${ic('check')}</span></button>`
  : `<a class="g-in" ${linkAttrs(b)} aria-label="${label(b)}">${html}</a>`;
const item = (cls, b, html) => `<article class="${cls}${ui.picked.has(b.id) ? ' picked' : ''}" data-id="${b.id}">${galShell(b, html)}</article>`;
const card = b => item('gk', b, `${favHTML(b, 56)}<span class="gk-time">${when(b[at])}</span>
  <span class="gk-title">${esc(b.title)}</span>${hostLine(hostOf(b), 'gk-host')}
  <span class="gk-foot">${chip(b)}</span>`);
const row = b => item('gc-row', b, `${favHTML(b, 28)}<span class="gc-tt"><span class="gc-t">${esc(b.title)}</span>${hostLine(hostOf(b), 'gc-host')}</span>
    ${chip(b)}<span class="gc-time">${when(b[at])}</span>`);
/* rows in two columns from 1100 px: the first half on the left, the rest on the right, both starting on one line */
const rows = L => { const h = Math.ceil(L.length / 2); return `<div class="gl"><div class="gl-col">${L.slice(0, h).map(row).join('')}</div><div class="gl-col">${L.slice(h).map(row).join('')}</div></div>`; };

export function galleryHTML(phone) {
  if (!live().length) return freshHTML(phone);
  const L = galShown(); at = galSaved() ? 'created_at' : 'opened_at';
  if (!L.length) return calm(phone, `<p class="calm-h">Nothing opened yet</p><p class="calm-t">Links you open show up here, by day.</p>`);
  const list = ui.layout === 'list', groups = BANDS.map(() => []);
  for (const b of L) groups[bandOf(b[at])].push(b);
  /* on the phone the Recently opened row carries Select and the layout, as the Inbox's view row does */
  const h2 = `<h2 class="gal-h">Recently ${at === 'opened_at' ? 'opened' : 'saved'}</h2>`;
  const head = phone ? `<div class="gal-hr">${h2}<span class="ptb-sp"></span>${selIb()}${layoutSwitch(' p')}</div>` : h2;
  return `<div class="gal${list ? ' is-list' : ''}${phone ? ' gal-p' : ''}">${head}${groups.map((items, i) => items.length ? `<section class="gs" aria-labelledby="gs-${i}">
    <h3 class="gs-h" id="gs-${i}">${BANDS[i].name}<span class="gs-n num" aria-hidden="true">${items.length}</span></h3>
    ${list ? rows(items) : `<div class="gb">${items.map(card).join('')}</div>`}</section>` : '').join('')}</div>`;
}
