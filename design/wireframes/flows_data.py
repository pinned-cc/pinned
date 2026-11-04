"""The user flows of Pinned as built, each step with its screens, what the user does, and what the
flow test found in the real running app (works, friction, broken) with the evidence.

Pinned 0.1.12 as built on the release-0.1.12 branch from a1fe24b. Every step was walked on 31.10.2026
against ad2cb8e (the 0.1.11 candidate) and again on 04.11.2026 against the tag v0.1.11, headless
Chromium (desktop 1280 by 800, phone 390 by 844, light and dark), WebKit for the P-WEB checks, the
extension loaded unpacked in Chromium. A step text and its verdict are those of the walk of 04.11
("FT 04.11" in the evidence, with its screenshot names), and for the steps 0.1.12 changes (02.13,
05.1, 05.8, 10.4, 12.3) the 0.1.12 build and the test that proves it. Evidence without "FT 04.11"
names a screenshot of the run of 31.10 (not kept), a route, or file:line in the repo.
flow-test.md is the record of the flow test of 31.10.2026; it is no longer written by build.py.
"""
import json
import re


def S(text, screens, do, now, ev, note=''):
    return dict(text=text, screens=screens if isinstance(screens, list) else [screens], do=do, now=now, ev=ev, note=note)


FLOWS = [
 dict(id='01', name='First start and login', steps=[
  S('The owner starts the container with a password: APP_PASSWORD=... docker compose up -d.', 'term-start', 'Read the log line, then open the address.', 'works', 'README.md, Install in five minutes; log "pinned listening on :8080, data in /data".'),
  S('Without a password, with fewer than 8 characters, or with a common one, the server does not start and says why.', 'term-start-error', 'Set another password.', 'works', 'Binary output: "APP_PASSWORD is not set. Set it, or APP_PASSWORD_FILE ...", "APP_PASSWORD is shorter than 8 characters ..." and, for Pinned2026! or password123, "APP_PASSWORD is too easy to guess ..." (FT 04.11).'),
  S('Opening the app without a login goes to the login page.', 'login', 'Type the password.', 'works', 'GET / answers with /login?next=%2F (Chromium, all four sizes and themes).'),
  S('A wrong password comes back with "Wrong password." and the caret in the field.', 'login-error', 'Type it again.', 'works', 'shot a01; /login?error=1; web/js/app.js:79.'),
  S('The fifth wrong try says "Wrong password. Wait 30 seconds before the next try.", the next one "Too many tries. Wait 30 seconds, then try again.", and the right password during the wait names the time left, such as "Wait 26 seconds". The line does not count down.', 'login-wait', 'Wait, then log in.', 'friction', 'shot f01-05-login-wait (FT 04.11); web/js/app.js:79-84.'),
  S('The right password lands on the empty Dashboard with Add bookmark, Import and How to save.', 'dash-empty', 'Pick a way to fill it.', 'works', 'shot home-empty-desk-light.'),
  S('On the phone the same login, then Dashboard, Inbox and Folders tabs, the Settings gear, the search pill and the plus.', ['p-login', 'p-dash-empty'], 'Log in on the phone.', 'works', 'shot home-empty-phone-dark; axe clean on login and Dashboard (phone).'),
  S('Light and dark follow the system; the bulb switches and the choice is kept per browser.', 'dash', 'Click the bulb.', 'works', 'web/js/theme.js:3-20; shots b18 (dark desktop), b21 (dark phone); WebKit dark: no overflow, axe clean.'),
  S('Password managers fill the login: the form carries a fixed user name.', 'login', 'Let the password manager fill it.', 'works', 'web/login.html, hidden username field with autocomplete="username".'),
 ]),
 dict(id='02', name='Save a link, in the app, with the bookmarklet and with the extension', steps=[
  S('Add (desktop) or the plus (phone) opens the save sheet, the folder preset to the last one used.', ['add-sheet', 'p-add'], 'Paste an address.', 'works', 'shots a10, b08; web/js/sheets.js:304-327.'),
  S('An address typed without http, such as example.com, is refused on Save with "Enter a full address starting with http or https.", the caret at the end of the address. The extension options try https, then http.', 'add-noscheme', 'Type http:// in front.', 'friction', 'shot f02-02-add-noscheme (FT 04.11); compare extras/extension/shared.js addressCandidates.'),
  S('Typing the address again removes the old error at once; the live check alone says the link is new or already saved.', 'add-stale', 'Save.', 'works', 'shot f02-03-04-add-dupe (FT 04.11); web/js/actions.js:291-295.'),
  S('An address already saved shows "Already saved in Homelab. Save anyway moves it here." and the button turns into Save anyway.', 'add-dupe', 'Save anyway, or close.', 'works', 'shot a12; GET /api/check.'),
  S('The same host on another port is a new bookmark: Not saved yet.', 'add-newport', 'Give it a title.', 'works', 'log-a: Jellyfin on :8096 next to :8080 saved as new.'),
  S('Choose another folder lists every folder and New folder.', 'add-picker', 'Pick a folder.', 'works', 'shot a13.'),
  S('Save closes the sheet and the card appears in its folder. No toast; screen readers hear "Saved in Homelab".', 'folder-saved', 'Find the new card.', 'works', 'shot a14; web/js/sheets.js:368-373.'),
  S('Bookmarklet: How to save, Computer, drag Save to Pinned into the bookmarks bar.', 'howto-computer', 'Drag the button.', 'works', 'shot a62; /bookmarklet; axe clean desktop and phone.'),
  S('On any page Save to Pinned opens /save in a small window with title, address, recent folders and Log out.', ['browser-page', 'save-page'], 'Check the folder, Save.', 'works', 'shot a64; WebKit desktop and phone: no overflow, no console errors.'),
  S('Saving draws a tick and closes the window; where the browser keeps it open, a Saved state with Done.', 'save-done', 'Done.', 'works', 'shot a65; web/js/sheets.js:371-383.'),
  S('Extension: How to save, Extension: download, unzip, load unpacked; "a token" opens API tokens. Firefox removes it when it quits, so after a restart it is loaded again with a new token.', 'howto-extension', 'Download, load, then follow a token.', 'works', 'shot f02-11-howto-extension (FT 04.11); web/bookmarklet.html.'),
  S('With a token made (flow 09), the extension options take the address and the token.', 'ext-options', 'Type the address.', 'works', 'shot e02.'),
  S('A home address typed as most people write it, 10.0.0.5:9095, tries https, then http, and Test says "Connected to http://10.0.0.5:9095, 5 folders." An address typed with http:// for a host outside the own network first says "On plain http your token may cross the internet unencrypted. Use https, or click Test again to connect anyway." (Save: "click Save again to save anyway") and goes ahead on a second click of the same button.', ['ext-options-ok', 'ext-options-plain'], 'Click again, or type https.', 'works', 'shot f02-13-ext-options-noscheme (FT 04.11); the warning from 0.1.12: extras/extension/options.js holdForPlain, tools/extension.test.mjs.'),
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
  S('After a very large import, All bookmarks draws the first 240 cards with "Show all 100000" in under a second; Show all and scrolling keep every frame short, and the search finds any link.', 'all-big', 'Show all, or search.', 'works', 'shots f03-11-all-big, f03-11-all-big-showall (FT 04.11): 100000 links drawn in 919 ms, longest frame 83 ms, after Show all 142 ms.'),
 ]),
 dict(id='04', name='Organise folders', steps=[
  S('The plus next to Folders, or N, opens New folder; Create opens the new empty folder.', ['new-folder', 'folder-empty'], 'Name it, Enter.', 'works', 'shots a26, a27; web/js/actions.js:68-72.'),
  S('The empty folder offers Add bookmarks, a picker of links saved elsewhere.', ['folder-empty', 'add-to'], 'Tick two, Move 2 to Media.', 'works', 'shot a29.'),
  S('Moving them shows "Moved 2 to Media" with Undo.', 'folder-filled', 'Read the toast.', 'works', 'shot a30.'),
  S('The folder three dots: Share first, then Add bookmarks, New folder inside, Rename, Move to, Hide from Recent, Lock with a password, Delete.', 'folder-menu', 'Pick Share.', 'works', 'shot f04-04-folder-menu (FT 04.11).'),
  S('Move to moves a folder under another or to the top level.', 'fmove', 'Pick Top level.', 'works', 'shot a31.'),
  S('A card shows Share, Open, Trash and More on hover; More holds Move, Copy, Share, Trash, Open, Rename, Pin.', ['folder-hover', 'tile-menu'], 'Open More.', 'works', 'shots a19, a20.'),
  S('Move from the card\'s More or the selection bar says "Moved to Work" with Undo, as a drag onto a folder does; Undo puts it back.', ['move-sheet', 'folder-moved'], 'Pick a folder.', 'works', 'shot f04-07-moved (FT 04.11); web/js/actions.js moveWithUndo.'),
  S('Dragging a card onto a folder in the sidebar moves it with Undo.', ['folder-drag', 'folder-dragged'], 'Drag.', 'works', 'web/js/drag.js and web/js/actions.js:98-102. Read from the code, not dragged in this run.'),
  S('Rename in place: F2 or the menu, Enter saves, Escape cancels.', 'rename', 'Type, Enter.', 'works', 'web/js/actions.js:55-66.'),
  S('Trash on a card: "Moved to Trash" with Undo.', 'trash-toast', 'Undo or go on.', 'works', 'shot a22.'),
  S('Trash keeps links 30 days; a card offers Restore and Delete now, which asks first; Empty trash asks first.', ['trash', 'trash-menu', 'purge-confirm', 'empty-confirm'], 'Empty trash.', 'works', 'shots a23, a24, a25.'),
  S('Delete folder asks first and says where its links go: "Delete Media? 2 bookmarks go to Trash."', 'delete-folder', 'Cancel or Delete folder.', 'works', 'shot a32.'),
  S("With More open at 1280 by 800 the folder list keeps 4 of 5 folders in view and the actions scroll in their own space. The folder list's scroll bar is hidden, so the fifth folder gives no sign, and More stays open after a reload.", 'dash-more', 'Look for Work.', 'friction', 'shot f04-13-dash-more (FT 04.11); web/app.css scrollbar-width:none.'),
  S('Phone: Folders tab, a folder, the three dots as a sheet.', ['p-folders', 'p-folder', 'p-folder-sheet'], 'Open a folder.', 'works', 'shots b03, b04, b05.'),
  S('Phone: a tap opens the link; Move, Rename and Trash come only after a long press starts selecting, and nothing on screen says so.', ['p-folder', 'p-select'], 'Hold a card.', 'friction', 'web/js/render.js:258-261 (the card is a plain link), web/js/drag.js:134-142 (hold selects).'),
 ]),
 dict(id='05', name='Locked folders', steps=[
  S('Folder actions, Lock with a password: Password, Repeat password, a Close button, and 6 px below the second field the note "Use at least 8 characters. Links in this folder stay out of sight everywhere until you unlock it. The password cannot be recovered."', 'lock-sheet', 'Type it twice.', 'works', 'shot f05-01-lock-sheet (FT 04.11); the gap from 0.1.12: web/app.css .fld + .sh-text, tools/ui-test.mjs S23.10.'),
  S('Fewer than 8 characters, two that differ, or one too easy to guess are named under the fields: "Use at least 8 characters.", "The passwords do not match.", "This password is too easy to guess. Choose another one."', 'lock-error', 'Fix it.', 'works', 'shot f05-02-lock-error (FT 04.11).'),
  S('Lock goes back to the Dashboard with "Folder locked"; the sidebar shows the name with a lock and no count.', 'locked', 'Read the sidebar.', 'works', 'shot a45.'),
  S('A locked folder is gone from search, Recent and the counts.', 'palette-locked', 'Search.', 'works', 'shot a51.'),
  S('A click on it opens Unlock; a wrong password says "Wrong password"; the right one opens it for 10 minutes.', ['unlock', 'unlock-wrong', 'unlocked'], 'Type the folder password.', 'works', 'shots a46, a47, a48.'),
  S('The lock, unlock and remove lock dialogs have a Close button in the head, 44 by 44; Escape and a tap outside close them too.', 'unlock', 'Close.', 'works', 'shot f05-07-remove-lock (FT 04.11).'),
  S('Unlocked, the folder actions offer Relock now and Remove lock, which asks the app password.', ['unlocked-menu', 'remove-lock'], 'Relock now.', 'works', 'shots a49, a50.'),
  S('On the phone the lock dialog note sits 6 px below the Repeat password field, as on the desktop.', 'p-lock', 'Read the note.', 'works', 'shot f05-08-phone-lock (FT 04.11, the 6 px overlap of 0.1.11); fixed in 0.1.12: web/app.css .fld + .sh-text, tools/ui-test.mjs S23.10.'),
 ]),
 dict(id='06', name='Share links', steps=[
  S('In a folder the link glyph by the title opens Share.', ['reading', 'share-off'], 'Turn on Share with a link.', 'works', 'shot a33 (see 04.4 for finding it).'),
  S('On: the link with Copy, and Share where the system has a share sheet.', 'share-on', 'Copy.', 'works', 'shot a34; link of the form /s/#token.'),
  S('Copy says "Copied".', 'share-copied', 'Paste it to someone.', 'works', 'log-a "Copied".'),
  S('Share with a password: "Use at least 8 characters." sits under the field before Set; a shorter one then says "A share password needs at least 8 characters."', ['share-pw', 'share-pw-error'], 'Type 8 or more.', 'works', 'shots f06-04-share-pw, f06-04-share-pw-error (FT 04.11).'),
  S('Set: Locked with Change and Remove; Expires Never, 1, 7 or 30 days with the end date; "Not opened yet".', 'share-set', 'Pick 7 days.', 'works', 'shot a36.'),
  S('The visitor gets the folder name and Password; a wrong one says "Wrong password."; the right one shows the cards with a search.', ['visitor-pw', 'visitor-wrong', 'visitor-open'], 'Open the link in another browser.', 'works', 'shots a38, a39, a40.'),
  S('On a phone the visitor page is the same.', 'p-visitor', 'Open it on a phone.', 'works', 'shot a41.'),
  S('Share with a link off asks "Stop sharing?"; afterwards the visitor sees "This link does not work."', ['stop-share', 'visitor-revoked'], 'Stop sharing.', 'works', 'shots a42, a43.'),
  S('Locking a shared folder ends its link, and the lock sheet says so.', 'lock-sheet', 'Read the lock sheet.', 'works', 'web/js/sheets.js:87.'),
 ]),
 dict(id='07', name='Import and export', steps=[
  S('More in the sidebar (desktop) or Settings (phone), Import, pick a browser bookmarks file.', ['dash-more', 'p-settings'], 'Pick the file.', 'works', 'shot a02; accept=".html,.htm,text/html".'),
  S('While it runs a toast says "Importing. This can take a moment for a big file." and every Import is disabled and busy. 100000 links (17.4 MB) take about 9 seconds.', 'import-running', 'Wait.', 'works', 'log-big 07.2 (FT 04.11).'),
  S('Done: "Imported 15, skipped 0", folders kept.', 'imported', 'Look through the folders.', 'works', 'shot a03.'),
  S('The same file again: "Imported 0, skipped 15".', 'imported', 'Nothing.', 'works', 'log-a import2.'),
  S('A file that is not a bookmarks file: "Not a bookmark file."; folders more than 256 deep: "The folders in this file nest more than 256 deep. Pinned cannot import it."', 'import-bad', 'Export again from the browser.', 'works', 'shots a04, a05; POST /api/import answers 400.'),
  S('Export downloads bookmarks.html.', 'export', 'Open the file.', 'works', 'log-a export name bookmarks.html.'),
  S('With a folder locked in this browser the export leaves it out and says so: "Exported without Finance: it is locked. Unlock it first to include it."', 'export', 'Unlock it first, or keep the file.', 'works', 'shot f07-07-export (FT 04.11).'),
  S('The nightly export/bookmarks.html in the data folder holds everything, locked folders too.', 'term-backup', 'Copy it with the backup.', 'works', 'README.md, Your data and backups.'),
 ]),
 dict(id='08', name='Second factor and Signed in', steps=[
  S('The owner makes a secret, sets TOTP_SECRET, restarts and adds it to the authenticator by hand; a bad secret stops the start with a message.', 'term-totp', 'Open the login.', 'works', 'README.md, Second factor; binary output for TOTP_SECRET=ABC.'),
  S('The login shows Password and Code; Enter in the password moves to the code.', 'login-code', 'Type the code.', 'works', 'shot c01; web/js/app.js:82.'),
  S('A wrong code says "Wrong password or code. A code works once: wait for the next one." and both fields are empty again.', 'login-code-error', 'Type both again.', 'friction', 'shot f08-03-login-code-error (FT 04.11); internal/server/pages.go:89-109 (redirect, the form is lost).'),
  S('The same code used in a second browser inside its 30 seconds is refused with "A code works once: wait for the next one."', 'login-code-error', 'Wait for the next code.', 'works', 'shot f08-04-same-code (FT 04.11).'),
  S('After 5 wrong codes in a row: "Wrong password or code. Wait 60 seconds before the next try.", then "Too many tries. Wait 59 seconds, then try again."; the right code during the hold names the time left, and after the wait it logs in.', 'login-wait', 'Wait the time it names.', 'works', 'shots f08-05-hold-5, f08-05-right-during-hold (FT 04.11); log security event=totp.wait.'),
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
  S('After Create the sheet says "Next, paste it into the extension\'s options with the address" of this server "or into your script." The form is gone: a second token needs the sheet closed and opened again.', 'token-created', 'Close, reopen.', 'friction', 'shot f09-03-token-created (FT 04.11).'),
  S('The token reads folders (200) and cannot export (403).', 'term-curl', 'Run the script.', 'works', 'log-a "token GET folders 200", "token export 403".'),
  S('The list shows when each token was made and last used.', 'tokens-list', 'Read it.', 'works', 'shot a55.'),
  S('Revoke asks in the row, then "Token revoked"; the token now answers 401.', 'token-revoke', 'Revoke.', 'works', 'shot a56; log-a "revoked token GET 401".'),
 ]),
 dict(id='10', name='Settings', steps=[
  S('Every setting is an environment variable in the compose file.', 'term-env', 'Edit, docker compose up -d.', 'works', 'README.md, Settings table.'),
  S('Phone: the gear opens Settings with How to save, API tokens and their count, Import, Export, What\'s new, Source, Signed in, Log out.', 'p-settings', 'Open a row.', 'works', 'shot b10b; axe clean.'),
  S('Desktop: the same under More in the sidebar.', 'dash-more', 'Open More.', 'works', 'shot a02.'),
  S('What\'s new shows the changelog, the last three releases open and older ones folded; the release you run is marked "This version", also on a release image whose version starts with v.', 'whats-new', 'Read.', 'works', 'shot f10-04-whats-new (FT 04.11, no mark on v0.1.11); the mark from 0.1.12: web/js/sheets.js releaseHTML, tools/ui-test.mjs S23.13.'),
  S('A new APP_PASSWORD ends every login, token and device cookie after the restart.', 'term-env', 'Make new tokens.', 'works', 'README.md, Changing the password.'),
  S('Log out goes back to the login page.', 'login', 'Log in again.', 'works', 'log-a "after logout: /login".'),
 ]),
 dict(id='11', name='Backup and going back a version', steps=[
  S('Backing up: sqlite3 .backup, or stop, copy the data folder, start.', 'term-backup', 'Copy.', 'works', 'README.md, Backing up. Not run.'),
  S('Upgrading names the copy in the log: "database: upgrading from schema 6 to 12; the database as it was is saved at .../bookmarks-schema6-....db".', 'term-upgrade', 'Note the file.', 'works', 'Run: 0.1.10 data folder started with ad2cb8e.'),
  S('Going back, 0.1.10 refuses: "database was written by a newer Pinned (schema 12); this version knows 6. Update the image or restore a backup." It names no file. From 0.1.11 on, a version that refuses a newer database names the copy to restore and the README section.', 'term-downgrade', 'Find the README section.', 'friction', 'log-upgrade 11.3 (FT 04.11); internal/store/store.go:214-220.'),
  S('Restoring as the README says (move bookmarks.db aside, copy the schema 6 file in, no -wal or -shm) brings 0.1.10 back with all 15 bookmarks and 5 folders.', 'term-restore', 'Start the older image.', 'works', 'Run: GET /api/state on 0.1.10 after the restore.'),
  S('Links saved after the upgrade are not in that copy; the README says to export them first.', 'term-restore', 'Export before going back.', 'works', 'README.md, Going back to an older version.'),
 ]),
 dict(id='12', name='Errors', steps=[
  S('Wrong password, and the wait after 5 tries with the time left (01.4, 01.5).', ['login-error', 'login-wait'], 'See flow 01.', 'works', 'shots f01-04-login-wrong, f01-05-login-wait (FT 04.11).'),
  S('The server stops while the app is open: Save says "Cannot reach your Pinned server. Check your connection, then try again."', 'save-down', 'Try again when it is back.', 'works', 'shot f12-02-save-down (FT 04.11); web/js/api.js.'),
  S('The cards stay on screen, dimmed, under "Cannot reach your Pinned server." with Retry. On the phone, when the server cannot be reached at the first load, the head with the bulb and the Settings gear shows above the tabs and the notice.', ['notice-down', 'p-notice-down'], 'Retry, or open Settings.', 'works', 'shot f12-03-notice-down (FT 04.11); the phone head from 0.1.12: web/js/render.js phoneRecents, tools/ui-test.mjs S23.7.'),
  S('Retry while still down shows the same notice.', 'notice-down', 'Wait.', 'works', 'shot c13.'),
  S('A reload while down shows the browser\'s own error page.', 'browser-down', 'Start the server.', 'works', 'ERR_CONNECTION_REFUSED.'),
  S('A bad import file is refused with a message (07.5).', 'import-bad', 'See flow 07.', 'works', 'shots a04, a05.'),
  S('A login that ended elsewhere sends the next request to /login?next=..., back to the same place after logging in.', 'login', 'Log in.', 'works', 'web/js/api.js, 401 handling.'),
  S('A revoked or expired share link says "This link does not work."', 'visitor-revoked', 'Ask the owner.', 'works', 'shot a43.'),
 ]),
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
<p>Pinned 0.1.12 as it is built (the release-0.1.12 branch from a1fe24b), every screen and state the user flows touch, desktop at 1280 by 800 and the phone where it differs. {len(SC)} screens, {len(flows)} flows, {nsteps} steps walked in the real app: {cnt["works"]} work, {cnt["friction"]} with friction, {cnt["broken"]} broken. The step texts and verdicts are those of the walk of 04.11.2026 at v0.1.11, and of the 0.1.12 build for the steps it changes.
Controls that lead somewhere are links. Drags and holds are dashed targets: press h on any screen to show them and outline every link. The flow test of 31.10.2026, with its gap list, is in flow-test.md; the results of 04.11 are in the step texts. The flows as text and diagrams are in flows/.</p>
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
          'Pinned 0.1.12, the release-0.1.12 branch from a1fe24b. Each flow as numbered steps, written from the flow test of 04.11.2026 at v0.1.11 and, for the steps 0.1.12 changes, from the 0.1.12 build; the screens are in ../screens, the walk with each verdict in ../walk.html. The flow test of 31.10.2026 is in ../flow-test.md. One Mermaid diagram per flow sits next to this file.', '']
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

    # flow-test.md is the record of 31.10.2026 and stays as it is: it is not written here
