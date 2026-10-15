/* Pinned extension, options: the address and the token, a Test against GET /api/folders, Save. */
'use strict';
(function () {
  var h = Pinned.h, icon = Pinned.icon;
  var form = document.getElementById('form'), addr = document.getElementById('address'), tok = document.getElementById('token');
  var testBtn = document.getElementById('test'), status = document.getElementById('status');
  var saved = { address: '', token: '' };

  function show(kind, text) {
    status.hidden = false;
    status.className = 'status ' + kind;
    status.replaceChildren(icon(kind === 'ok' ? 'check' : 'warn'), h('span', { text: text }));
  }
  function read() {
    var a = Pinned.cleanAddress(addr.value), t = tok.value.trim();
    if (!a) { show('bad', 'Enter an address starting with http or https.'); addr.focus(); return null; }
    if (!t) { show('bad', 'Enter the token.'); tok.focus(); return null; }
    return { address: a, token: t };
  }

  Pinned.config().then(function (c) { saved = c; addr.value = c.address; tok.value = c.token; if (!c.address) addr.focus(); });

  testBtn.addEventListener('click', async function () {
    var cfg = read(); if (!cfg) return;
    testBtn.disabled = true; show('wait', 'Testing');
    try {
      var folders = await Pinned.api(cfg, 'GET', '/api/folders');
      var n = Array.isArray(folders) ? folders.length : 0;
      show('ok', 'Connected, ' + n + (n === 1 ? ' folder' : ' folders'));
    } catch (e) { show('bad', e.message + '.'); }
    finally { testBtn.disabled = false; }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var cfg = read(); if (!cfg) return;
    addr.value = cfg.address;
    var pattern = Pinned.originPattern(cfg.address);
    /* the request has to start inside the click, before anything is awaited */
    var asked = ext.permissions.request({ origins: [pattern] }).catch(function () { return false; });
    var old = saved.address && Pinned.cleanAddress(saved.address);
    var oldPattern = old ? Pinned.originPattern(old) : '';
    var next = { address: cfg.address, token: cfg.token };
    if (old !== cfg.address) next.recent = []; /* folder ids belong to one server */
    var stored = ext.storage.local.set(next);
    saved = Object.assign({}, saved, next);
    show('wait', 'Saved. Waiting for the browser to allow access to ' + new URL(cfg.address).hostname + '.');
    Promise.all([asked, stored]).then(async function (r) {
      var granted = r[0];
      if (oldPattern && oldPattern !== pattern) { try { await ext.permissions.remove({ origins: [oldPattern] }); } catch (err) { /* was not granted */ } }
      show(granted ? 'ok' : 'bad', granted ? 'Saved' : 'Saved, but access to ' + new URL(cfg.address).hostname + ' was not allowed.');
    });
  });
})();
