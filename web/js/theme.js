/* Light or dark, before the first paint. The choice from the bulb is kept in this browser; without one, the system decides
   and a change of the system follows live. A classic script in the head, so the page never flashes the other colour. */
(function () {
  var root = document.documentElement, KEY = 'pinned-theme', sys = matchMedia('(prefers-color-scheme: light)');
  var saved = function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  var apply = function (t) {
    root.dataset.theme = t;
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === 'light' ? '#f4f1ea' : '#0f0f11';
    var c = document.querySelector('meta[name="color-scheme"]'); if (c) c.content = t;
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) { b.setAttribute('aria-label', t === 'light' ? 'Dark mode' : 'Light mode'); });
  };
  apply(saved() || (sys.matches ? 'light' : 'dark'));
  sys.addEventListener('change', function (e) { if (!saved()) apply(e.matches ? 'light' : 'dark'); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('[data-theme-toggle]')) return;
    var t = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, t); } catch (err) { /* private window: the choice lasts for this page */ }
    apply(t);
  });
  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.dataset.page !== 'app') return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'bulb desk desk-only'; b.setAttribute('data-theme-toggle', '');
    b.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-bulb"/></svg>';
    document.body.appendChild(b); apply(root.dataset.theme);
  });
})();
