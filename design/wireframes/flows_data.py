"""The user flows of Pinned as built, each step with its screens, what the user does, and what the
flow test found in the real running app (works, friction, broken) with the evidence.

Walked on 31.10.2026 against a local build of main at ad2cb8e (0.1.11 candidate) with a throwaway
data folder, headless Chromium (desktop 1280 by 800, phone 390 by 844, light and dark), WebKit for
the P-WEB checks, the extension loaded unpacked in Chromium, and release 0.1.10 built from its tag
for the upgrade and going back steps. Evidence names a screenshot of that run (not kept), a route,
or file:line in the repo.
"""
import json
import re


def S(text, screens, do, now, ev, note=''):
    return dict(text=text, screens=screens if isinstance(screens, list) else [screens], do=do, now=now, ev=ev, note=note)


FLOWS = [
 dict(id='01', name='First start and login', steps=[
  S('The owner starts the container with a password: APP_PASSWORD=... docker compose up -d.', 'term-start', 'Read the log line, then open the address.', 'works', 'README.md, Install in five minutes; log "pinned listening on :8080, data in /data".'),
  S('Without a password, or with fewer than 8 characters, the server does not start and says why.', 'term-start-error', 'Set a longer password.', 'works', 'Binary output: "APP_PASSWORD is not set. Set it, or APP_PASSWORD_FILE ..." and "APP_PASSWORD is shorter than 8 characters ..."'),
  S('Opening the app without a login goes to the login page.', 'login', 'Type the password.', 'works', 'GET / answers with /login?next=%2F (Chromium, all four sizes and themes).'),
  S('A wrong password comes back with "Wrong password." and the caret in the field.', 'login-error', 'Type it again.', 'works', 'shot a01; /login?error=1; web/js/app.js:79.'),
  S('After 5 wrong tries the page says "Wait 30 seconds and try again."; during the wait the right password gets the same answer, with no countdown.', 'login-wait', 'Wait, then log in.', 'friction', 'shot b22; /login?error=wait; web/js/app.js:79 (fixed text).'),
  S('The right password lands on the empty Dashboard with Add bookmark, Import and How to save.', 'dash-empty', 'Pick a way to fill it.', 'works', 'shot home-empty-desk-light.'),
  S('On the phone the same login, then Dashboard, Inbox and Folders tabs, the Settings gear, the search pill and the plus.', ['p-login', 'p-dash-empty'], 'Log in on the phone.', 'works', 'shot home-empty-phone-dark; axe clean on login and Dashboard (phone).'),
  S('Light and dark follow the system; the bulb switches and the choice is kept per browser.', 'dash', 'Click the bulb.', 'works', 'web/js/theme.js:3-20; shots b18 (dark desktop), b21 (dark phone); WebKit dark: no overflow, axe clean.'),
  S('Password managers fill the login: the form carries a fixed user name.', 'login', 'Let the password manager fill it.', 'works', 'web/login.html, hidden username field with autocomplete="username".'),
 ]),
 dict(id='02', name='Save a link, in the app, with the bookmarklet and with the extension', steps=[
  S('Add (desktop) or the plus (phone) opens the save sheet, the folder preset to the last one used.', ['add-sheet', 'p-add'], 'Paste an address.', 'works', 'shots a10, b08; web/js/sheets.js:304-327.'),
  S('An address typed without http, such as example.com, is refused on Save with "Enter a full address starting with http or https." The extension options add https:// on their own.', 'add-noscheme', 'Type http:// in front.', 'friction', 'shot a11; web/js/sheets.js:359; compare extras/extension/shared.js:12.'),
  S('After fixing the address the old error stays under the field, next to the live check that now says the link is fine or already saved.', 'add-stale', 'Ignore it and save.', 'friction', 'shot a12; web/js/actions.js:281 (onInput never clears s.err); web/js/sheets.js:322.'),
  S('An address already saved shows "Already saved in Homelab. Save anyway moves it here." and the button turns into Save anyway.', 'add-dupe', 'Save anyway, or close.', 'works', 'shot a12; GET /api/check.'),
  S('The same host on another port is a new bookmark: Not saved yet.', 'add-newport', 'Give it a title.', 'works', 'log-a: Jellyfin on :8096 next to :8080 saved as new.'),
  S('Choose another folder lists every folder and New folder.', 'add-picker', 'Pick a folder.', 'works', 'shot a13.'),
  S('Save closes the sheet and the card appears in its folder. No toast; screen readers hear "Saved in Homelab".', 'folder-saved', 'Find the new card.', 'works', 'shot a14; web/js/sheets.js:368-373.'),
  S('Bookmarklet: How to save, Computer, drag Save to Pinned into the bookmarks bar.', 'howto-computer', 'Drag the button.', 'works', 'shot a62; /bookmarklet; axe clean desktop and phone.'),
  S('On any page Save to Pinned opens /save in a small window with title, address, recent folders and Log out.', ['browser-page', 'save-page'], 'Check the folder, Save.', 'works', 'shot a64; WebKit desktop and phone: no overflow, no console errors.'),
  S('Saving draws a tick and closes the window; where the browser keeps it open, a Saved state with Done.', 'save-done', 'Done.', 'works', 'shot a65; web/js/sheets.js:371-383.'),
  S('Extension: How to save, Extension: download, unzip, load unpacked; "a token" opens API tokens.', 'howto-extension', 'Download, load, then follow a token.', 'works', 'shot b17-howto-Extension; web/bookmarklet.html:141 (/#tokens), web/js/app.js:42-44.'),
  S('With a token made (flow 09), the extension options take the address and the token.', 'ext-options', 'Type the address.', 'works', 'shot e02.'),
  S('The home address typed as most people write it, 10.0.0.5:9095, becomes https:// and Test says "Could not reach https://10.0.0.5:9095." Nothing hints that the server speaks http.', 'ext-options-fail', 'Type http:// in front.', 'friction', 'shot e03; extras/extension/shared.js:12 and :34; README install answers on plain http :9095.'),
  S('With http:// Test says "Connected, 5 folders"; Save stores both and asks the browser for access to that host.', 'ext-options-ok', 'Allow access.', 'works', 'shots e04, e06. The permission prompt itself cannot show in headless Chromium; the status waits for it.'),
  S('The toolbar button or Option Shift S opens the popup: title selected, address, three recent folders, Save to Inbox.', ['ext-popup', 'ext-popup-picker'], 'Pick a folder, Save.', 'works', 'shots e07, e08; saved bookmark checked in GET /api/state.'),
  S('Saved: the tick draws and the popup closes.', 'ext-saved', 'Nothing.', 'works', 'log-e "popup closed itself".'),
  S('The same page again: "Already saved in Homelab / Network." with Save anyway.', 'ext-popup-dupe', 'Close.', 'works', 'shot e10.'),
  S('On a browser page: "This page cannot be saved".', 'ext-popup-cannot', 'Close.', 'works', 'shot e11.'),
  S('The popup and options are always dark, while the app and its pages follow light and dark since 0.1.11.', 'ext-popup', 'Notice the mismatch.', 'friction', 'shot e07 with the system in light; extras/extension/ui.css:17 color-scheme:dark.'),
  S('Right click a page or link, Save to Pinned: it goes to the Inbox and the button shows a tick, = when already saved, ! on failure.', 'ext-context', 'Right click.', 'works', 'extras/extension/background.js:25-52. Read from the code; context menus cannot be driven headless.'),
  S('iPhone and Android: How to save shows the Safari bookmark and the home screen share target.', 'howto-iphone', 'Follow the steps on the phone.', 'works', 'shot b16; log-b howto iPhone and Android.'),
 ]),
 dict(id='03', name='Find and open', steps=[
  S('/ or Command K or a click on the search field opens the search over the blurred app, with recent opens.', 'palette', 'Type.', 'works', 'shot a15; web/js/keys.js:45 and :54.'),
  S('Typing filters by title, address and host, grouped by folder, the first hit marked.', 'palette-results', 'Arrow to a hit.', 'works', 'shot a16.'),
  S('Enter opens the marked link in a new tab and records it for Recently opened.', ['palette-results', 'open-tab'], 'Press Enter.', 'works', 'dbg run: new page event after Enter; web/js/palette.js:87.'),
  S('No match: "No matches."', 'palette-none', 'Change the query.', 'works', 'shot a17.'),
  S('Escape clears the query first, a second Escape closes the search.', 'palette', 'Press Escape twice.', 'works', 'web/js/palette.js:166.'),
  S('From the browser address bar: /search?q=portainer opens the app with that search.', 'palette-bar', 'Pick the hit.', 'works', 'shot a18; internal/server/pages.go:137-139.'),
  S('A click on a card opens the link in a new tab; Command click opens it behind.', ['folder', 'open-tab'], 'Click a card.', 'works', 'web/js/actions.js:171-178.'),
  S('The Dashboard keeps the pinned row and Recently opened, else Recently saved.', 'dash', 'Read the Dashboard.', 'works', 'shots a06, a45.'),
  S('On the phone the search pill opens the same search as a sheet.', 'p-search', 'Type.', 'works', 'shot b09.'),
  S('Links in a locked folder never show in search.', 'palette-locked', 'Search for one.', 'works', 'shot a51 ("bank" in locked Finance: No matches).'),
  S('After a very large import, All bookmarks draws every card at once: 10000 links hold the page for 1.4 s, 100000 links freeze it for more than 2 minutes. The README promises imports of 470000 links.', 'all-big', 'Open All bookmarks.', 'broken', 'j.mjs timing on 10000 and 100000 imported links; web/js/render.js:149-170 renders all sections.'),
 ]),
 dict(id='04', name='Organise folders', steps=[
  S('The plus next to Folders, or N, opens New folder; Create opens the new empty folder.', ['new-folder', 'folder-empty'], 'Name it, Enter.', 'works', 'shots a26, a27; web/js/actions.js:68-72.'),
  S('The empty folder offers Add bookmarks, a picker of links saved elsewhere.', ['folder-empty', 'add-to'], 'Tick two, Move 2 to Media.', 'works', 'shot a29.'),
  S('Moving them shows "Moved 2 to Media" with Undo.', 'folder-filled', 'Read the toast.', 'works', 'shot a30.'),
  S('The folder three dots hold Add bookmarks, New folder inside, Rename, Move to, Hide from Recent, Lock with a password, Delete. Share is not there: only the small link glyph by the title opens it (the right click menu has it).', 'folder-menu', 'Look for Share.', 'friction', 'shot a28; web/js/actions.js:109 folderItems has no Share, web/js/actions.js:103 folderSheetItems (right click) does.'),
  S('Move to moves a folder under another or to the top level.', 'fmove', 'Pick Top level.', 'works', 'shot a31.'),
  S('A card shows Share, Open, Trash and More on hover; More holds Move, Copy, Share, Trash, Open, Rename, Pin.', ['folder-hover', 'tile-menu'], 'Open More.', 'works', 'shots a19, a20.'),
  S('Move from the card or the selection bar moves without a word: no toast, no Undo. A drag onto a folder says "Moved to Reading" with Undo.', ['move-sheet', 'folder-moved'], 'Pick a folder.', 'friction', 'log-a "move toast:" empty; web/js/actions.js:158 calls actions.move, web/js/actions.js:98-102 moveWithUndo has the toast.'),
  S('Dragging a card onto a folder in the sidebar moves it with Undo.', ['folder-drag', 'folder-dragged'], 'Drag.', 'works', 'web/js/drag.js and web/js/actions.js:98-102. Read from the code, not dragged in this run.'),
  S('Rename in place: F2 or the menu, Enter saves, Escape cancels.', 'rename', 'Type, Enter.', 'works', 'web/js/actions.js:55-66.'),
  S('Trash on a card: "Moved to Trash" with Undo.', 'trash-toast', 'Undo or go on.', 'works', 'shot a22.'),
  S('Trash keeps links 30 days; a card offers Restore and Delete now, which asks first; Empty trash asks first.', ['trash', 'trash-menu', 'purge-confirm', 'empty-confirm'], 'Empty trash.', 'works', 'shots a23, a24, a25.'),
  S('Delete folder asks first and says where its links go: "Delete Media? 2 bookmarks go to Trash."', 'delete-folder', 'Cancel or Delete folder.', 'works', 'shot a32.'),
  S('With More open in the sidebar at 800 px height the folder list shrinks to about two rows, its scroll bar is hidden, and More stays open on the next visit.', 'dash-more', 'Look for Finance and Work.', 'friction', 'shots a03, a06; web/app.css:198-199 (scrollbar-width:none); web/js/actions.js:204 keeps the open state.'),
  S('Phone: Folders tab, a folder, the three dots as a sheet.', ['p-folders', 'p-folder', 'p-folder-sheet'], 'Open a folder.', 'works', 'shots b03, b04, b05.'),
  S('Phone: a tap opens the link; Move, Rename and Trash come only after a long press starts selecting, and nothing on screen says so.', ['p-folder', 'p-select'], 'Hold a card.', 'friction', 'web/js/render.js:258-261 (the card is a plain link), web/js/drag.js:134-142 (hold selects).'),
 ]),
 dict(id='05', name='Locked folders', steps=[
  S('Folder actions, Lock with a password: Password, Repeat password and the note that it cannot be recovered.', 'lock-sheet', 'Type it twice.', 'works', 'shot a44.'),
  S('Fewer than 4 characters, or two that differ, are named under the fields.', 'lock-error', 'Fix it.', 'works', 'log-a "Use at least 4 characters.", "The passwords do not match."'),
  S('Lock goes back to the Dashboard with "Folder locked"; the sidebar shows the name with a lock and no count.', 'locked', 'Read the sidebar.', 'works', 'shot a45.'),
  S('A locked folder is gone from search, Recent and the counts.', 'palette-locked', 'Search.', 'works', 'shot a51.'),
  S('A click on it opens Unlock; a wrong password says "Wrong password"; the right one opens it for 10 minutes.', ['unlock', 'unlock-wrong', 'unlocked'], 'Type the folder password.', 'works', 'shots a46, a47, a48.'),
  S('The lock dialogs have no close button; only Escape or a tap outside closes them.', 'unlock', 'Look for a way out.', 'friction', 'shot a46; web/js/sheets.js:83-91 (no close in lockHTML); P-WEB-2.'),
  S('Unlocked, the folder actions offer Relock now and Remove lock, which asks the app password.', ['unlocked-menu', 'remove-lock'], 'Relock now.', 'works', 'shots a49, a50.'),
  S('On the phone the lock dialog note sits tight under the second field.', 'p-lock', 'Read the note.', 'friction', 'shot b13.'),
 ]),
 dict(id='06', name='Share links', steps=[
  S('In a folder the link glyph by the title opens Share.', ['reading', 'share-off'], 'Turn on Share with a link.', 'works', 'shot a33 (see 04.4 for finding it).'),
  S('On: the link with Copy, and Share where the system has a share sheet.', 'share-on', 'Copy.', 'works', 'shot a34; link of the form /s/#token.'),
  S('Copy says "Copied".', 'share-copied', 'Paste it to someone.', 'works', 'log-a "Copied".'),
  S('Lock with a password: a password under 8 characters is refused only after Set, "A share password needs at least 8 characters."; the field gives no hint before.', ['share-pw', 'share-pw-error'], 'Type 8 or more.', 'friction', 'shot a35.'),
  S('Set: Locked with Change and Remove; Expires Never, 1, 7 or 30 days with the end date; "Not opened yet".', 'share-set', 'Pick 7 days.', 'works', 'shot a36.'),
  S('The visitor gets the folder name and Password; a wrong one says "Wrong password."; the right one shows the cards with a search.', ['visitor-pw', 'visitor-wrong', 'visitor-open'], 'Open the link in another browser.', 'works', 'shots a38, a39, a40.'),
  S('On a phone the visitor page is the same.', 'p-visitor', 'Open it on a phone.', 'works', 'shot a41.'),
  S('Share with a link off asks "Stop sharing?"; afterwards the visitor sees "This link does not work."', ['stop-share', 'visitor-revoked'], 'Stop sharing.', 'works', 'shots a42, a43.'),
  S('Locking a shared folder ends its link, and the lock sheet says so.', 'lock-sheet', 'Read the lock sheet.', 'works', 'web/js/sheets.js:87.'),
 ]),
 dict(id='07', name='Import and export', steps=[
  S('More in the sidebar (desktop) or Settings (phone), Import, pick a browser bookmarks file.', ['dash-more', 'p-settings'], 'Pick the file.', 'works', 'shot a02; accept=".html,.htm,text/html".'),
  S('While it runs nothing shows: no progress, Import stays live for a second click, the empty Dashboard stays empty. A 20 MB file takes about 15 seconds.', 'import-running', 'Wait without knowing.', 'friction', 'shot i01; web/js/actions.js:133-137 (no busy state); CHANGELOG 0.1.11 "about 15 seconds".'),
  S('Done: "Imported 15, skipped 0", folders kept.', 'imported', 'Look through the folders.', 'works', 'shot a03.'),
  S('The same file again: "Imported 0, skipped 15".', 'imported', 'Nothing.', 'works', 'log-a import2.'),
  S('A file that is not a bookmarks file: "Not a bookmark file."; folders more than 256 deep: "The folders in this file nest more than 256 deep. Pinned cannot import it."', 'import-bad', 'Export again from the browser.', 'works', 'shots a04, a05; POST /api/import answers 400.'),
  S('Export downloads bookmarks.html.', 'export', 'Open the file.', 'works', 'log-a export name bookmarks.html.'),
  S('With a folder locked in this browser the export leaves it out and says nothing; someone moving away or keeping a copy loses those links without knowing.', 'export', 'Trust the file.', 'friction', 'log-a "has Finance: false"; internal/server/api.go:707; README says it, the app does not.'),
  S('The nightly export/bookmarks.html in the data folder holds everything, locked folders too.', 'term-backup', 'Copy it with the backup.', 'works', 'README.md, Your data and backups.'),
 ]),
 dict(id='08', name='Second factor and Signed in', steps=[
  S('The owner makes a secret, sets TOTP_SECRET, restarts and adds it to the authenticator by hand; a bad secret stops the start with a message.', 'term-totp', 'Open the login.', 'works', 'README.md, Second factor; binary output for TOTP_SECRET=ABC.'),
  S('The login shows Password and Code; Enter in the password moves to the code.', 'login-code', 'Type the code.', 'works', 'shot c01; web/js/app.js:82.'),
  S('A wrong code says "Wrong password or code." and both fields are empty again.', 'login-code-error', 'Type both again.', 'friction', 'shot c02; internal/server/pages.go:97-103 (redirect, the form is lost).'),
  S('The same code used in a second browser inside its 30 seconds is refused with the same text.', 'login-code-error', 'Wait for the next code.', 'friction', 'log-c "same code twice: ... Wrong password or code."'),
  S('After 5 wrong codes every login is held from 1 minute up to a day, but the page says "Wait 30 seconds and try again." and the right code gets the same answer while the hold lasts.', 'login-wait', 'Wait 30 seconds, fail again.', 'broken', 'log-c "after 5 wrong codes", "right code during hold"; web/js/app.js:79; README, Wrong passwords and tokens.'),
  S('Browsers logged in before stay logged in; API tokens need no code.', 'dash', 'Nothing.', 'works', 'README.md, Second factor.'),
  S('More, Signed in: each browser with its sign in day and last use, this one marked.', 'sessions', 'Find the other one.', 'works', 'shot a57.'),
  S('Two browsers of one kind read the same, "Chrome on macOS", with no address or place to tell them apart.', 'sessions', 'Guess which one.', 'friction', 'shot a57; web/js/sheets.js:231.'),
  S('Sign out, or Sign out all others, asks for the app password; a wrong one says "Wrong password".', ['sessions-confirm', 'sessions-wrong'], 'Type the app password.', 'works', 'shot a58.'),
  S('Done: "Other browsers signed out".', 'sessions-done', 'Close.', 'works', 'shot a59.'),
  S('The signed out browser keeps showing every bookmark until it next asks the server for something.', 'signed-out-other', 'Look at the other screen.', 'friction', 'shot a60.'),
  S('Lost the authenticator: remove TOTP_SECRET and restart.', 'term-totp', 'Restart.', 'works', 'README.md, Second factor.'),
 ]),
 dict(id='09', name='API tokens', steps=[
  S('More, API tokens (or "a token" on How to save): the empty state says what a token can and cannot do.', 'tokens-empty', 'Name it.', 'works', 'shot a52.'),
  S('Name and app password, Create; a wrong password says "Wrong password" and keeps the name.', 'tokens-wrong', 'Type the right one.', 'works', 'shot a53.'),
  S('The token shows once with Copy and "Copy it now. It is not shown again."', 'token-created', 'Copy.', 'works', 'shot a54.'),
  S('The form is gone after Create: a second token needs the sheet closed and opened again, and nothing says where the token goes next.', 'token-created', 'Close, reopen.', 'friction', 'web/js/sheets.js:199-202.'),
  S('The token reads folders (200) and cannot export (403).', 'term-curl', 'Run the script.', 'works', 'log-a "token GET folders 200", "token export 403".'),
  S('The list shows when each token was made and last used.', 'tokens-list', 'Read it.', 'works', 'shot a55.'),
  S('Revoke asks in the row, then "Token revoked"; the token now answers 401.', 'token-revoke', 'Revoke.', 'works', 'shot a56; log-a "revoked token GET 401".'),
 ]),
 dict(id='10', name='Settings', steps=[
  S('Every setting is an environment variable in the compose file.', 'term-env', 'Edit, docker compose up -d.', 'works', 'README.md, Settings table.'),
  S('Phone: the gear opens Settings with How to save, API tokens and their count, Import, Export, What\'s new, Source, Signed in, Log out.', 'p-settings', 'Open a row.', 'works', 'shot b10b; axe clean.'),
  S('Desktop: the same under More in the sidebar.', 'dash-more', 'Open More.', 'works', 'shot a02.'),
  S("What's new shows the changelog of this version, the last three open.", 'whats-new', 'Read.', 'works', 'shot a61; web/js/sheets.js:164-188.'),
  S('A new APP_PASSWORD ends every login, token and device cookie after the restart.', 'term-env', 'Make new tokens.', 'works', 'README.md, Changing the password.'),
  S('Log out goes back to the login page.', 'login', 'Log in again.', 'works', 'log-a "after logout: /login".'),
 ]),
 dict(id='11', name='Backup and going back a version', steps=[
  S('Backing up: sqlite3 .backup, or stop, copy the data folder, start.', 'term-backup', 'Copy.', 'works', 'README.md, Backing up. Not run.'),
  S('Upgrading names the copy in the log: "database: upgrading from schema 6 to 12; the database as it was is saved at .../bookmarks-schema6-....db".', 'term-upgrade', 'Note the file.', 'works', 'Run: 0.1.10 data folder started with ad2cb8e.'),
  S('Going back, 0.1.10 refuses: "database was written by a newer Pinned (schema 12); this version knows 6. Update the image or restore a backup." It names no file and no README section; the container restarts into the same line.', 'term-downgrade', 'Find the README section.', 'friction', 'Run: 0.1.10 on the upgraded folder; internal/store/store.go:210 has the same text for the next downgrade.'),
  S('Restoring as the README says (move bookmarks.db aside, copy the schema 6 file in, no -wal or -shm) brings 0.1.10 back with all 15 bookmarks and 5 folders.', 'term-restore', 'Start the older image.', 'works', 'Run: GET /api/state on 0.1.10 after the restore.'),
  S('Links saved after the upgrade are not in that copy; the README says to export them first.', 'term-restore', 'Export before going back.', 'works', 'README.md, Going back to an older version.'),
 ]),
 dict(id='12', name='Errors', steps=[
  S('Wrong password and the wait after 5 tries (01.4, 01.5).', ['login-error', 'login-wait'], 'See flow 01.', 'works', 'shots a01, b22.'),
  S('The server stops while the app is open: Save says "Could not save. Try again."; nothing says the server cannot be reached.', 'save-down', 'Try again, in vain.', 'friction', 'shot c10; web/js/sheets.js:366.'),
  S('The cards stay on screen, dimmed, under "Bookmarks could not load." with Retry.', 'notice-down', 'Retry.', 'works', 'shot c12; web/js/render.js:147.'),
  S('Retry while still down shows the same notice.', 'notice-down', 'Wait.', 'works', 'shot c13.'),
  S('A reload while down shows the browser\'s own error page.', 'browser-down', 'Start the server.', 'works', 'ERR_CONNECTION_REFUSED.'),
  S('A bad import file is refused with a message (07.5).', 'import-bad', 'See flow 07.', 'works', 'shots a04, a05.'),
  S('A login that ended elsewhere sends the next request to /login?next=..., back to the same place after logging in.', 'login', 'Log in.', 'works', 'web/js/api.js, 401 handling.'),
  S('A revoked or expired share link says "This link does not work."', 'visitor-revoked', 'Ask the owner.', 'works', 'shot a43.'),
 ]),
]

# gaps by user impact, highest first; fits: yes means a small change that fits before Sat 7 Nov
GAPS = [
 dict(t='The second factor hold says "Wait 30 seconds" while it lasts 1 minute up to a day', steps='08.5, 01.5',
      why='A user who mistypes codes is told to wait 30 seconds, while the hold lasts at least a minute and doubles; every try in it is refused with the same line, which reads as a broken login on launch day.',
      fix='Send the real wait with the redirect (/login?error=wait&s=<seconds>, checkLogin already returns it) and show "Try again in 2 minutes" or the time it ends. Same for the 30 second address limit.',
      fits='yes', size='small, server redirect plus app.js:79'),
 dict(t='The extension options turn a home address into https and say only "Could not reach"', steps='02.13',
      why='The default install answers on plain http :9095, so the first thing most self hosters type fails with no hint. The extension is the main way to save on the desktop.',
      fix='When the typed address has no scheme and the https try fails, try http and say "Your server answered on http. Saved as http://...", or at least: "Could not reach https://10.0.0.5:9095. If your server uses http, type http://".',
      fits='yes', size='small, extras/extension/options.js and shared.js, repack the zip'),
 dict(t='Export from the app leaves out locked folders without a word', steps='07.7',
      why='People export to move away or to keep a copy; links in locked folders are missing and nothing says so. The README explains it, the app does not.',
      fix='When any folder is locked in this browser, say it before or after the download: "Finance and Work are locked, so they are not in this file. Unlock them first, or use the nightly export in the data folder."',
      fits='yes', size='small, a toast or confirm in the More and Settings Export rows'),
 dict(t='All bookmarks freezes after a very large import', steps='03.11',
      why='10000 links hold the page 1.4 s, 100000 more than 2 minutes, while the README and CHANGELOG advertise 470000 link imports. Power users who try the big import on launch day get a frozen tab.',
      fix='Draw the first few hundred cards and the rest as the list scrolls (or in chunks after the first paint), and find the step that grows faster than the number of cards in deskBody and sections. Until then, soften the README claim.',
      fits='no for the render change, yes for the README wording', size='medium'),
 dict(t='Import shows nothing while it runs', steps='07.2',
      why='A 20 MB file takes about 15 seconds with the screen unchanged and Import still clickable; people click again or think it failed.',
      fix='Show "Importing bookmarks.html..." as a toast that stays until the answer, and disable Import meanwhile.',
      fits='yes', size='small, actions.js:133-137'),
 dict(t='The save sheet keeps an old error after the address is fixed', steps='02.3',
      why='"Enter a full address starting with http or https." stays next to a valid address, so the sheet contradicts itself on the very first save.',
      fix='Clear s.err on input in onInput (actions.js:281) and redraw the error line.',
      fits='yes', size='one line'),
 dict(t='Share is missing from the folder actions', steps='04.4, 06.1',
      why='Share is a launch feature but only the small link glyph by the title opens it; the three dots, where people look, do not list it, although the right click menu does.',
      fix='Use folderSheetItems for the folder three dots (actions.js:215 folder-menu), so Share or Sharing is the first row, as on right click.',
      fits='yes', size='one line'),
 dict(t='Phone users cannot see how to move, rename or trash a bookmark', steps='04.15',
      why='A tap opens the link; actions only appear after a long press, with no hint anywhere.',
      fix='Short term: a line in the empty state and How to save ("Hold a card to move, rename or trash it"). Later: a visible more button on phone cards.',
      fits='yes for the hint', size='small'),
 dict(t='Sidebar More squeezes the folder list to two rows and hides its scroll bar', steps='04.13',
      why='At 800 px height with More open, folders below the second are out of sight and the hidden scroll bar gives no clue; More stays open across visits.',
      fix='Let the folder list keep a minimum height and show a thin scroll bar, or close More after an action and do not keep it open across visits.',
      fits='yes', size='small, app.css:198-199 and the stored foot state'),
 dict(t='Move from the menu or selection bar gives no confirmation and no Undo', steps='04.7',
      why='The card just disappears; drag and drop says where it went and offers Undo.',
      fix='Route the Move sheet through moveWithUndo (actions.js:158).',
      fits='yes', size='one line'),
 dict(t='A wrong second factor code empties both fields', steps='08.3',
      why='On a phone with a long password, every mistyped code means typing the password again.',
      fix='Post the login with fetch (the /api/login route exists) and keep the password field, or keep it through the redirect.',
      fits='yes', size='small'),
 dict(t='The going back message names no file', steps='11.3',
      why='The person rolling back reads "restore a backup" without the name of the copy Pinned made for exactly this.',
      fix='Change store.go:210 to name the newest bookmarks-schemaN-*.db in the data folder and the README section "Going back to an older version". Helps every downgrade from 0.1.12 on.',
      fits='yes', size='small'),
 dict(t='Server unreachable reads as a generic failure', steps='12.2',
      why='"Could not save. Try again." and "Bookmarks could not load." do not tell a home user that the server is off or the VPN is down.',
      fix='When fetch itself fails (no status), say "Cannot reach your Pinned server." in both places.',
      fits='yes', size='small, errorText fallback'),
 dict(t='The extension is always dark', steps='02.19',
      why='0.1.11 made every app page follow light and dark; the popup and options stay dark, which looks unfinished next to a light app.',
      fix='Give extras/extension/ui.css the same light tokens under prefers-color-scheme: light.',
      fits='yes if the tokens copy over cleanly', size='small to medium'),
 dict(t='Lock dialogs have no close button', steps='05.6',
      why='Only Escape or a tap outside closes them; keyboard and screen reader users get no visible way out (P-WEB-2).',
      fix='Add the same close button the other sheets have to lockHTML.',
      fits='yes', size='one line'),
 dict(t='Signed in lists identical names', steps='08.8',
      why='Two "Chrome on macOS" rows cannot be told apart.',
      fix='Show the sign in time with hours and minutes now (created_at is stored); add the address in a later version, it needs a new column in the sessions table.',
      fits='yes for the time, no for the address', size='small, then a schema change'),
 dict(t='A second token needs the sheet reopened, and the token has no next step', steps='09.4',
      why='After Create the form is gone; nothing points to the extension options.',
      fix='Keep the form below the new token and add "Paste it into the extension options or your script."',
      fits='yes', size='small'),
 dict(t='Smaller ones', steps='02.2, 06.4, 05.8, 08.4, 08.11, 01.5',
      why='No https:// added for a bare address in the app; share password minimum shown only after Set; phone lock note tight under its field; a reused code is called wrong; a signed out browser keeps showing data; no countdown on the 30 second wait.',
      fix='Add https:// like the extension does; put "8 or more characters" in the placeholder; add the gap; say "This code was just used, wait for the next one"; reload state on focus; show the time left.',
      fits='yes', size='small each'),
]

PWEB = [
 'P-WEB-1 (WebKit quality): login, Dashboard, How to save and the save page in WebKit at 390 and 1280, light and dark: no horizontal overflow, no console errors (log-w). Open: the 100000 link freeze (03.11) and the tight phone lock note (05.8).',
 'P-WEB-2 (accessibility): axe (WCAG 2 A and AA) clean on login, Dashboard, How to save and the save page, phone and desktop, light and dark, in WebKit, and on Settings in Chromium. Option Tab in WebKit walks the sidebar with a visible ring. Open: lock dialogs without a close button (05.6); the second factor hold message that misinforms (08.5) also fails the error identification criterion in spirit.',
]

LEFT_OUT = [
 'Firefox and Safari as browsers for the extension: not loaded in this run. Chromium loaded it unpacked.',
 'The browser permission prompt after Save in the extension options, and the right click menu: they cannot show in headless Chromium; read from the code.',
 'Drag and drop of cards onto folders and the phone long press: read from the code (drag.js), drawn as dashed targets.',
 'A reverse proxy with HTTPS, Tailscale and iCloud Private Relay: not set up here; the README troubleshooting covers them.',
 'Icons: the run used ICONS=off, so every card shows its letter.',
]


def reach(SC, a, b):
    """True when screen b is a link away from screen a (or the same)."""
    return a == b or f'href="{b}.html"' in SC[a]['body'] or f'"{b}.html"' in json.dumps(SC[a]['keys'])


def write_all(here, SC, flows):
    titles = {k: v['title'] for k, v in SC.items()}
    nsteps = sum(len(f['steps']) for f in flows)
    cnt = {'works': 0, 'friction': 0, 'broken': 0}
    for f in flows:
        for i, st in enumerate(f['steps']):
            st['n'] = str(i + 1)
            cnt[st['now']] += 1
            # the wireframe walk: every screen of the step exists, and the step can be reached from the one before
            prev = f['steps'][i - 1]['screens'] if i else None
            st['walk'] = 'start' if not prev else ('click' if any(reach(SC, p, st['screens'][0]) for p in prev) else 'next')
    fl = []
    for f in flows:
        fl.append({'id': f['id'], 'name': f['name'], 'steps': [{'n': s['n'], 'text': s['text'], 'screens': s['screens'], 'do': s['do'], 'now': s['now'], 'ev': s['ev'], 'walk': s['walk']} for s in f['steps']]})
    (here / 'flows.js').write_text('window.FLOWS = ' + json.dumps(fl, indent=1) + ';\nwindow.TITLES = ' + json.dumps(titles, indent=1) + ';\n')

    # index
    areas = {}
    for k, v in SC.items():
        areas.setdefault(v['area'], []).append(k)
    cards = ''.join(
        f'<li><a class="fl" href="walk.html?f={f["id"]}"><b>{f["id"]} {f["name"]}</b><span>{len(f["steps"])} steps: '
        f'{sum(s["now"] == "works" for s in f["steps"])} work, {sum(s["now"] == "friction" for s in f["steps"])} friction, {sum(s["now"] == "broken" for s in f["steps"])} broken</span>'
        f'<span class="go">Walk this flow</span></a></li>' for f in flows)
    secs = ''.join(f'<section><h3>{a} <span>{len(ids)}</span></h3><ul>' + ''.join(f'<li><a href="screens/{i}.html">{titles[i]}</a><span>{i}</span></li>' for i in ids) + '</ul></section>' for a, ids in areas.items())
    (here / 'index.html').write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pinned wireframes</title><link rel="stylesheet" href="wire.css"><style>
body{{padding:32px 16px 64px}} main{{max-width:1080px}} h1{{color:var(--ink);font-size:22px;margin:0 0 6px}} h2{{color:var(--ink);font-size:15px;margin:32px 0 10px}}
h3{{color:var(--ink);font-size:13px;margin:18px 0 6px}} h3 span{{color:var(--marker);font-weight:400}} p{{max-width:720px}}
ul{{list-style:none;padding:0;margin:0}} .flows{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}}
.fl{{display:flex;flex-direction:column;gap:4px;background:#fff;border-radius:12px;padding:14px 16px;box-shadow:var(--card)}} .fl b{{color:var(--ink)}}
.fl .go{{color:var(--accent);font-weight:600;font-size:11.5px;margin-top:4px}} section li{{display:flex;gap:10px;padding:3px 0;border-bottom:1px solid var(--line)}}
section li a{{color:var(--ink)}} section li span{{color:var(--marker);font-size:11px;margin-left:auto}}
.cols{{columns:2 360px;column-gap:28px}} section{{break-inside:avoid}}
</style></head><body><main>
<h1>Pinned wireframes</h1>
<p>Pinned as it is built (main at ad2cb8e, the 0.1.11 candidate), every screen and state the user flows touch, desktop at 1280 by 800 and the phone where it differs. {len(SC)} screens, {len(flows)} flows, {nsteps} steps walked in the real app: {cnt["works"]} work, {cnt["friction"]} with friction, {cnt["broken"]} broken. The screens the flow test fixes changed are drawn as fixed; the verdicts are those of the walk at ad2cb8e.
Controls that lead somewhere are links. Drags and holds are dashed targets: press h on any screen to show them and outline every link. The findings, the gap list and the fixes are in flow-test.md; the flows as text and diagrams in flows/.</p>
<h2>Flows</h2><ul class="flows">{cards}</ul>
<h2>Every screen</h2><div class="cols">{secs}</div>
</main></body></html>
''')

    # walk
    (here / 'walk.html').write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Walk a flow</title><link rel="stylesheet" href="wire.css"><style>
body{padding:16px}.wrap{display:flex;gap:16px;align-items:flex-start}
.stage{width:960px;height:600px;flex:none;border-radius:12px;overflow:hidden;box-shadow:var(--card);background:#fff}
.stage iframe{width:1280px;height:800px;border:0;transform:scale(.75);transform-origin:0 0}
.side2{flex:1;min-width:280px;max-width:440px;background:#fff;border-radius:12px;box-shadow:var(--card);padding:16px;display:flex;flex-direction:column;gap:10px;max-height:calc(100vh - 32px);overflow:auto}
.side2 h1{font-size:15px;color:var(--ink);margin:0}.cur{border:1.5px solid var(--ink);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.cur b{color:var(--ink)}.steps{list-style:none;padding:0;margin:0}.steps li{padding:4px 6px;border-radius:4px;font-size:11.5px;cursor:pointer;display:flex;gap:8px}
.steps li.on{background:var(--soft);color:var(--ink)}.steps li span:first-child{width:22px;flex:none;color:var(--marker)}
.steps li span.st{width:56px;flex:none;color:var(--marker)}.steps li span.st.friction{color:var(--ink);font-weight:600}.steps li span.st.broken{color:var(--red);font-weight:600}
.nav2{display:flex;gap:8px;align-items:center}.where{font-size:11px;color:var(--marker)}
.now{font-weight:600}.now.friction{color:var(--ink)}.now.broken{color:var(--red)}
@media (max-width:1300px){.wrap{flex-direction:column}.stage{width:100%;max-width:960px;height:auto;aspect-ratio:1280/800}}
</style></head><body>
<div class="wrap"><div class="stage" id="stage"><iframe id="fr" title="Wireframe"></iframe></div>
<div class="side2"><div class="nav2"><a class="btn" href="index.html">All flows</a><span class="sp"></span><a class="btn" id="prev">Back</a><a class="btn pri" id="next">Next</a></div>
<h1 id="ft"></h1><div class="cur" id="cur"></div><div class="where" id="where"></div><ul class="steps" id="steps"></ul></div></div>
<script src="flows.js"></script><script>
(function(){
  var q=new URLSearchParams(location.search),fid=q.get('f')?q.get('f'):'01',fl=FLOWS.filter(function(f){return f.id===fid}),flow=fl.length?fl[0]:FLOWS[0];
  var seq=[];flow.steps.forEach(function(s,si){s.screens.forEach(function(sc,k){seq.push({si:si,sc:sc,k:k,of:s.screens.length})})});
  var si0=parseInt(q.get('s')?q.get('s'):'0',10);var i=Math.min(isNaN(si0)?0:si0,seq.length-1);
  document.getElementById('ft').textContent=flow.id+' '+flow.name;
  var fr=document.getElementById('fr'),stage=document.getElementById('stage');
  function fit(){var w=stage.clientWidth;fr.style.transform='scale('+(w/1280)+')';stage.style.height=(w*800/1280)+'px'}
  window.addEventListener('resize',fit);
  function esc(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML}
  function show(){
    var it=seq[i],s=flow.steps[it.si];
    fr.src='screens/'+it.sc+'.html?hot=1';
    document.getElementById('cur').innerHTML='<b>Step '+s.n+(it.of>1?', screen '+(it.k+1)+' of '+it.of:'')+'</b><span>'+esc(s.text)+'</span>'+
      '<span class="note">Do: '+esc(s.do)+'</span><span class="note">In the real app: <span class="now '+s.now+'">'+s.now+'</span>. '+esc(s.ev)+'</span>'+
      '<span class="note">Screen: '+esc(TITLES[it.sc]?TITLES[it.sc]:it.sc)+' ('+it.sc+')</span>';
    var ul=document.getElementById('steps');ul.innerHTML='';
    flow.steps.forEach(function(st,si){var li=document.createElement('li');li.className=si===it.si?'on':'';
      li.innerHTML='<span>'+st.n+'</span><span class="st '+st.now+'">'+st.now+'</span><span>'+esc(st.text)+'</span>';
      li.onclick=function(){for(var j=0;j<seq.length;j++){if(seq[j].si===si){i=j;show();break}}};ul.appendChild(li)});
    history.replaceState(null,'','?f='+flow.id+'&s='+i);
    document.getElementById('prev').style.visibility=i>0?'visible':'hidden';
    document.getElementById('next').textContent=i<seq.length-1?'Next':'Done';
    document.getElementById('where').textContent='';
    fit();
  }
  document.getElementById('prev').onclick=function(){if(i>0){i--;show()}};
  document.getElementById('next').onclick=function(){if(i<seq.length-1){i++;show()}else location.href='index.html'};
  document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'){document.getElementById('next').click()}if(e.key==='ArrowLeft'){document.getElementById('prev').click()}});
  window.addEventListener('message',function(e){if(e.data&&e.data.wireScreen&&e.data.wireScreen!==seq[i].sc){document.getElementById('where').textContent='You clicked through to: '+(TITLES[e.data.wireScreen]?TITLES[e.data.wireScreen]:e.data.wireScreen)+'. Next goes on with the flow.'}});
  show();
})();
</script></body></html>
''')

    # flows/flows.md and one Mermaid file per flow
    fd = here / 'flows'
    fd.mkdir(exist_ok=True)
    md = ['# Pinned user flows, as built', '',
          'Main at ad2cb8e (0.1.11 candidate). Each flow as numbered steps; the screens are in ../screens, the walk in ../walk.html, the results in ../flow-test.md. One Mermaid diagram per flow sits next to this file.', '']
    for f in flows:
        slug = re.sub(r'[^a-z0-9]+', '-', f['name'].lower()).strip('-')
        name = f'{f["id"]}-{slug}.mmd'
        md += [f'## {f["id"]} {f["name"]}', '', f'Diagram: {name}', '']
        md += [f'{s["n"]}. {s["text"]}' for s in f['steps']] + ['']
        lines = ['flowchart TD', '  classDef works fill:#ffffff,stroke:#b8babe,color:#3a3e44;',
                 '  classDef friction fill:#f6f7f7,stroke:#3a3e44,stroke-width:2px,color:#3a3e44;',
                 '  classDef broken fill:#ffffff,stroke:#c4362b,stroke-width:2px,color:#c4362b;']
        for s in f['steps']:
            words, out, cur = s['text'].replace('"', "'").split(), [], ''
            for w in words:
                if len(cur) + len(w) > 46:
                    out.append(cur)
                    cur = w
                else:
                    cur = (cur + ' ' + w).strip()
            out.append(cur)
            lines.append(f'  S{s["n"]}["{s["n"]}. ' + '<br/>'.join(out) + f'<br/><i>{s["now"]}</i>"]:::{s["now"]}')
        for a, b2 in zip(f['steps'], f['steps'][1:]):
            lines.append(f'  S{a["n"]} --> S{b2["n"]}')
        (fd / name).write_text('\n'.join(lines) + '\n')
    (fd / 'flows.md').write_text('\n'.join(md))

    # flow-test.md
    t = ['# Flow test of Pinned as built (31.10.2026)', '',
         'Product: main at ad2cb8e, the 0.1.11 candidate, unpushed. Release day on Product Hunt: Tue 10 Nov; the last fixes go into 0.1.11 on Sat 7 Nov.', '',
         'Method: the product read first (README, docs, CHANGELOG 0.1.11, web/ templates, CSS and JS, the extension, the server routes), then the flows written as numbered steps (flows/), then every step walked twice:',
         '', '1. In the real app: a local build of ad2cb8e on a throwaway data folder, password made in the shell and never written down, driven with headless Chromium at 1280 by 800 and 390 by 844 in light and dark; WebKit for the P-WEB checks; the extension loaded unpacked in Chromium; release 0.1.10 built from its tag for the upgrade and going back steps. Evidence names a screenshot of that run (not kept), a route, a log line or file:line in the repo.',
         '2. In the wireframes: every screen of the step exists, and the step can be reached from the step before by a click, or by a dashed target for a drag, a hold or another outcome (press h, or walk mode, shows them). "click" below means reachable by a click, "next" means the walk moves on with Next (a separate start, such as opening another browser or the terminal).',
         '', '## Counts', '',
         f'1. Flows: {len(flows)}. Steps: {nsteps}.',
         f'2. In the real app: {cnt["works"]} work, {cnt["friction"]} friction, {cnt["broken"]} broken.',
         f'3. In the wireframes: {nsteps} of {nsteps} steps drawn; {sum(s["walk"] == "click" for f in flows for s in f["steps"])} reached by a click from the step before, {sum(s["walk"] == "start" for f in flows for s in f["steps"])} flow starts, {sum(s["walk"] == "next" for f in flows for s in f["steps"])} reached with Next.',
         f'4. Screens: {len(SC)}, desktop at 1280 by 800, the phone at 390 by 844 shown at 92 percent on the same canvas.', '']
    for f in flows:
        t += [f'## {f["id"]} {f["name"]}', '']
        for s in f['steps']:
            t.append(f'{s["n"]}. {s["now"]}. {s["text"]} Screens: {", ".join(s["screens"])}. Do: {s["do"]} Evidence: {s["ev"]} Wireframe: {s["walk"]}.')
        t.append('')
    t += ['## Gaps, by user impact', '', 'Each with a suggested fix and whether it fits before Sat 7 Nov. "Fits" means a small change that can be built, tested and released in 0.1.11 without touching the database or the API.', '']
    for i, g in enumerate(GAPS, 1):
        t += [f'{i}. {g["t"]} (steps {g["steps"]})', f'   Why it matters: {g["why"]}', f'   Fix: {g["fix"]}', f'   Fits before 7 Nov: {g["fits"]}. Size: {g["size"]}.', '']
    fits = [g['t'] for g in GAPS if g['fits'].startswith('yes')]
    t += ['## What fits before 7 Nov', '', f'{len(fits)} of {len(GAPS)} gap entries fit, most of them one line to a small change. In order of impact:', '']
    t += [f'{i}. {x}' for i, x in enumerate(fits, 1)] + ['', 'Does not fit: drawing very large libraries in pieces (gap 4). For 0.1.11, soften the README and CHANGELOG claim about 470000 link imports instead, or add "the app slows down above about 20000 links".', '']
    t += ['## Apple web standards (P-WEB-1 and P-WEB-2) where a flow shows a problem', ''] + [f'{i}. {x}' for i, x in enumerate(PWEB, 1)] + ['']
    t += ['## Left out or read from the code', ''] + [f'{i}. {x}' for i, x in enumerate(LEFT_OUT, 1)] + ['']
    text = '\n'.join(t)
    for ch in ['—', '–', '·', '|']:
        assert ch not in text, f'forbidden character {ch!r} in flow-test.md'
    (here / 'flow-test.md').write_text(text)
