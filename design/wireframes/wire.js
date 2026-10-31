// Hotspots, gesture targets and keyboard shortcuts for the Pinned wireframes. No libraries.
(function () {
  var root = document.documentElement;
  var hot = false;
  try { hot = [new URLSearchParams(location.search).get('hot'), sessionStorage.getItem('wire-hot')].indexOf('1') >= 0; } catch (e) {}
  if (hot) root.classList.add('hot');

  function go(href) {
    var h = href;
    if (root.classList.contains('hot') && h.indexOf('hot=') < 0) h += (h.indexOf('?') < 0 ? '?' : '&') + 'hot=1';
    location.href = h;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (href.indexOf('http') === 0 ? true : href.indexOf('../') === 0 ? true : href.charAt(0) === '#') return;
    e.preventDefault();
    go(href);
  });

  var keys = {};
  try { keys = JSON.parse(document.body.getAttribute('data-keys') ? document.body.getAttribute('data-keys') : '{}'); } catch (e) {}
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && ['INPUT', 'TEXTAREA'].indexOf(t.tagName) >= 0) return;
    if (e.key === 'h' && !e.metaKey && !e.ctrlKey) {
      root.classList.toggle('hot');
      try { sessionStorage.setItem('wire-hot', root.classList.contains('hot') ? '1' : '0'); } catch (err) {}
      return;
    }
    var k = (e.ctrlKey ? 'Control+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.metaKey ? 'Meta+' : '') +
      (e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (keys[k]) { e.preventDefault(); go(keys[k]); }
  });

  if (window.parent !== window) {
    try { window.parent.postMessage({ wireScreen: location.pathname.split('/').pop().replace('.html', '') }, '*'); } catch (e) {}
  }
})();

