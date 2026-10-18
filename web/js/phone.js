/* Phone only switches: the start screen's tabs, and the bottom bar that follows the on screen keyboard. */
import { byId } from './util.js';
/* the start screen's tabs on the phone */
export const PHONE_TABS = ['dashboard', 'inbox', 'folders'];

export function vvSync() {
  if (window.visualViewport) { const r = document.documentElement.style; r.setProperty('--vvh', visualViewport.height + 'px'); r.setProperty('--vvt', visualViewport.offsetTop + 'px'); } /* sheets and dialogs fit the visible screen */
  if (!window.visualViewport) return; const vv = window.visualViewport, off = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  document.documentElement.style.setProperty('--kb', off + 'px'); /* a phone sheet sits on the keyboard */
  const el = byId('pbottom'); if (!el) return;
  el.style.transform = off > 0 ? `translateY(${-off}px)` : '';
}
/* listeners on document and window, registered once by app.js */
export function installPhone() {
  if (window.visualViewport) { visualViewport.addEventListener('resize', vvSync); visualViewport.addEventListener('scroll', vvSync); }
}
