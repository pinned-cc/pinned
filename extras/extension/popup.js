/* Pinned extension, popup: the app's save sheet for the current tab. */
'use strict';
(function () {
  var h = Pinned.h, icon = Pinned.icon, pop = document.getElementById('pop');
  var cfg = null, F = null, S = null;

  function close() { window.close(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  function openOptions() { ext.runtime.openOptionsPage(); close(); }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return u; } }

  /* one line and a button, for setup and for errors that stop the popup */
  function notice(title, text, button) {
    pop.replaceChildren(h('div', { class: 'setup rise' },
      h('div', { class: 'sv-top' }, h('h1', { text: title }), h('button', { type: 'button', class: 'ib', 'aria-label': 'Close', onclick: close }, icon('close'))),
      text ? h('p', { text: text }) : null,
      button ? h('div', { class: 'sv-acts' }, h('button', { type: 'button', class: 'save', onclick: button.run }, button.label)) : null));
  }
  /* Enter runs the one button of a notice */
  document.addEventListener('keydown', function (e) { var b = !S && e.key === 'Enter' && pop.querySelector('.setup .save'); if (b) { e.preventDefault(); b.click(); } });

  function iconSrc(name) {
    if (!name) return null;
    if (/^(https?:|data:)/.test(name)) return name.indexOf(cfg.address) === 0 || name.indexOf('data:') === 0 ? name : null;
    return cfg.address + (name.charAt(0) === '/' ? name : '/icons/' + encodeURIComponent(name));
  }
  function favEl() {
    var letter = (S.title || hostOf(S.url) || '?').trim().charAt(0).toUpperCase() || '?';
    if (!S.checked) return h('span', { class: 'fav sv-ph', 'aria-hidden': 'true' }, h('span', { class: 'ph-in' }));
    var src = S.icon && iconSrc(S.icon.icon);
    if (!src) return h('span', { class: 'fav fade-in', 'aria-hidden': 'true', text: letter });
    var box = h('span', { class: 'fav fade-in', 'aria-hidden': 'true', style: '--tile:' + (S.icon.tile || 'var(--tile-blank)') });
    var img = h('img', { src: src, alt: '', width: 48, height: 48 });
    img.addEventListener('error', function () { box.style.setProperty('--tile', 'var(--tile-blank)'); box.textContent = letter; });
    box.appendChild(img);
    return box;
  }

  function chip(id) {
    var on = id === S.folder;
    return h('button', { type: 'button', class: 'fmini' + (on ? ' fill' : ''), role: 'radio', 'aria-checked': String(on), style: '--h:var(--' + F.hue(id) + ');--hp:var(--' + F.hue(id) + '-p)', onclick: function () { pick(id); } },
      h('span', { class: 'v' }, h('span', { class: 'nm' }, icon('folder', 'fi'), h('span', { class: 'nt', text: F.path(id) }))));
  }
  function row(id, name, depth) {
    var on = id === S.folder, hu = F.hue(id);
    return h('button', { type: 'button', class: 'si', role: 'radio', 'aria-checked': String(on), style: '--h:var(--' + hu + ');--hp:var(--' + hu + '-p);padding-left:' + (8 + depth * 16) + 'px', onclick: function () { pick(id); } },
      h('span', { class: 'si-ic' }, icon(id == null ? 'inbox' : 'folder')), h('span', { class: 'si-n', text: name }), on ? icon('check', 'ck') : null);
  }
  function pick(id) {
    S.folder = id; S.picker = false;
    if (id != null) S.recent = [id].concat(S.recent.filter(function (x) { return x !== id; })).slice(0, 3);
    render();
    var b = pop.querySelector('.fmini[aria-checked="true"]') || pop.querySelector('[data-a="save-go"]'); if (b) b.focus();
  }
  function primaryLabel() { return S.dup ? 'Save anyway' : S.folder == null ? 'Save to Inbox' : 'Save'; }

  function dupeEl() {
    var p = h('p', { class: 'dupe' + (S.dup || S.hid ? '' : ' off'), role: 'status' }, icon('warn'));
    var t = h('span', { class: 'dupe-t' });
    if (S.hid) t.appendChild(h('span', { class: 'd1', text: 'Already saved' }));
    else if (S.dup) {
      t.appendChild(h('span', { class: 'd1', text: 'Already saved in ' + F.path(S.dup.folder_id == null ? null : S.dup.folder_id) + '.' }));
      t.appendChild(h('span', { class: 'd2', text: 'Save anyway moves it here.' }));
    } else t.appendChild(h('span', { class: 'd1', text: 'Not saved yet' }));
    p.appendChild(t);
    return p;
  }

  function render() {
    var focusTitle = document.activeElement && document.activeElement.id === 'title';
    var caret = focusTitle ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    var rec = S.recent.filter(F.has);
    if (!rec.length) rec = F.kids(null).slice(0, 3).map(function (f) { return f.id; });
    var none = S.folder == null;
    var title = h('input', { class: 'fld-in', id: 'title', value: S.title, autocomplete: 'off', spellcheck: 'false' });
    title.value = S.title;
    title.addEventListener('input', function () { S.title = title.value; });

    var list = null;
    if (S.picker) {
      list = h('div', { class: 'flist', role: 'radiogroup', 'aria-label': 'All folders' }, row(null, 'Inbox', 0),
        F.flat().map(function (x) { return row(x.f.id, x.f.name, x.depth); }));
    }
    var form = h('form', { novalidate: true },
      h('label', { class: 'fld' }, h('span', { class: 'sh-lbl', text: 'Title' }), title),
      h('div', { class: 'fld' }, h('span', { class: 'sh-lbl', text: 'URL' }), h('div', { class: 'fld-in url-show', title: S.url, text: S.url })),
      dupeEl(),
      S.err ? h('p', { class: 'fld-err', role: 'alert', text: S.err }) : null,
      h('div', { class: 'sv-folder', role: 'radiogroup', 'aria-labelledby': 'sv-fl' }, h('span', { class: 'sh-lbl', id: 'sv-fl', text: 'Folder' }),
        rec.length && !S.picker ? h('div', { class: 'fpick' }, rec.map(chip)) : null),
      h('button', { type: 'button', class: 'tbtn sv-pick', 'aria-expanded': String(S.picker), onclick: function () { S.picker = !S.picker; render(); var r = pop.querySelector('.flist .si[aria-checked="true"]') || pop.querySelector('.flist .si'); if (r) { r.scrollIntoView({ block: 'nearest' }); r.focus(); } } },
        none ? 'Choose a folder' : 'Choose another folder', icon('chev', 'chev')),
      list,
      h('div', { class: 'sv-acts' },
        none ? null : h('button', { type: 'button', class: 'tbtn', onclick: function () { save(true); } }, 'Save to Inbox'),
        h('button', { type: 'submit', class: 'save', 'data-a': 'save-go', disabled: S.hid || S.busy }, primaryLabel())));
    form.addEventListener('submit', function (e) { e.preventDefault(); save(false); });

    pop.replaceChildren(h('div', { class: 'sv-top' }, favEl(), h('button', { type: 'button', class: 'ib', 'aria-label': 'Close', onclick: close }, icon('close'))), form);
    if (focusTitle || !S.rendered) { title.focus(); if (caret) title.setSelectionRange(caret[0], caret[1]); else title.select(); }
    S.rendered = true;
  }

  async function save(inbox) {
    if (S.busy || S.hid) return;
    var folder = inbox ? null : S.folder;
    var body = { title: S.title.trim() || hostOf(S.url), url: S.url, folder_id: folder };
    if (S.dup) body.force = true;
    S.busy = true; S.err = '';
    try { await Pinned.api(cfg, 'POST', '/api/bookmarks', body); }
    catch (e) {
      S.busy = false;
      if (e.status === 409 && e.data && e.data.duplicate) { S.dup = e.data.duplicate; render(); return; }
      if (e.status === 409 && e.data && e.data.locked) { S.hid = true; S.dup = null; render(); return; }
      S.err = e.message + '.'; render(); return;
    }
    await Pinned.remember(folder);
    pop.replaceChildren(h('div', { class: 'state rise', role: 'status' }, h('span', { class: 'tick' }, icon('check')),
      h('div', { class: 'tt' }, h('h1', { text: 'Saved to ' + F.path(folder) }), h('p', { text: body.title }))));
    setTimeout(close, 1000);
  }

  async function boot() {
    cfg = await Pinned.config();
    if (!cfg.address || !cfg.token) { notice('Set your address and token first', null, { label: 'Open settings', run: openOptions }); return; }
    var tabs = await ext.tabs.query({ active: true, currentWindow: true });
    var tab = tabs && tabs[0];
    if (!tab || !/^https?:\/\//i.test(tab.url || '')) { notice('This page cannot be saved', 'Only pages with an http or https address can be saved.', null); return; }

    var folders;
    try { folders = await Pinned.api(cfg, 'GET', '/api/folders'); }
    catch (e) { notice(e.status === 401 ? 'The token was not accepted' : 'Could not reach your server', e.status === 401 ? 'Check the token in settings.' : cfg.address, { label: 'Open settings', run: openOptions }); return; }
    folders = (Array.isArray(folders) ? folders : []).filter(function (f) { return !(f.locked && !f.unlocked); });
    F = Pinned.folderIndex(folders);

    var recent = cfg.recent.filter(F.has);
    S = { title: (tab.title || '').trim(), url: tab.url, folder: recent.length ? recent[0] : null, recent: recent, picker: false,
      dup: null, hid: false, icon: null, checked: false, err: '', busy: false, rendered: false };
    render();

    try {
      var r = await Pinned.api(cfg, 'GET', '/api/check?url=' + encodeURIComponent(S.url));
      S.dup = r && r.duplicate || null; S.hid = !!(r && r.locked); S.icon = r && r.icon || null;
    } catch (e) { /* the save itself reports */ }
    S.checked = true;
    render();
  }
  boot();
})();
