/* Pinned extension: storage, the API client and small DOM helpers, shared by the popup, the options page and the background script.
   Nothing is ever sent anywhere but the address the user configures. */
'use strict';
var ext = globalThis.browser || globalThis.chrome;

var Pinned = (function () {
  /* the address as typed, reduced to scheme, host, port and an optional path, without a trailing slash */
  function cleanAddress(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    var u;
    try { u = new URL(s); } catch (e) { return ''; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return '';
    return (u.origin + u.pathname).replace(/\/+$/, '');
  }
  /* host permission pattern for the address; match patterns carry no port, so this covers every port on that host */
  function originPattern(address) {
    var u = new URL(address);
    return u.protocol + '//' + u.hostname + '/*';
  }

  async function config() {
    var c = await ext.storage.local.get(['address', 'token', 'recent']);
    return { address: c.address || '', token: c.token || '', recent: Array.isArray(c.recent) ? c.recent : [] };
  }

  async function api(cfg, method, path, body) {
    var opt = { method: method, headers: { Authorization: 'Bearer ' + cfg.token }, credentials: 'omit', cache: 'no-store' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    var r;
    try { r = await fetch(cfg.address + path, opt); }
    catch (e) { var ne = new Error('Could not reach ' + cfg.address); ne.network = true; throw ne; }
    var data = null;
    if ((r.headers.get('content-type') || '').indexOf('json') !== -1) { try { data = await r.json(); } catch (e) { data = null; } }
    if (!r.ok) {
      var msg = r.status === 401 ? 'The token was not accepted' : (data && data.error) ? data.error : 'The server answered ' + r.status;
      var err = new Error(msg); err.status = r.status; err.data = data; throw err;
    }
    return data;
  }

  async function remember(folderId) {
    if (folderId == null) return;
    var c = await config();
    var next = [folderId].concat(c.recent.filter(function (x) { return x !== folderId; })).slice(0, 3);
    await ext.storage.local.set({ recent: next });
  }

  /* folder hues, the same rule as the app: top level folders ranked by creation, six hues in turn, Inbox is the tray hue */
  var HUES = ['cyan', 'coral', 'lilac', 'lime', 'mint', 'rose'];
  function folderIndex(folders) {
    var byId = new Map(folders.map(function (f) { return [f.id, f]; }));
    var top = folders.filter(function (f) { return f.parent_id == null; }).sort(function (a, b) { return a.id - b.id; });
    var rank = new Map(top.map(function (f, i) { return [f.id, i]; }));
    function chain(id) { var out = [], f = byId.get(id), g = 0; while (f && g++ < 64) { out.unshift(f); f = f.parent_id != null ? byId.get(f.parent_id) : null; } return out; }
    function hue(id) { if (id == null) return 'tray'; var c = chain(id); return c.length ? HUES[(rank.get(c[0].id) || 0) % 6] : 'plain'; }
    function path(id) { if (id == null) return 'Inbox'; return chain(id).map(function (f) { return f.name; }).join(' / ') || 'Inbox'; }
    function kids(pid) { return folders.filter(function (f) { return (f.parent_id == null ? null : f.parent_id) === pid; }).sort(function (a, b) { return a.position - b.position || a.id - b.id; }); }
    /* depth first, the order of the app's tree */
    function flat() { var out = []; (function walk(pid, d) { kids(pid).forEach(function (f) { out.push({ f: f, depth: d }); walk(f.id, d + 1); }); })(null, 0); return out; }
    return { byId: byId, hue: hue, path: path, kids: kids, flat: flat, has: function (id) { return byId.has(id); } };
  }

  /* DOM: elements and icons without innerHTML */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      (Array.isArray(c) ? c : [c]).forEach(function (x) { if (x != null && x !== false) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    }
    return el;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    var u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  }

  return { cleanAddress: cleanAddress, originPattern: originPattern, config: config, api: api, remember: remember, folderIndex: folderIndex, h: h, icon: icon };
})();
