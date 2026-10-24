/* Helpers shared by the app and the public share page: no state, no network. */

/* the icon set, inserted once at the top of <body> */
export const SPRITE = `<svg class="sprite" width="0" height="0" aria-hidden="true">
<symbol id="i-search" viewBox="0 0 20 20"><circle cx="8.75" cy="8.75" r="5.75"/><path d="m13 13 4 4"/></symbol>
<symbol id="i-all" viewBox="0 0 20 20"><path d="M6 3.75h8a1 1 0 0 1 1 1v11.5l-5-3.25-5 3.25V4.75a1 1 0 0 1 1-1Z"/></symbol>
<symbol id="i-inbox" viewBox="0 0 20 20"><path d="M3.5 11.25 5.4 5a1.5 1.5 0 0 1 1.44-1.06h6.32A1.5 1.5 0 0 1 14.6 5l1.9 6.25v3.25a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"/><path d="M3.5 11.25h3.75l1 1.75h3.5l1-1.75h3.75"/></symbol>
<symbol id="i-trash" viewBox="0 0 20 20"><path d="M4 5.75h12M8 5.75V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.25M5.5 5.75l.7 9.6a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-9.6M8.5 9v4.5M11.5 9v4.5"/></symbol>
<symbol id="i-import" viewBox="0 0 20 20"><path d="M10 3v9.25M6.75 9 10 12.25 13.25 9M4 13.5v1.75A1.75 1.75 0 0 0 5.75 17h8.5A1.75 1.75 0 0 0 16 15.25V13.5"/></symbol>
<symbol id="i-export" viewBox="0 0 20 20"><path d="M10 12.25V3M6.75 6.25 10 3l3.25 3.25M4 13.5v1.75A1.75 1.75 0 0 0 5.75 17h8.5A1.75 1.75 0 0 0 16 15.25V13.5"/></symbol>
<symbol id="i-grid" viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="5.25" height="5.25" rx="1.25"/><rect x="11.25" y="3.5" width="5.25" height="5.25" rx="1.25"/><rect x="3.5" y="11.25" width="5.25" height="5.25" rx="1.25"/><rect x="11.25" y="11.25" width="5.25" height="5.25" rx="1.25"/></symbol>
<symbol id="i-list" viewBox="0 0 20 20"><path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9"/><circle cx="4" cy="5.5" r=".6"/><circle cx="4" cy="10" r=".6"/><circle cx="4" cy="14.5" r=".6"/></symbol>
<symbol id="i-sort" viewBox="0 0 20 20"><path d="M6.5 4v12M3.75 13.25 6.5 16l2.75-2.75M13.5 16V4M10.75 6.75 13.5 4l2.75 2.75"/></symbol>
<symbol id="i-select" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.75"/><path d="m7.25 10.1 1.9 1.9 3.6-3.75"/></symbol>
<symbol id="i-plus" viewBox="0 0 20 20"><path d="M10 4.5v11M4.5 10h11"/></symbol>
<symbol id="i-share" viewBox="0 0 20 20"><path d="M10 12.25V3.5M6.75 6.5 10 3.25l3.25 3.25M6.5 9.25h-.75A1.75 1.75 0 0 0 4 11v4.25A1.75 1.75 0 0 0 5.75 17h8.5A1.75 1.75 0 0 0 16 15.25V11a1.75 1.75 0 0 0-1.75-1.75h-.75"/></symbol>
<symbol id="i-open" viewBox="0 0 20 20"><path d="M11.5 3.75h4.75V8.5M16 4 9.25 10.75M14 11.75v2.5A1.75 1.75 0 0 1 12.25 16h-6.5A1.75 1.75 0 0 1 4 14.25v-6.5A1.75 1.75 0 0 1 5.75 6h2.5"/></symbol>
<symbol id="i-bulb" viewBox="0 0 16 22"><path style="fill:var(--bulb-glass,none);stroke:var(--bulb-rim,currentColor)" d="M8 1.2a6.3 6.3 0 0 0-3.7 11.4c.7.5 1.1 1.3 1.1 2.2v.9h5.2v-.9c0-.9.4-1.7 1.1-2.2A6.3 6.3 0 0 0 8 1.2Z"/><path style="stroke:var(--bulb-fil,currentColor)" d="M6 10c.7-1.5 1.3-1.5 2 0s1.3 1.5 2 0"/><path d="M5.6 18h4.8M6.4 20.4h3.2"/></symbol><symbol id="i-gear" viewBox="0 0 20 20"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.55 1.55M13.75 13.75l1.55 1.55M4.7 15.3l1.55-1.55M13.75 6.25l1.55-1.55"/><circle cx="10" cy="10" r="5.6"/></symbol>
<symbol id="i-more" viewBox="0 0 20 20"><circle cx="5" cy="10" r=".9"/><circle cx="10" cy="10" r=".9"/><circle cx="15" cy="10" r=".9"/></symbol>
<symbol id="i-restore" viewBox="0 0 20 20"><path d="M4.25 8.5A6 6 0 1 1 5 13.4"/><path d="M4 4.5v4h4"/></symbol>
<symbol id="i-check" viewBox="0 0 20 20"><path d="m5.5 10.25 3 3 6-6.5"/></symbol>
<symbol id="i-clock" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.75"/><path d="M10 6.5V10l2.5 1.5"/></symbol>
<symbol id="i-warn" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.75"/><path d="M10 6.5v4.25M10 13.4v.1"/></symbol>
<symbol id="i-pin" viewBox="0 0 20 20"><path d="M12.25 3.5 16.5 7.75l-2.5 1-3 3 .25 3-1.5 1.5-6-6 1.5-1.5 3 .25 3-3ZM6.75 13.25 3.5 16.5"/></symbol>
<symbol id="i-move" viewBox="0 0 20 20"><path d="M3.5 6.25A1.75 1.75 0 0 1 5.25 4.5h2.6l1.5 1.75h5.4a1.75 1.75 0 0 1 1.75 1.75v6.75a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 3.5 14.75Z"/><path d="M8 11h4.5M10.75 9.25 12.5 11l-1.75 1.75"/></symbol>
<symbol id="i-folder" viewBox="0 0 20 20"><path d="M3.5 6.25A1.75 1.75 0 0 1 5.25 4.5h2.6l1.5 1.75h5.4a1.75 1.75 0 0 1 1.75 1.75v6.75a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 3.5 14.75Z"/></symbol><symbol id="i-folder-plus" viewBox="0 0 20 20"><path d="M3.5 6.25A1.75 1.75 0 0 1 5.25 4.5h2.6l1.5 1.75h5.4a1.75 1.75 0 0 1 1.75 1.75v6.75a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 3.5 14.75Z"/><path d="M10 8.75v4.5M7.75 11h4.5"/></symbol>
<symbol id="i-edit" viewBox="0 0 20 20"><path d="M12.6 4.4a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3L8 15H5v-3Z"/><path d="m11.25 5.75 3 3"/></symbol>
<symbol id="i-up" viewBox="0 0 20 20"><path d="M10 15.5v-11M5.75 8.75 10 4.5l4.25 4.25"/></symbol>
<symbol id="i-down" viewBox="0 0 20 20"><path d="M10 4.5v11M5.75 11.25 10 15.5l4.25-4.25"/></symbol>
<symbol id="i-logout" viewBox="0 0 20 20"><path d="M8 4H5.75A1.75 1.75 0 0 0 4 5.75v8.5A1.75 1.75 0 0 0 5.75 16H8M12.5 6.5 16 10l-3.5 3.5M16 10H8"/></symbol>
<symbol id="i-back" viewBox="0 0 20 20"><path d="M12.5 4.25 6.75 10l5.75 5.75"/></symbol>
<symbol id="i-chev" viewBox="0 0 20 20"><path d="m8 5 5 5-5 5"/></symbol>
<symbol id="i-close" viewBox="0 0 20 20"><path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/></symbol>
<symbol id="i-lock" viewBox="0 0 20 20"><rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.75a3 3 0 0 1 6 0V9"/></symbol>
<symbol id="i-key" viewBox="0 0 20 20"><circle cx="7" cy="13" r="3.25"/><path d="m9.4 10.6 6.35-6.35M13.5 6.5l2 2M11.75 8.25l1.5 1.5"/></symbol>
<symbol id="i-link" viewBox="0 0 20 20"><path d="M8.6 11.4a3 3 0 0 0 4.24 0l2.4-2.4a3 3 0 0 0-4.24-4.24l-.85.85"/><path d="M11.4 8.6a3 3 0 0 0-4.24 0l-2.4 2.4a3 3 0 0 0 4.24 4.24l.85-.85"/></symbol>
</svg>`;

export const byId = id => document.getElementById(id);
/* the selection bar keeps its node while the selection runs: a tick only changes the count and what is disabled, and it fades out before it is emptied */
export function setBar(w, html) {
  clearTimeout(w._t);
  if (!html) { if (w.firstChild) w._t = setTimeout(() => { w.textContent = ''; }, 320); return; }
  const cur = w.firstElementChild; if (cur) {
    const nx = Object.assign(document.createElement('template'), { innerHTML: html }).content.firstElementChild, acts = e => [...e.querySelectorAll('[data-a]')].map(a => a.dataset.a).join();
    if (acts(cur) === acts(nx)) { cur.querySelector('.n').innerHTML = nx.querySelector('.n').innerHTML; const nb = nx.querySelectorAll('button'); cur.querySelectorAll('button').forEach((b, i) => { b.disabled = nb[i].disabled; }); return; } }
  w.innerHTML = html;
}
export const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const ic = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const PHONE_MQ = matchMedia('(max-width: 719px)');
export const isPhone = () => PHONE_MQ.matches;
/* a finger, not a mouse: no key hints */
export const COARSE = matchMedia('(pointer: coarse)');
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const wait = ms => new Promise(r => setTimeout(r, ms));
/* per browser preferences: sort and layout */
export const store = {
  get(k, d) { try { const v = localStorage.getItem('pinned.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('pinned.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
};
export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/* the message of a failed API call, as a sentence */
export const errorText = (e, fallback) => e && e.data && e.data.error ? cap(e.data.error) + (/[.!?]$/.test(e.data.error) ? '' : '.') : fallback;
export function hostFromUrl(u) { try { return new URL(u).host; } catch (e) { return u; } }
export const validUrl = u => { try { const x = new URL(u); return (x.protocol === 'http:' || x.protocol === 'https:') && !!x.hostname; } catch (e) { return false; } };

/* search hits: the matching text gets a quiet accent background */
export function highlight(s, query) { const q = String(query == null ? '' : query).trim(); s = String(s == null ? '' : s); if (!q) return esc(s);
  const low = s.toLowerCase(), k = q.toLowerCase(); let out = '', i = 0, j;
  while ((j = low.indexOf(k, i)) !== -1) { out += esc(s.slice(i, j)) + '<mark class="hit">' + esc(s.slice(j, j + k.length)) + '</mark>'; i = j + k.length; }
  return out + esc(s.slice(i)); }
/* one line, cut at the start so the port always shows: rtl box, ltr isolate inside. inner is HTML. */
export const truncStart = (inner, cls = '') => `<span class="trunc-start${cls ? ' ' + cls : ''}"><bdi dir="ltr">${inner}</bdi></span>`;

/* dates */
/* one way to write a day on every device and in every locale: 4 Oct, and 4 Oct 2025 for an earlier year */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayDiff = ts => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(ts * 1000); b.setHours(0, 0, 0, 0); return Math.round((a - b) / 864e5); };
export const fmtDay = ts => { const d = new Date(ts * 1000); return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear()}`; };
export const fmtDate = ts => { if (!ts) return ''; const n = dayDiff(ts); if (n === 0) return 'Today'; if (n === 1) return 'Yesterday'; return fmtDay(ts); };
export const groupName = ts => { const n = dayDiff(ts); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n < 7 ? 'This week' : 'Earlier'; };
export const isoDate = ts => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ } ta.remove(); return ok; }
}

/* a favicon that fails to load falls back to the letter on the dark tile */
export function installIconFallback() {
  document.addEventListener('error', e => { const t = e.target; if (t.tagName === 'IMG' && t.parentElement && t.parentElement.dataset.l != null) {
    const p = t.parentElement; p.style.setProperty('--tile', 'var(--tile-blank)'); p.textContent = p.dataset.l; } }, true);
}
