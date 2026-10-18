/* The sheet layer (a bottom sheet on the phone, a dialog on desktop) and every sheet: rows, move, rename,
   confirm, lock dialogs, share, API tokens, add to folder, save. A swipe down closes a phone sheet. */
import { actions, goView } from './actions.js';
import { api } from './api.js';
import { closeMenu, tileMenu } from './menu.js';
import { favHTML, fmini, hl, hostLine, miniPicker, nfForm, nfMini } from './render.js';
import { bm, chain, data, descSet, fid, folderById, hostOf, hueClass, kids, layers, live, load, nowS, pathOf, pickable, run, ui } from './state.js';
import { announce, toast } from './toast.js';
import { byId, copy, dayDiff, errorText, esc, fmtDate, fmtDay, hostFromUrl, ic, isPhone, plural, reduce, validUrl, wait } from './util.js';

/* ================= sheets ================= */
let lastFocus = null;
export const layer = () => byId('layer'), sheetEl = () => byId('sheet');
export function openSheet(s, instant) {
  closeMenu(); const L = layer(), el = sheetEl(), was = !!layers.sheet; layers.sheet = s;
  if (!was) lastFocus = document.activeElement;
  fillSheet();
  if (!was) { if (instant || reduce()) { L.classList.add('noanim'); L.classList.add('open'); requestAnimationFrame(() => requestAnimationFrame(() => L.classList.remove('noanim'))); }
    else { void el.offsetHeight; L.classList.add('open'); } }
  const f = el.querySelector('[data-autofocus]') || (s.type === 'save' || s.type === 'done' || (s.type === 'addto' && isPhone()) ? el : el.querySelector('.sh-row:not([disabled]), input, .pp, button'));
  if (f) f.focus({ preventScroll: true });
}
export function closeSheet() {
  if (!layers.sheet) return; if (document.body.dataset.page === 'save') { closeWindow(); return; }
  layers.sheet = null; const L = layer(), el = sheetEl(); L.classList.remove('open');
  const done = () => { if (layers.sheet) return; el.innerHTML = ''; L.classList.remove('dialog'); document.querySelectorAll('.pt.lift,.pt.press,.held').forEach(t => t.classList.remove('lift', 'press', 'held')); };
  if (reduce()) done(); else setTimeout(done, 300);
  if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true }); lastFocus = null;
}
export const grab = () => `<div class="grab" aria-hidden="true"></div>`;
export const bmHead = b => `<div class="sh-head">${favHTML(b)}<span class="tt"><span class="t">${esc(b.title)}</span>${hostLine(hostOf(b), 'host')}</span></div>`;
export const fHead = f => `<div class="sh-head ${hueClass(f.id)}">${ic('folder', 'fh-ic')}<span class="tt"><span class="t">${esc(f.name)}</span></span></div>`;
export const textHead = t => `<div class="sh-head"><span class="tt"><span class="t">${esc(t)}</span></span></div>`;
/* rows in groups split by '-' (an empty group never shows) */
const rowHTML = (r, i) => r.href ? `<a class="sh-row" href="${esc(r.href)}" target="_blank" rel="noopener" data-row="${i}">${r.icon ? ic(r.icon) : ''}${esc(r.label)}</a>`
  : `<button type="button" class="sh-row${r.warn ? ' warn' : ''}" data-row="${i}"${r.disabled ? ' disabled' : ''}${r.check != null ? ` role="menuitemradio" aria-checked="${!!r.check}"` : ''}>${r.icon ? ic(r.icon) : ''}${esc(r.label)}${r.check ? `<span class="ck">${ic('check')}</span>` : ''}</button>`;
export function rowsHTML(rows) { const groups = [[]];
  rows.forEach((r, i) => { if (r === '-') groups.push([]); else groups[groups.length - 1].push([r, i]); });
  return groups.filter(g => g.length).map(g => `<div class="sh-rows">${g.map(([r, i]) => rowHTML(r, i)).join('')}</div>`).join(''); }
export function renameSheet(b) { if (!b) return;
  openSheet({ type: 'name', head: b, title: 'Rename', label: 'Title', value: b.title, button: 'Save', submit: async v => { await api('PATCH', `/api/bookmarks/${b.id}`, { title: v }); await load(); } }); }
export function fillSheet() {
  const s = layers.sheet, el = sheetEl(); if (!s) return; let h = grab(), label = 'Actions';
  const hadFocus = el.contains(document.activeElement);
  if (s.type === 'acts') { const b = bm(s.id); if (!b) { closeSheet(); return; } s.rows = tileMenu(b); h += bmHead(b) + rowsHTML(s.rows); }
  else if (s.type === 'rows') { h += (s.head ? (typeof s.head === 'string' ? textHead(s.head) : s.head.url ? bmHead(s.head) : fHead(s.head)) : '') + rowsHTML(s.rows) + (s.foot ? `<p class="app-ver">${esc(s.foot)}</p>` : ''); label = typeof s.head === 'string' ? s.head : 'Actions'; }
  else if (s.type === 'move') { const one = s.ids.length === 1 ? bm(s.ids[0]) : null; label = 'Folder';
    const inbox = { id: 'inbox', name: 'Inbox', hue: 'tray' };
    const cur = one ? (fid(one) == null ? 'inbox' : one.folder_id) : null;
    h += (one ? bmHead(one) : textHead(`${s.ids.length} selected`)) + `<span class="sh-lbl">Folder</span>${miniPicker({ sel: cur,
      pre: fmini(inbox, { attr: 'dest', current: cur === 'inbox', fill: cur === 'inbox', noCount: true }), post: s.nf ? nfForm() : nfMini() })}`; }
  else if (s.type === 'fmove') { const f = folderById.get(s.id); if (!f) { closeSheet(); return; } label = 'Move to';
    const topP = { id: 'top', name: 'Top level', hue: 'plain' };
    h += fHead(f) + `<span class="sh-lbl">Move to</span>${miniPicker({ sel: f.parent_id, exclude: descSet(f.id), pre: fmini(topP, { attr: 'dest', current: f.parent_id == null, fill: f.parent_id == null, noCount: true }) })}`; }
  else if (s.type === 'name') { label = s.title;
    h += (s.head ? bmHead(s.head) : textHead(s.title)) + `<form data-name><label class="fld first"><span class="sh-lbl">${esc(s.label)}</span>
      <input class="fld-in" name="v" value="${esc(s.value)}" autocomplete="off" spellcheck="false" enterkeyhint="done" data-autofocus></label>
      ${s.err ? `<p class="fld-err" role="alert">${esc(s.err)}</p>` : ''}<div class="sv-acts"><button type="submit" class="save">${esc(s.button)}</button></div></form>`; }
  else if (s.type === 'confirm') { label = s.title;
    h += textHead(s.title) + `<p class="sh-text">${esc(s.text)}</p><div class="sv-acts"><button type="button" class="tbtn" data-a="close">Cancel</button><button type="button" class="save danger" data-a="confirm">${esc(s.button)}</button></div>`; }
  else if (s.type === 'lock' || s.type === 'unlock' || s.type === 'unlockremove') { const f = folderById.get(s.fid); if (!f) { closeSheet(); return; } label = lockTitle(s, f); h += lockHTML(s, f); }
  else if (s.type === 'share') { const f = folderById.get(s.fid); if (!f) { closeSheet(); return; } label = 'Share ' + f.name; h += shareHTML(s, f); }
  else if (s.type === 'tokens') { label = 'API tokens'; h += tokensHTML(s); }
  else if (s.type === 'addto') { label = 'Add to ' + atName(s.fid); h += addToHTML(s); }
  else if (s.type === 'save') { label = 'Save'; h += saveHTML(); }
  else if (s.type === 'done') { label = 'Saved'; h = doneHTML(); }
  el.classList.toggle('tall', s.type === 'addto');
  layer().classList.toggle('dialog', s.type === 'lock' || s.type === 'unlock' || s.type === 'unlockremove'); /* password dialogs sit in the middle */
  el.setAttribute('aria-label', label);
  /* the sheet is the glass and never scrolls itself; its body scrolls when the content is taller */
  el.innerHTML = (s.type === 'addto' ? h : h.startsWith(grab()) ? grab() + `<div class="sh-body">${h.slice(grab().length)}</div>` : `<div class="sh-body">${h}</div>`) + (s.type === 'save' ? `<div class="sh-foot">${saveActs()}</div>` : '');
  if (s.type === 'addto') atAfterFill();
  if (hadFocus && !el.contains(document.activeElement)) el.focus({ preventScroll: true }); /* a redraw keeps focus inside the sheet */
  const ta = el.querySelector('textarea'); if (ta) fitTa(ta);
  if (s.type === 'name') { const i = el.querySelector('input'); const n = i.value.length; try { i.setSelectionRange(n, n); } catch (e) { /* ok */ } }
}
export const fitTa = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };

/* ---------- locking a folder ---------- */
export const lockTitle = (s, f) => s.type === 'lock' ? 'Lock ' + f.name : s.type === 'unlock' ? 'Unlock ' + f.name : 'Remove lock';
export function lockHTML(s, f) {
  const err = s.err ? `<p class="fld-err" role="alert">${esc(s.err)}</p>` : '', shake = s.shake ? ' shake' : '';
  const pw = (name, label, ac, focus) => `<label class="fld"><span class="sh-lbl">${label}</span><input class="fld-in${shake}" type="password" name="${name}" autocomplete="${ac}" enterkeyhint="go"${focus ? ' data-autofocus' : ''}></label>`;
  if (s.type === 'lock') return fHead(f) + `<form data-lock>${pw('pw', 'Password', 'new-password', true)}${pw('pw2', 'Repeat password', 'new-password')}
    <p class="sh-text">Links in this folder stay out of sight everywhere until you unlock it. The password cannot be recovered.</p>${f.share ? `<p class="sh-text">Locking ends the share link.</p>` : ''}
    ${err}<div class="sv-acts"><button type="submit" class="save">Lock</button></div></form>`;
  if (s.type === 'unlock') return fHead(f) + `<form data-lock>${pw('pw', 'Password', 'current-password', true)}${err}<div class="sv-acts"><button type="submit" class="save">Unlock</button></div></form>`;
  return fHead(f) + `<form data-lock><p class="sh-text">Enter the app password to take the lock off ${esc(f.name)}.</p>${pw('pw', 'App password', 'current-password', true)}${err}
    <div class="sv-acts"><button type="submit" class="save">Remove lock</button></div></form>`;
}
export const lockErr = e => e.status === 429 ? errorText(e, 'Try again in 30 seconds') : e.status === 403 ? 'Wrong password' : errorText(e, 'That did not work. Try again.');
export async function submitLock(f) {
  const s = layers.sheet, pw = f.elements.pw.value, btn = f.querySelector('button[type=submit]');
  const fail = (msg, shake) => { s.err = msg; s.shake = shake; fillSheet(); const i = sheetEl().querySelector('input[name=pw]'); if (i) i.focus(); s.shake = false; };
  if (s.type === 'lock') { if (pw.length < 4) { fail('Use at least 4 characters.'); return; } if (pw !== f.elements.pw2.value) { fail('The passwords do not match.'); return; } }
  else if (!pw) { f.elements.pw.focus(); return; }
  btn.disabled = true;
  try {
    if (s.type === 'lock') { await api('POST', `/api/folders/${s.fid}/lock`, { password: pw }); closeSheet();
      if (typeof ui.view === 'number' && chain(ui.view).some(x => x.id === s.fid)) ui.view = 'dashboard'; await load(); toast('Folder locked'); }
    else if (s.type === 'unlock') { await api('POST', `/api/folders/${s.fid}/unlock`, { password: pw }); closeSheet(); await load(); goView(s.to == null ? s.fid : s.to); announce('Folder unlocked'); }
    else { await api('DELETE', `/api/folders/${s.fid}/lock`, { app_password: pw }); closeSheet(); await load(); toast('Lock removed'); }
  } catch (e) { if (e.auth || layers.sheet !== s) return; fail(lockErr(e), e.status === 403); }
}

/* ---------- sharing a folder by link ---------- */
export const canNativeShare = () => !!navigator.share;
export function shareHTML(s, f) {
  const sh = f.share;
  let h = `<div class="at-head"><h2 class="at-title">Share ${esc(f.name)}</h2><button type="button" class="ib weak" data-a="close" aria-label="Close">${ic('close')}</button></div>
    <div class="sh-rows"><button type="button" class="sh-row sh-switch" role="switch" aria-checked="${!!sh}" data-a="share-toggle">${ic('link')}<span class="sw-l">Share with a link</span><span class="sw" aria-hidden="true"><span class="knob"></span></span></button></div>`;
  if (!sh) return h;
  const lockOn = sh.has_password || !!s.pwOn;
  const pwForm = `<form class="share-row" data-sharepw><input class="fld-in" type="password" name="pw" placeholder="${sh.has_password ? 'New password' : 'Password'}" autocomplete="new-password" aria-label="Password"><button type="submit" class="tbtn">Set</button>${s.pwEdit ? `<button type="button" class="tbtn" data-a="share-pw-cancel">Cancel</button>` : ''}</form>${s.pwErr ? `<p class="fld-err" role="alert">${esc(s.pwErr)}</p>` : ''}`;
  const pw = `<div class="sh-rows"><button type="button" class="sh-row sh-switch" role="switch" aria-checked="${lockOn}" data-a="share-lock">${ic('lock')}<span class="sw-l">Lock with a password</span><span class="sw" aria-hidden="true"><span class="knob"></span></span></button></div>`
    + (!lockOn ? '' : sh.has_password && !s.pwEdit
      ? `<div class="share-row share-locked"><span class="share-state">${ic('lock')}Locked</span><button type="button" class="tbtn" data-a="share-pw-change">Change</button><button type="button" class="tbtn warn" data-a="share-pw-remove">Remove</button></div>`
      : `<div class="share-pwf">${pwForm}</div>`);
  /* the saved state picks the option: Never, or 1, 7, 30 days when the time left matches within an hour */
  const left = sh.expires_at ? sh.expires_at - Date.now() / 1000 : null;
  const cur = left == null ? null : [1, 7, 30].find(n => Math.abs(left - n * 86400) < 3600);
  const exp = [[null, 'Never'], [1, '1 day'], [7, '7 days'], [30, '30 days']].map(([n, l]) => `<button type="button" role="radio" aria-checked="${cur === n}" data-a="share-exp" data-exp="${n == null ? 'never' : n}">${l}</button>`).join('');
  const last = sh.last_opened_at ? fmtDate(sh.last_opened_at) : '';
  const opened = sh.opens ? `Opened ${plural(sh.opens, 'time', 'times')}${last ? ', last ' + (/^(Today|Yesterday)$/.test(last) ? last.toLowerCase() : 'on ' + last) : ''}` : 'Not opened yet';
  return h + `<div class="share-sec"><span class="sh-lbl">Link</span><div class="share-link"><input class="fld-in" id="share-url" readonly value="${esc(sh.url)}" aria-label="Link">${canNativeShare() ? `<button type="button" class="tbtn share-primary" data-a="share-native">Share</button>` : ''}<button type="button" class="tbtn" data-a="share-copy">Copy</button></div></div>
    <div class="share-sec">${pw}</div>
    <div class="share-sec"><span class="sh-lbl" id="exp-l">Expires</span><div class="seg" role="radiogroup" aria-labelledby="exp-l">${exp}</div>${sh.expires_at ? `<p class="share-meta">Until ${fmtDay(sh.expires_at)}</p>` : ''}</div>
    <p class="share-meta share-opens">${opened}</p>`;
}
export async function shareToggle() {
  const f = folderById.get(layers.sheet.fid); if (!f) return; const id = f.id;
  if (!f.share) { const r = await run(api('POST', `/api/folders/${id}/share`, {})); if (r.ok && layers.sheet && layers.sheet.type === 'share') fillSheet(); if (r.ok) announce('Sharing on'); return; }
  const tok = f.share.token;
  openSheet({ type: 'confirm', title: 'Stop sharing?', text: 'People with the link lose access.', button: 'Stop sharing',
    run: async () => { await api('DELETE', `/api/shares/${tok}`); await load(); toast('Sharing stopped'); } });
}
export async function sharePatch(body) { const f = folderById.get(layers.sheet.fid); if (!f || !f.share) return; const r = await run(api('PATCH', `/api/shares/${f.share.token}`, body)); if (r.ok && layers.sheet && layers.sheet.type === 'share') fillSheet();
  if (r.ok && 'expires_days' in body) announce(body.expires_days == null ? 'The link does not expire' : `The link expires in ${plural(body.expires_days, 'day', 'days')}`); }
/* a share password: the server's refusal (too short) shows under the field, which stays open */
export async function sharePassword(form, password) {
  const s = layers.sheet, f = folderById.get(s.fid); if (!f || !f.share) return;
  const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
  try { await api('PATCH', `/api/shares/${f.share.token}`, { password }); s.pwEdit = false; s.pwOn = false; s.pwErr = null; await load(); if (layers.sheet === s) fillSheet(); announce('Password set'); }
  catch (e) { if (e.auth || layers.sheet !== s) return; s.pwErr = errorText(e, 'That did not work. Try again.'); fillSheet(); const i = sheetEl().querySelector('[data-sharepw] [name=pw]'); if (i) i.focus(); }
}
export async function shareCopy() { const f = folderById.get(layers.sheet.fid); if (!f || !f.share) return; if (await copy(f.share.url)) toast('Copied'); else toast('Could not copy the link.'); }
export async function shareNative() { const f = folderById.get(layers.sheet.fid); if (!f || !f.share) return;
  if (!navigator.share) { shareCopy(); return; } try { await navigator.share({ title: f.name, url: f.share.url }); } catch (e) { /* cancelled */ } }
export function shareLock() { const f = folderById.get(layers.sheet.fid); if (!f || !f.share) return;
  if (f.share.has_password) { shareUnlock(); return; }
  layers.sheet.pwOn = !layers.sheet.pwOn; layers.sheet.pwEdit = false; layers.sheet.pwErr = null; fillSheet(); const i = sheetEl().querySelector('[name=pw]'); if (i) i.focus(); }
export function shareUnlock() { const fid = layers.sheet.fid, f = folderById.get(fid); if (!f || !f.share) return; const tok = f.share.token;
  openSheet({ type: 'confirm', title: 'Remove the password?', text: 'Anyone with the link can open it.', button: 'Remove password',
    run: async () => { await api('PATCH', `/api/shares/${tok}`, { password: '' }); await load(); announce('Password removed'); setTimeout(() => openSheet({ type: 'share', fid }), reduce() ? 0 : 320); } }); }

/* ---------- API tokens: for the extension or a script ---------- */
export const ago = ts => { const d = Math.max(0, nowS() - ts);
  if (d < 60) return 'just now'; if (d < 3600) return plural(Math.floor(d / 60), 'minute', 'minutes') + ' ago';
  if (dayDiff(ts) === 0) return plural(Math.floor(d / 3600), 'hour', 'hours') + ' ago'; if (dayDiff(ts) === 1) return 'yesterday';
  return dayDiff(ts) < 30 ? dayDiff(ts) + ' days ago' : 'on ' + fmtDay(ts); };
export function openTokens() { openSheet({ type: 'tokens', list: null, created: null, confirm: null }); tokensLoad(); }
export async function tokensLoad() { const s = layers.sheet; try { const list = await api('GET', '/api/tokens'); if (layers.sheet !== s) return; s.list = list; s.err = null; }
  catch (e) { if (e.auth || layers.sheet !== s) return; s.err = 'Could not load the tokens.'; }
  /* the list arrives while the name may already be typed: the redraw keeps the name, its caret and its focus */
  const i = sheetEl().querySelector('form[data-token] [name=name]'), v = i ? i.value : '', on = i && document.activeElement === i;
  fillSheet(); const n = sheetEl().querySelector('form[data-token] [name=name]');
  if (n && v) n.value = v; if (n && on) { n.focus({ preventScroll: true }); try { n.setSelectionRange(v.length, v.length); } catch (e) { /* ok */ } } }
export function tokensHTML(s) {
  let h = `<div class="at-head"><h2 class="at-title">API tokens</h2><button type="button" class="ib weak" data-a="close" aria-label="Close">${ic('close')}</button></div>`;
  if (s.created) h += `<div class="tk-new"><span class="sh-lbl">${esc(s.created.name)}</span><div class="share-link"><div class="fld-in tk-val" tabindex="0" aria-label="Token">${esc(s.created.token)}</div><button type="button" class="tbtn" data-a="tk-copy">Copy</button></div>
    <p class="share-meta">Copy it now. It is not shown again.</p></div>`;
  else h += `<form class="tk-form" data-token><span class="sh-lbl">New token</span><div class="share-row"><input class="fld-in" name="name" placeholder="Extension on my laptop" autocomplete="off" spellcheck="false" enterkeyhint="done" aria-label="Token name"${isPhone() ? '' : ' data-autofocus'}><button type="submit" class="tbtn">Create</button></div>${s.formErr ? `<p class="fld-err" role="alert">${esc(s.formErr)}</p>` : ''}</form>`;
  if (s.err) return h + `<p class="share-meta tk-sec">${esc(s.err)}</p>`;
  if (!s.list) return h + `<div class="tk-sec" aria-busy="true"></div>`;
  if (!s.list.length) return h + `<p class="share-meta tk-sec">A token lets the extension or a script read your folders and save links. It cannot export, share, lock or delete anything.</p>`;
  return h + `<div class="tk-sec"><span class="sh-lbl">Tokens</span><div class="sh-rows tk-list">` + s.list.map(t => s.confirm === t.id
    ? `<div class="tk-row confirm"><span class="tk-tt"><span class="tk-n">Revoke ${esc(t.name)}?</span><span class="tk-m">Anything using it stops working.</span></span><span class="tk-acts"><button type="button" class="tbtn" data-a="tk-cancel">Cancel</button><button type="button" class="tbtn warn" data-a="tk-revoke-yes" data-id="${t.id}">Revoke</button></span></div>`
    : `<div class="tk-row"><span class="tk-tt"><span class="tk-n">${esc(t.name)}</span><span class="tk-m">Created ${fmtDay(t.created_at)}, ${t.last_used_at ? 'last used ' + ago(t.last_used_at) : 'never used'}</span></span><button type="button" class="tbtn warn" data-a="tk-revoke" data-id="${t.id}" aria-label="Revoke ${esc(t.name)}">Revoke</button></div>`).join('') + `</div></div>`;
}
export async function tokenCreate(f) {
  const s = layers.sheet, inp = f.elements.name, name = inp.value.trim(); if (!name) { inp.focus(); return; }
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
  try { const t = await api('POST', '/api/tokens', { name }); if (layers.sheet !== s) return; s.created = t; s.formErr = null; s.confirm = null; await tokensLoad(); const c = sheetEl().querySelector('[data-a="tk-copy"]'); if (c) c.focus({ preventScroll: true }); }
  catch (e) { if (e.auth || layers.sheet !== s) return; s.formErr = errorText(e, 'That did not work. Try again.'); fillSheet(); }
}
export async function tokenCopy() { if (!layers.sheet || !layers.sheet.created) return; if (await copy(layers.sheet.created.token)) toast('Copied'); else toast('Could not copy the token.'); }
export async function tokenRevoke(id) { const s = layers.sheet;
  try { await api('DELETE', `/api/tokens/${id}`); if (layers.sheet !== s) return; s.confirm = null; if (s.created && s.created.id === id) s.created = null; await tokensLoad(); toast('Token revoked'); }
  catch (e) { if (!e.auth) toast('That did not work. Try again.'); } }

/* ---------- "Add to <folder>": pick existing bookmarks into a folder ---------- */
export const atName = f => f == null ? 'Inbox' : (folderById.get(f) || { name: 'Folder' }).name;
export function openAddTo(f) { openSheet({ type: 'addto', fid: f == null ? null : f, picked: new Set(), q: '', cur: -1 }); }
export function atItems(s) {
  const q = s.q.trim().toLowerCase();
  let L = live().filter(b => fid(b) !== s.fid);
  if (q) L = L.filter(b => (b.title + ' ' + b.url + ' ' + hostOf(b)).toLowerCase().includes(q));
  const groups = new Map();
  for (const b of L) { const k = fid(b); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  return [...groups.entries()].sort(([a], [b]) => a == null ? -1 : b == null ? 1 : pathOf(a).localeCompare(pathOf(b)))
    .map(([k, items]) => ({ label: pathOf(k), items: items.sort((x, y) => x.title.localeCompare(y.title)) }));
}
export const atBtn = s => s.picked.size ? `Move ${s.picked.size} to ${atName(s.fid)}` : `Move to ${atName(s.fid)}`;
export function atListHTML(s) {
  const G = atItems(s); if (!G.length) return `<p class="at-none">${s.q.trim() ? 'No matches.' : 'Every bookmark is already here.'}</p>`;
  return G.map(g => `<div class="at-lbl">${esc(g.label)}</div>` + g.items.map(b => `<div class="at-row${s.picked.has(b.id) ? ' on' : ''}" role="option" aria-selected="${s.picked.has(b.id)}" tabindex="-1" data-bid="${b.id}">
      ${favHTML(b, 28)}<span class="at-tt"><span class="at-t">${hl(b.title, s.q)}</span>${hostLine(hostOf(b), 'at-h', true, s.q)}</span>
      <span class="at-chk" data-chk aria-hidden="true">${ic('check')}</span></div>`).join('')).join('');
}
export function addToHTML(s) {
  return `<div class="at-head"><h2 class="at-title">Add to ${esc(atName(s.fid))}</h2><button type="button" class="ib weak" data-a="close" aria-label="Close">${ic('close')}</button></div>
    <label class="ps at-search">${ic('search')}<span class="vh">Search</span><input id="atq" type="search" placeholder="Search bookmarks" autocomplete="off" spellcheck="false" value="${esc(s.q)}" data-autofocus></label>
    <div class="at-list" id="atlist" role="listbox" aria-multiselectable="true" aria-label="Bookmarks">${atListHTML(s)}</div>
    <div class="at-bar"><button type="button" class="save" data-a="at-move"${s.picked.size ? '' : ' disabled'}>${esc(atBtn(s))}</button></div>`;
}
export function atAfterFill() { const q = byId('atq'); if (q && isPhone()) q.removeAttribute('data-autofocus'); }
export function atRefreshList() { const l = byId('atlist'); if (!l) return; const top = l.scrollTop; l.innerHTML = atListHTML(layers.sheet); l.scrollTop = top; atSync(); }
export function atSync() { const s = layers.sheet, b = sheetEl().querySelector('[data-a="at-move"]'); if (!b) return; b.textContent = atBtn(s); b.disabled = !s.picked.size; }
export function atSet(row, on) { const id = +row.dataset.bid; if (on) layers.sheet.picked.add(id); else layers.sheet.picked.delete(id); row.classList.toggle('on', on); row.setAttribute('aria-selected', on); }
export async function atMove() {
  const s = layers.sheet; if (!s || !s.picked.size) return; const ids = [...s.picked], to = s.fid;
  const from = new Map(ids.map(id => [id, fid(bm(id))]));
  closeSheet(); const r = await actions.move(ids, to); if (!r || !r.ok) return;
  toast(`Moved ${ids.length} to ${atName(to)}`, { undo: async () => {
    const back = new Map(); for (const [id, f] of from) { const k = f == null ? 'inbox' : f; if (!back.has(k)) back.set(k, []); back.get(k).push(id); }
    for (const [k, list] of back) await api('POST', '/api/bookmarks/bulk', { ids: list, action: 'move', folder_id: k === 'inbox' ? null : k }).catch(() => {});
    load(); } });
}
export function atKey(e, t) {
  const rows = [...sheetEl().querySelectorAll('.at-row')], i = rows.indexOf(t.closest ? t.closest('.at-row') : null);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const j = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : i - 1;
    if (j < 0) byId('atq').focus(); else if (rows[j]) { rows[j].focus(); rows[j].scrollIntoView({ block: 'nearest' }); } return true; }
  if (e.key === ' ' && i >= 0) { e.preventDefault(); atSet(rows[i], !rows[i].classList.contains('on')); atSync(); return true; }
  if (e.key === 'Enter') { e.preventDefault(); atMove(); return true; }
  return false;
}
/* drag select like Mail: down on a check, move, and every row passed takes the first row's new state */
let atPaint = null;
/* phone sheets follow the finger: down 1:1, up a quarter; a quarter of the height or a quick flick closes,
   anything less springs back. A scrolled list inside starts the drag only from its top. */
let sheetDrag = null;
export const sheetScrim = () => document.querySelector('#layer .scrim');

/* ---------- save sheet (app Add, and the /save page) ---------- */
export function newSave(o = {}) {
  const ids = (data.settings.recent_folders || []).filter(pickable).slice(0, 3);
  let folder = o.folder !== undefined ? o.folder : pickable(data.settings.last_folder) ? data.settings.last_folder : (ids[0] == null ? null : ids[0]);
  const recent = folder != null && !ids.includes(folder) ? [folder, ...ids].slice(0, 3) : ids;
  return { title: o.title || '', url: o.url || '', folder, recent, picker: false, nf: false, dup: null, hid: false, icon: null, err: '', busy: false, ticked: false };
}
export function saveHTML() {
  const s = layers.save;
  let rec = s.recent.filter(pickable);
  if (!rec.length) rec = kids(null).filter(f => pickable(f.id)).slice(0, 3).map(f => f.id);
  const none = s.folder == null;
  return `<div class="sv-top"><span class="sv-fav">${svFav(s)}</span><button type="button" class="ib" data-a="close" aria-label="Close">${ic('close')}</button></div>
  <form data-save id="svf" novalidate>
  <label class="fld"><span class="sh-lbl">Title</span><input class="fld-in" data-f="title" value="${esc(s.title)}" autocomplete="off" enterkeyhint="next"></label>
  <label class="fld"><span class="sh-lbl">URL</span><textarea class="fld-in" data-f="url" rows="1" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" enterkeyhint="done">${esc(s.url)}</textarea></label>
  <p class="dupe${s.dup || s.hid ? '' : ' off'}" role="status">${ic('warn')}<span class="dupe-t">${dupeInner(s)}</span></p>
  ${s.err ? `<p class="fld-err" role="alert">${esc(s.err)}</p>` : ''}
  <div class="sv-folder" role="radiogroup" aria-labelledby="sv-fl"><span class="sh-lbl" id="sv-fl">Folder</span>
    ${rec.length ? `<div class="prow fpick">` : `<div class="prow fpick" hidden>`}${rec.map(id => fmini(folderById.get(id), { attr: 'pick', current: id === s.folder, radio: true, fill: id === s.folder, label: pathOf(id), noCount: true })).join('')}</div></div>
  <button type="button" class="tbtn sv-pick" data-a="choose" aria-expanded="${s.picker}">${none ? 'Choose a folder' : 'Choose another folder'}${ic('chev', 'chev')}</button>
  ${s.picker ? miniPicker({ sel: s.folder, post: s.nf ? nfForm() : nfMini() }) : ''}</form>`;
}
/* the save sheet's actions, in the sheet's foot outside the body that scrolls; Save submits the form by its id */
export function saveActs() { const s = layers.save;
  return `<div class="sv-acts">${s.folder == null ? '' : `<button type="button" class="tbtn" data-a="save-inbox">Save to Inbox</button>`}
    <button type="submit" form="svf" class="save" data-a="save-go"${s.ticked ? ' disabled aria-label="Saved"' : s.hid ? ' disabled' : ''}>${s.ticked ? ic('check') : primaryLabel(s)}</button></div>`; }
/* until the favicon is known the square is a quiet shimmering placeholder */
export const svFav = s => s.icon ? favHTML({ icon: s.icon.icon, tile: s.icon.tile, letter: '' }, 48) : `<span class="fav sv-ph${s.checking ? ' busy' : ''}" aria-hidden="true"><span class="ph-in"></span></span>`;
export const dupeInner = s => s.hid ? `<span class="d1">Already saved</span>` : s.dup
  ? `<span class="d1"><span class="d0">Already saved in&nbsp;</span>${hostLine(pathOf(fid(s.dup)))}<span class="d0">.</span></span><span class="d2">Save anyway moves it here.</span>`
  : `<span class="d1">Not saved yet</span>`;
export const primaryLabel = s => s.dup ? 'Save anyway' : s.folder == null ? 'Save to Inbox' : 'Save';
export function doneHTML() { const s = layers.save;
  return `<div class="done-state"><span class="tick">${ic('check')}</span><h2>Saved</h2><p>${esc(s.savedTitle || '')}${s.savedIn ? ' in ' + esc(s.savedIn) : ''}</p>
    <button type="button" class="save" data-a="done">Done</button></div>`; }
export function patchSave() { // update the live parts of the save sheet without losing the caret
  const el = sheetEl(), s = layers.save, d = el.querySelector('.dupe'); if (!d) return;
  d.classList.toggle('off', !s.dup && !s.hid); d.querySelector('.dupe-t').innerHTML = dupeInner(s);
  const sf = el.querySelector('.sv-fav'), key = s.icon ? s.icon.icon : '';
  if (sf.dataset.k !== key) { sf.dataset.k = key; sf.innerHTML = svFav(s); if (key) sf.firstElementChild.classList.add('fade-in'); }
  const ph = sf.querySelector('.sv-ph'); if (ph) ph.classList.toggle('busy', !!s.checking); /* the shimmer runs only while the address is being looked up */
  const b = el.querySelector('[data-a="save-go"]'); if (b && !s.ticked) { b.textContent = primaryLabel(s); b.disabled = !!s.hid; }
}
let checkT = null, checkSeq = 0;
export function checkUrl(now) {
  clearTimeout(checkT); const go = async () => { const u = layers.save.url.trim(), my = ++checkSeq;
    if (!validUrl(u)) { layers.save.dup = null; layers.save.hid = false; layers.save.icon = null; layers.save.checking = false; patchSave(); return; }
    layers.save.checking = true; patchSave();
    try { const r = await api('GET', '/api/check?url=' + encodeURIComponent(u)); if (my !== checkSeq || !layers.save) return; layers.save.checking = false; layers.save.dup = r.duplicate || null; layers.save.hid = false; layers.save.icon = r.icon || null; patchSave(); /* hid comes only from a refused save (409 with locked) */ } catch (e) { if (my === checkSeq && layers.save) { layers.save.checking = false; patchSave(); } /* the save itself reports */ } };
  if (now) go(); else checkT = setTimeout(go, 220);
}
export async function doSave(inbox) {
  const s = layers.save; if (s.busy || s.ticked) return; const url = s.url.trim();
  if (!validUrl(url)) { s.err = 'Enter a full address starting with http or https.'; fillSheet(); sheetEl().querySelector('textarea').focus(); return; }
  const folder = inbox ? null : s.folder;
  const body = { title: s.title.trim() || hostFromUrl(url), url, folder_id: folder == null ? null : folder }; if (s.dup) body.force = true;
  s.busy = true; s.err = '';
  try { await api('POST', '/api/bookmarks', body); }
  catch (e) { s.busy = false; if (e.auth) return; if (e.status === 409 && e.data && e.data.duplicate) { s.dup = e.data.duplicate; fillSheet(); return; }
    if (e.status === 409 && e.data && e.data.locked) { s.hid = true; s.dup = null; fillSheet(); return; }
    s.err = errorText(e, 'Could not save. Try again.'); fillSheet(); return; }
  s.busy = false; s.savedTitle = body.title; s.savedIn = pathOf(folder);
  announce(`Saved in ${s.savedIn}`);
  if (document.body.dataset.page === 'save') { s.ticked = true; fillSheet(); await wait(600); closeWindow(true); return; }
  closeSheet(); await load();
}
export function closeWindow(saved) {
  try { window.close(); } catch (e) { /* not ours to close */ }
  setTimeout(() => { if (window.closed) return; if (saved) { layers.sheet.type = 'done'; fillSheet(); const b = sheetEl().querySelector('[data-a="done"]'); if (b) b.focus(); } else location.href = '/'; }, 150);
}


/* listeners on document and window, registered once by app.js */
export function installSheets() {
  document.addEventListener('input', e => { if (layers.sheet && layers.sheet.type === 'addto' && e.target.id === 'atq') { layers.sheet.q = e.target.value; atRefreshList(); } });
  document.addEventListener('pointerdown', e => {
    if (!layers.sheet || layers.sheet.type !== 'addto' || e.button > 0) return; const c = e.target.closest('.at-chk'); if (!c) return;
    const row = c.closest('.at-row'), on = !row.classList.contains('on'); atSet(row, on); atSync();
    atPaint = { on, pid: e.pointerId }; ui.suppressClick = performance.now() + 350; e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!atPaint || e.pointerId !== atPaint.pid) return;
    const r = document.elementFromPoint(e.clientX, e.clientY), row = r && r.closest('.at-row');
    if (row && row.classList.contains('on') !== atPaint.on) { atSet(row, atPaint.on); atSync(); }
    const l = byId('atlist'); if (l) { const R = l.getBoundingClientRect(); if (e.clientY < R.top + 40) l.scrollTop -= 10; else if (e.clientY > R.bottom - 40) l.scrollTop += 10; }
  });
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, e => { if (atPaint && e.pointerId === atPaint.pid) { atPaint = null; ui.suppressClick = performance.now() + 350; } }));
  document.addEventListener('click', e => { if (!layers.sheet || layers.sheet.type !== 'addto') return; const row = e.target.closest('.at-row');
    if (row && !e.target.closest('.at-chk')) { atSet(row, !row.classList.contains('on')); atSync(); } });
  document.addEventListener('pointerdown', e => { if (!layers.sheet || !isPhone() || document.body.dataset.page !== 'app' || e.button > 0) return;
    const el = sheetEl(); if (!el || !el.contains(e.target) || layer().classList.contains('dialog') || e.target.closest('input, textarea, select, .at-chk')) return; /* the check column paints a selection */
    sheetDrag = { y: e.clientY, pid: e.pointerId, dy: 0, sc: e.target.closest('.sh-body, .at-list'), h: el.getBoundingClientRect().height, active: false, pts: [[performance.now(), e.clientY]] }; });
  document.addEventListener('pointermove', e => { if (!sheetDrag || e.pointerId !== sheetDrag.pid) return; const el = sheetEl(), dy = e.clientY - sheetDrag.y;
    if (!sheetDrag.active) { if (Math.abs(dy) < 6) return;
      const sc = sheetDrag.sc, scrolls = sc && sc.scrollHeight > sc.clientHeight + 1;
      if (scrolls && (dy < 0 || sc.scrollTop > 0)) { sheetDrag = null; return; } /* the list scrolls instead */
      sheetDrag.active = true; el.style.transition = 'none'; const sm = sheetScrim(); if (sm) sm.style.transition = 'none'; }
    const d = e.clientY - sheetDrag.y; sheetDrag.dy = d; el.style.transform = `translateY(${d > 0 ? d : d / 4}px)`;
    const sm = sheetScrim(); if (sm) sm.style.opacity = String(Math.max(0, 1 - Math.max(0, d) / sheetDrag.h));
    sheetDrag.pts.push([performance.now(), e.clientY]); if (sheetDrag.pts.length > 6) sheetDrag.pts.shift(); });
  document.addEventListener('touchmove', e => { if (sheetDrag && sheetDrag.active) e.preventDefault(); }, { passive: false });
  ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, e => { if (!sheetDrag || e.pointerId !== sheetDrag.pid) return; const d = sheetDrag, el = sheetEl(), sm = sheetScrim(); sheetDrag = null;
    if (!d.active) return; ui.suppressClick = performance.now() + 350;
    const now = performance.now(), p = d.pts.filter(([t]) => now - t < 120), v = p.length > 1 ? (p[p.length - 1][1] - p[0][1]) / Math.max(1, p[p.length - 1][0] - p[0][0]) : 0;
    const clear = () => { el.style.transition = ''; el.style.transform = ''; if (sm) { sm.style.transition = ''; sm.style.opacity = ''; } };
    if (ev === 'pointerup' && (d.dy > d.h * .25 || v > .5)) {
      el.style.transition = 'transform 200ms cubic-bezier(.23,1,.32,1)'; el.style.transform = 'translateY(100%)';
      if (sm) { sm.style.transition = 'opacity 200ms ease'; sm.style.opacity = '0'; }
      setTimeout(() => { el.style.transition = 'none'; closeSheet(); requestAnimationFrame(() => requestAnimationFrame(clear)); }, 200); return; }
    el.style.transition = 'transform 220ms cubic-bezier(.32,.72,0,1)'; el.style.transform = '';
    if (sm) { sm.style.transition = 'opacity 220ms ease'; sm.style.opacity = ''; }
    setTimeout(() => { if (!sheetDrag) clear(); }, 240); }));
}
