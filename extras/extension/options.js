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
  /* what Test and Save work on: the addresses to try, in order (one when a scheme was typed, else https then http) */
  function read() {
    var c = Pinned.addressCandidates(addr.value), t = tok.value.trim();
    if (!c.length) { show('bad', 'Enter an address, such as 10.0.0.5:9095 or https://bookmarks.example.com.'); addr.focus(); return null; }
    if (!t) { show('bad', 'Enter the token.'); tok.focus(); return null; }
    return { candidates: c, token: t };
  }
  /* an address typed with http:// for a host outside the own network sends the token in clear: Test and Save say so first
     and go ahead on a second click of the same button; once gone ahead, the address counts for both until it changes.
     Decided on the cleaned address, so the address Save writes back into the field is the same address. */
  var armed = null, confirmed = '';
  function plainPublic(c) { return c.length === 1 && Pinned.plainPublic(c[0]) ? c[0] : ''; }
  function holdForPlain(cfg, button) {
    var a = plainPublic(cfg.candidates);
    if (a !== confirmed) confirmed = '';
    if (!a || a === confirmed) { armed = null; return false; }
    if (armed && armed.address === a && armed.button === button) { armed = null; confirmed = a; return false; }
    armed = { address: a, button: button };
    show('bad', 'On plain http your token may cross the internet unencrypted. Use https, or click ' + (button === 'test' ? 'Test again to connect' : 'Save again to save') + ' anyway.');
    return true;
  }
  function folderCount(f) { var n = Array.isArray(f) ? f.length : 0; return n + (n === 1 ? ' folder' : ' folders'); }
  /* a refused token or another server answer, said with the address that answered */
  function reachedButText(e) { return 'Reached ' + e.address + ', but ' + e.message.charAt(0).toLowerCase() + e.message.slice(1) + (/[.!?]$/.test(e.message) ? '' : '.'); }

  /* opened on a stored address the user has not gone ahead with (saved by 0.1.11, or the right click save sent it here):
     the warning shows at once and Save is armed, so one click on Save goes ahead */
  Pinned.config().then(function (c) {
    saved = c; addr.value = c.address; tok.value = c.token; if (!c.address) addr.focus();
    if (Pinned.plainUnconfirmed(c)) {
      armed = { address: Pinned.cleanAddress(c.address), button: 'save' };
      show('bad', 'On plain http your token may cross the internet unencrypted. Use https, or click Save to keep using this address.');
    }
  });

  testBtn.addEventListener('click', async function () {
    var cfg = read(); if (!cfg || holdForPlain(cfg, 'test')) return;
    testBtn.disabled = true; show('wait', 'Testing');
    try {
      var got = await Pinned.probe(cfg.candidates, cfg.token);
      show('ok', 'Connected to ' + got.address + ', ' + folderCount(got.folders) + '.');
    } catch (e) { show('bad', e.address ? reachedButText(e) : e.message + '.'); }
    finally { testBtn.disabled = false; }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var cfg = read(); if (!cfg || holdForPlain(cfg, 'save')) return;
    var patterns = cfg.candidates.map(Pinned.originPattern), host = new URL(cfg.candidates[0]).hostname;
    /* the request has to start inside the click, before anything is awaited; without a scheme it asks for both,
       and the one that does not answer is given back below */
    var had = Promise.all(patterns.map(function (p) { return ext.permissions.contains({ origins: [p] }).catch(function () { return false; }); }));
    var asked = ext.permissions.request({ origins: patterns }).catch(function () { return false; });
    var old = saved.address && Pinned.cleanAddress(saved.address);
    var oldPattern = old ? Pinned.originPattern(old) : '';
    show('wait', 'Waiting for the browser to allow access to ' + host + '.');
    asked.then(async function (granted) {
      var address = cfg.candidates[0];
      if (cfg.candidates.length > 1) {
        show('wait', 'Looking for Pinned at ' + host + '.');
        try { address = (await Pinned.probe(cfg.candidates, cfg.token)).address; }
        catch (e) {
          if (!e.address) {
            /* give back only what this Save was granted, never the access the saved address uses */
            var before = await had, fresh = patterns.filter(function (p, i) { return !before[i] && p !== oldPattern; });
            if (granted && fresh.length) { try { await ext.permissions.remove({ origins: fresh }); } catch (err) { /* not granted */ } }
            show('bad', e.message + '. Nothing was saved.'); return;
          }
          address = e.address; /* reached, the token is the problem: keep the address, the next Test says why */
        }
      }
      addr.value = address;
      var next = { address: address, token: cfg.token, plainOK: Pinned.plainPublic(address) && confirmed === address ? address : '' };
      if (old !== address) next.recent = []; /* folder ids belong to one server */
      await ext.storage.local.set(next);
      saved = Object.assign({}, saved, next);
      var keep = Pinned.originPattern(address), drop = patterns.filter(function (p) { return p !== keep; });
      if (oldPattern && oldPattern !== keep) drop.push(oldPattern);
      if (drop.length) { try { await ext.permissions.remove({ origins: drop }); } catch (err) { /* was not granted */ } }
      show(granted ? 'ok' : 'bad', granted ? 'Saved ' + address + '.' : 'Saved, but access to ' + host + ' was not allowed. Save again and allow it.');
    });
  });
})();
