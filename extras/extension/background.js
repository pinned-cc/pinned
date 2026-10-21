/* Pinned extension, background: the context menu. Chrome runs this as a service worker, Firefox as an event page. */
'use strict';
if (typeof Pinned === 'undefined' && typeof importScripts === 'function') importScripts('shared.js');

function makeMenus() {
  ext.contextMenus.removeAll(function () {
    ext.contextMenus.create({ id: 'pinned-page', title: 'Save to Pinned', contexts: ['page'] });
    ext.contextMenus.create({ id: 'pinned-link', title: 'Save to Pinned', contexts: ['link'] });
  });
}
ext.runtime.onInstalled.addListener(makeMenus);
if (ext.runtime.onStartup) ext.runtime.onStartup.addListener(makeMenus);

var badgeTimer = null;
function badge(text, color) {
  clearTimeout(badgeTimer);
  ext.action.setBadgeBackgroundColor({ color: color });
  if (ext.action.setBadgeTextColor) ext.action.setBadgeTextColor({ color: '#04150c' });
  ext.action.setBadgeText({ text: text });
  badgeTimer = setTimeout(function () { ext.action.setBadgeText({ text: '' }); }, 2000);
}

function hostOf(u) { try { return new URL(u).host; } catch (e) { return u; } }

ext.contextMenus.onClicked.addListener(function (info, tab) {
  var url, title;
  if (info.menuItemId === 'pinned-link') {
    url = info.linkUrl;
    title = (info.linkText || info.selectionText || '').trim() || hostOf(url);
  } else if (info.menuItemId === 'pinned-page') {
    url = info.pageUrl || (tab && tab.url);
    title = ((tab && tab.title) || '').trim() || hostOf(url);
  } else return;
  saveToInbox(url, title);
});

async function saveToInbox(url, title) {
  var cfg = await Pinned.config();
  if (!cfg.address || !cfg.token) { ext.runtime.openOptionsPage(); return; }
  if (!/^https?:\/\//i.test(url || '')) { badge('!', '#ff9a9a'); return; }
  try {
    await Pinned.api(cfg, 'POST', '/api/bookmarks', { title: title, url: url, folder_id: null });
    badge('✓', '#5fd39a');
  } catch (e) {
    if (e.status === 409) badge('=', '#9a9a9f');
    else badge('!', '#ff9a9a');
  }
}
