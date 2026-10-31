# Flow test of Pinned as built (31.10.2026)

Product: main at ad2cb8e, the 0.1.11 candidate, unpushed. Release day on Product Hunt: Tue 10 Nov; the last fixes go into 0.1.11 on Sat 7 Nov.

Method: the product read first (README, docs, CHANGELOG 0.1.11, web/ templates, CSS and JS, the extension, the server routes), then the flows written as numbered steps (flows/), then every step walked twice:

1. In the real app: a local build of ad2cb8e on a throwaway data folder, password made in the shell and never written down, driven with headless Chromium at 1280 by 800 and 390 by 844 in light and dark; WebKit for the P-WEB checks; the extension loaded unpacked in Chromium; release 0.1.10 built from its tag for the upgrade and going back steps. Evidence names a screenshot of that run (not kept), a route, a log line or file:line in the repo.
2. In the wireframes: every screen of the step exists, and the step can be reached from the step before by a click, or by a dashed target for a drag, a hold or another outcome (press h, or walk mode, shows them). "click" below means reachable by a click, "next" means the walk moves on with Next (a separate start, such as opening another browser or the terminal).

## Counts

1. Flows: 12. Steps: 119.
2. In the real app: 96 work, 21 friction, 2 broken.
3. In the wireframes: 119 of 119 steps drawn; 107 reached by a click from the step before, 12 flow starts, 0 reached with Next.
4. Screens: 121, desktop at 1280 by 800, the phone at 390 by 844 shown at 92 percent on the same canvas.

## 01 First start and login

1. works. The owner starts the container with a password: APP_PASSWORD=... docker compose up -d. Screens: term-start. Do: Read the log line, then open the address. Evidence: README.md, Install in five minutes; log "pinned listening on :8080, data in /data". Wireframe: start.
2. works. Without a password, or with fewer than 8 characters, the server does not start and says why. Screens: term-start-error. Do: Set a longer password. Evidence: Binary output: "APP_PASSWORD is not set. Set it, or APP_PASSWORD_FILE ..." and "APP_PASSWORD is shorter than 8 characters ..." Wireframe: click.
3. works. Opening the app without a login goes to the login page. Screens: login. Do: Type the password. Evidence: GET / answers with /login?next=%2F (Chromium, all four sizes and themes). Wireframe: click.
4. works. A wrong password comes back with "Wrong password." and the caret in the field. Screens: login-error. Do: Type it again. Evidence: shot a01; /login?error=1; web/js/app.js:79. Wireframe: click.
5. friction. After 5 wrong tries the page says "Wait 30 seconds and try again."; during the wait the right password gets the same answer, with no countdown. Screens: login-wait. Do: Wait, then log in. Evidence: shot b22; /login?error=wait; web/js/app.js:79 (fixed text). Wireframe: click.
6. works. The right password lands on the empty Dashboard with Add bookmark, Import and How to save. Screens: dash-empty. Do: Pick a way to fill it. Evidence: shot home-empty-desk-light. Wireframe: click.
7. works. On the phone the same login, then Dashboard, Inbox and Folders tabs, the Settings gear, the search pill and the plus. Screens: p-login, p-dash-empty. Do: Log in on the phone. Evidence: shot home-empty-phone-dark; axe clean on login and Dashboard (phone). Wireframe: click.
8. works. Light and dark follow the system; the bulb switches and the choice is kept per browser. Screens: dash. Do: Click the bulb. Evidence: web/js/theme.js:3-20; shots b18 (dark desktop), b21 (dark phone); WebKit dark: no overflow, axe clean. Wireframe: click.
9. works. Password managers fill the login: the form carries a fixed user name. Screens: login. Do: Let the password manager fill it. Evidence: web/login.html, hidden username field with autocomplete="username". Wireframe: click.

## 02 Save a link, in the app, with the bookmarklet and with the extension

1. works. Add (desktop) or the plus (phone) opens the save sheet, the folder preset to the last one used. Screens: add-sheet, p-add. Do: Paste an address. Evidence: shots a10, b08; web/js/sheets.js:304-327. Wireframe: start.
2. friction. An address typed without http, such as example.com, is refused on Save with "Enter a full address starting with http or https." The extension options add https:// on their own. Screens: add-noscheme. Do: Type http:// in front. Evidence: shot a11; web/js/sheets.js:359; compare extras/extension/shared.js:12. Wireframe: click.
3. friction. After fixing the address the old error stays under the field, next to the live check that now says the link is fine or already saved. Screens: add-stale. Do: Ignore it and save. Evidence: shot a12; web/js/actions.js:281 (onInput never clears s.err); web/js/sheets.js:322. Wireframe: click.
4. works. An address already saved shows "Already saved in Homelab. Save anyway moves it here." and the button turns into Save anyway. Screens: add-dupe. Do: Save anyway, or close. Evidence: shot a12; GET /api/check. Wireframe: click.
5. works. The same host on another port is a new bookmark: Not saved yet. Screens: add-newport. Do: Give it a title. Evidence: log-a: Jellyfin on :8096 next to :8080 saved as new. Wireframe: click.
6. works. Choose another folder lists every folder and New folder. Screens: add-picker. Do: Pick a folder. Evidence: shot a13. Wireframe: click.
7. works. Save closes the sheet and the card appears in its folder. No toast; screen readers hear "Saved in Homelab". Screens: folder-saved. Do: Find the new card. Evidence: shot a14; web/js/sheets.js:368-373. Wireframe: click.
8. works. Bookmarklet: How to save, Computer, drag Save to Pinned into the bookmarks bar. Screens: howto-computer. Do: Drag the button. Evidence: shot a62; /bookmarklet; axe clean desktop and phone. Wireframe: click.
9. works. On any page Save to Pinned opens /save in a small window with title, address, recent folders and Log out. Screens: browser-page, save-page. Do: Check the folder, Save. Evidence: shot a64; WebKit desktop and phone: no overflow, no console errors. Wireframe: click.
10. works. Saving draws a tick and closes the window; where the browser keeps it open, a Saved state with Done. Screens: save-done. Do: Done. Evidence: shot a65; web/js/sheets.js:371-383. Wireframe: click.
11. works. Extension: How to save, Extension: download, unzip, load unpacked; "a token" opens API tokens. Screens: howto-extension. Do: Download, load, then follow a token. Evidence: shot b17-howto-Extension; web/bookmarklet.html:141 (/#tokens), web/js/app.js:42-44. Wireframe: click.
12. works. With a token made (flow 09), the extension options take the address and the token. Screens: ext-options. Do: Type the address. Evidence: shot e02. Wireframe: click.
13. friction. The home address typed as most people write it, 10.0.0.5:9095, becomes https:// and Test says "Could not reach https://10.0.0.5:9095." Nothing hints that the server speaks http. Screens: ext-options-fail. Do: Type http:// in front. Evidence: shot e03; extras/extension/shared.js:12 and :34; README install answers on plain http :9095. Wireframe: click.
14. works. With http:// Test says "Connected, 5 folders"; Save stores both and asks the browser for access to that host. Screens: ext-options-ok. Do: Allow access. Evidence: shots e04, e06. The permission prompt itself cannot show in headless Chromium; the status waits for it. Wireframe: click.
15. works. The toolbar button or Option Shift S opens the popup: title selected, address, three recent folders, Save to Inbox. Screens: ext-popup, ext-popup-picker. Do: Pick a folder, Save. Evidence: shots e07, e08; saved bookmark checked in GET /api/state. Wireframe: click.
16. works. Saved: the tick draws and the popup closes. Screens: ext-saved. Do: Nothing. Evidence: log-e "popup closed itself". Wireframe: click.
17. works. The same page again: "Already saved in Homelab / Network." with Save anyway. Screens: ext-popup-dupe. Do: Close. Evidence: shot e10. Wireframe: click.
18. works. On a browser page: "This page cannot be saved". Screens: ext-popup-cannot. Do: Close. Evidence: shot e11. Wireframe: click.
19. friction. The popup and options are always dark, while the app and its pages follow light and dark since 0.1.11. Screens: ext-popup. Do: Notice the mismatch. Evidence: shot e07 with the system in light; extras/extension/ui.css:17 color-scheme:dark. Wireframe: click.
20. works. Right click a page or link, Save to Pinned: it goes to the Inbox and the button shows a tick, = when already saved, ! on failure. Screens: ext-context. Do: Right click. Evidence: extras/extension/background.js:25-52. Read from the code; context menus cannot be driven headless. Wireframe: click.
21. works. iPhone and Android: How to save shows the Safari bookmark and the home screen share target. Screens: howto-iphone. Do: Follow the steps on the phone. Evidence: shot b16; log-b howto iPhone and Android. Wireframe: click.

## 03 Find and open

1. works. / or Command K or a click on the search field opens the search over the blurred app, with recent opens. Screens: palette. Do: Type. Evidence: shot a15; web/js/keys.js:45 and :54. Wireframe: start.
2. works. Typing filters by title, address and host, grouped by folder, the first hit marked. Screens: palette-results. Do: Arrow to a hit. Evidence: shot a16. Wireframe: click.
3. works. Enter opens the marked link in a new tab and records it for Recently opened. Screens: palette-results, open-tab. Do: Press Enter. Evidence: dbg run: new page event after Enter; web/js/palette.js:87. Wireframe: click.
4. works. No match: "No matches." Screens: palette-none. Do: Change the query. Evidence: shot a17. Wireframe: click.
5. works. Escape clears the query first, a second Escape closes the search. Screens: palette. Do: Press Escape twice. Evidence: web/js/palette.js:166. Wireframe: click.
6. works. From the browser address bar: /search?q=portainer opens the app with that search. Screens: palette-bar. Do: Pick the hit. Evidence: shot a18; internal/server/pages.go:137-139. Wireframe: click.
7. works. A click on a card opens the link in a new tab; Command click opens it behind. Screens: folder, open-tab. Do: Click a card. Evidence: web/js/actions.js:171-178. Wireframe: click.
8. works. The Dashboard keeps the pinned row and Recently opened, else Recently saved. Screens: dash. Do: Read the Dashboard. Evidence: shots a06, a45. Wireframe: click.
9. works. On the phone the search pill opens the same search as a sheet. Screens: p-search. Do: Type. Evidence: shot b09. Wireframe: click.
10. works. Links in a locked folder never show in search. Screens: palette-locked. Do: Search for one. Evidence: shot a51 ("bank" in locked Finance: No matches). Wireframe: click.
11. broken. After a very large import, All bookmarks draws every card at once: 10000 links hold the page for 1.4 s, 100000 links freeze it for more than 2 minutes. The README promises imports of 470000 links. Screens: all-big. Do: Open All bookmarks. Evidence: j.mjs timing on 10000 and 100000 imported links; web/js/render.js:149-170 renders all sections. Wireframe: click.

## 04 Organise folders

1. works. The plus next to Folders, or N, opens New folder; Create opens the new empty folder. Screens: new-folder, folder-empty. Do: Name it, Enter. Evidence: shots a26, a27; web/js/actions.js:68-72. Wireframe: start.
2. works. The empty folder offers Add bookmarks, a picker of links saved elsewhere. Screens: folder-empty, add-to. Do: Tick two, Move 2 to Media. Evidence: shot a29. Wireframe: click.
3. works. Moving them shows "Moved 2 to Media" with Undo. Screens: folder-filled. Do: Read the toast. Evidence: shot a30. Wireframe: click.
4. friction. The folder three dots hold Add bookmarks, New folder inside, Rename, Move to, Hide from Recent, Lock with a password, Delete. Share is not there: only the small link glyph by the title opens it (the right click menu has it). Screens: folder-menu. Do: Look for Share. Evidence: shot a28; web/js/actions.js:109 folderItems has no Share, web/js/actions.js:103 folderSheetItems (right click) does. Wireframe: click.
5. works. Move to moves a folder under another or to the top level. Screens: fmove. Do: Pick Top level. Evidence: shot a31. Wireframe: click.
6. works. A card shows Share, Open, Trash and More on hover; More holds Move, Copy, Share, Trash, Open, Rename, Pin. Screens: folder-hover, tile-menu. Do: Open More. Evidence: shots a19, a20. Wireframe: click.
7. friction. Move from the card or the selection bar moves without a word: no toast, no Undo. A drag onto a folder says "Moved to Reading" with Undo. Screens: move-sheet, folder-moved. Do: Pick a folder. Evidence: log-a "move toast:" empty; web/js/actions.js:158 calls actions.move, web/js/actions.js:98-102 moveWithUndo has the toast. Wireframe: click.
8. works. Dragging a card onto a folder in the sidebar moves it with Undo. Screens: folder-drag, folder-dragged. Do: Drag. Evidence: web/js/drag.js and web/js/actions.js:98-102. Read from the code, not dragged in this run. Wireframe: click.
9. works. Rename in place: F2 or the menu, Enter saves, Escape cancels. Screens: rename. Do: Type, Enter. Evidence: web/js/actions.js:55-66. Wireframe: click.
10. works. Trash on a card: "Moved to Trash" with Undo. Screens: trash-toast. Do: Undo or go on. Evidence: shot a22. Wireframe: click.
11. works. Trash keeps links 30 days; a card offers Restore and Delete now, which asks first; Empty trash asks first. Screens: trash, trash-menu, purge-confirm, empty-confirm. Do: Empty trash. Evidence: shots a23, a24, a25. Wireframe: click.
12. works. Delete folder asks first and says where its links go: "Delete Media? 2 bookmarks go to Trash." Screens: delete-folder. Do: Cancel or Delete folder. Evidence: shot a32. Wireframe: click.
13. friction. With More open in the sidebar at 800 px height the folder list shrinks to about two rows, its scroll bar is hidden, and More stays open on the next visit. Screens: dash-more. Do: Look for Finance and Work. Evidence: shots a03, a06; web/app.css:198-199 (scrollbar-width:none); web/js/actions.js:204 keeps the open state. Wireframe: click.
14. works. Phone: Folders tab, a folder, the three dots as a sheet. Screens: p-folders, p-folder, p-folder-sheet. Do: Open a folder. Evidence: shots b03, b04, b05. Wireframe: click.
15. friction. Phone: a tap opens the link; Move, Rename and Trash come only after a long press starts selecting, and nothing on screen says so. Screens: p-folder, p-select. Do: Hold a card. Evidence: web/js/render.js:258-261 (the card is a plain link), web/js/drag.js:134-142 (hold selects). Wireframe: click.

## 05 Locked folders

1. works. Folder actions, Lock with a password: Password, Repeat password and the note that it cannot be recovered. Screens: lock-sheet. Do: Type it twice. Evidence: shot a44. Wireframe: start.
2. works. Fewer than 4 characters, or two that differ, are named under the fields. Screens: lock-error. Do: Fix it. Evidence: log-a "Use at least 4 characters.", "The passwords do not match." Wireframe: click.
3. works. Lock goes back to the Dashboard with "Folder locked"; the sidebar shows the name with a lock and no count. Screens: locked. Do: Read the sidebar. Evidence: shot a45. Wireframe: click.
4. works. A locked folder is gone from search, Recent and the counts. Screens: palette-locked. Do: Search. Evidence: shot a51. Wireframe: click.
5. works. A click on it opens Unlock; a wrong password says "Wrong password"; the right one opens it for 10 minutes. Screens: unlock, unlock-wrong, unlocked. Do: Type the folder password. Evidence: shots a46, a47, a48. Wireframe: click.
6. friction. The lock dialogs have no close button; only Escape or a tap outside closes them. Screens: unlock. Do: Look for a way out. Evidence: shot a46; web/js/sheets.js:83-91 (no close in lockHTML); P-WEB-2. Wireframe: click.
7. works. Unlocked, the folder actions offer Relock now and Remove lock, which asks the app password. Screens: unlocked-menu, remove-lock. Do: Relock now. Evidence: shots a49, a50. Wireframe: click.
8. friction. On the phone the lock dialog note sits tight under the second field. Screens: p-lock. Do: Read the note. Evidence: shot b13. Wireframe: click.

## 06 Share links

1. works. In a folder the link glyph by the title opens Share. Screens: reading, share-off. Do: Turn on Share with a link. Evidence: shot a33 (see 04.4 for finding it). Wireframe: start.
2. works. On: the link with Copy, and Share where the system has a share sheet. Screens: share-on. Do: Copy. Evidence: shot a34; link of the form /s/#token. Wireframe: click.
3. works. Copy says "Copied". Screens: share-copied. Do: Paste it to someone. Evidence: log-a "Copied". Wireframe: click.
4. friction. Lock with a password: a password under 8 characters is refused only after Set, "A share password needs at least 8 characters."; the field gives no hint before. Screens: share-pw, share-pw-error. Do: Type 8 or more. Evidence: shot a35. Wireframe: click.
5. works. Set: Locked with Change and Remove; Expires Never, 1, 7 or 30 days with the end date; "Not opened yet". Screens: share-set. Do: Pick 7 days. Evidence: shot a36. Wireframe: click.
6. works. The visitor gets the folder name and Password; a wrong one says "Wrong password."; the right one shows the cards with a search. Screens: visitor-pw, visitor-wrong, visitor-open. Do: Open the link in another browser. Evidence: shots a38, a39, a40. Wireframe: click.
7. works. On a phone the visitor page is the same. Screens: p-visitor. Do: Open it on a phone. Evidence: shot a41. Wireframe: click.
8. works. Share with a link off asks "Stop sharing?"; afterwards the visitor sees "This link does not work." Screens: stop-share, visitor-revoked. Do: Stop sharing. Evidence: shots a42, a43. Wireframe: click.
9. works. Locking a shared folder ends its link, and the lock sheet says so. Screens: lock-sheet. Do: Read the lock sheet. Evidence: web/js/sheets.js:87. Wireframe: click.

## 07 Import and export

1. works. More in the sidebar (desktop) or Settings (phone), Import, pick a browser bookmarks file. Screens: dash-more, p-settings. Do: Pick the file. Evidence: shot a02; accept=".html,.htm,text/html". Wireframe: start.
2. friction. While it runs nothing shows: no progress, Import stays live for a second click, the empty Dashboard stays empty. A 20 MB file takes about 15 seconds. Screens: import-running. Do: Wait without knowing. Evidence: shot i01; web/js/actions.js:133-137 (no busy state); CHANGELOG 0.1.11 "about 15 seconds". Wireframe: click.
3. works. Done: "Imported 15, skipped 0", folders kept. Screens: imported. Do: Look through the folders. Evidence: shot a03. Wireframe: click.
4. works. The same file again: "Imported 0, skipped 15". Screens: imported. Do: Nothing. Evidence: log-a import2. Wireframe: click.
5. works. A file that is not a bookmarks file: "Not a bookmark file."; folders more than 256 deep: "The folders in this file nest more than 256 deep. Pinned cannot import it." Screens: import-bad. Do: Export again from the browser. Evidence: shots a04, a05; POST /api/import answers 400. Wireframe: click.
6. works. Export downloads bookmarks.html. Screens: export. Do: Open the file. Evidence: log-a export name bookmarks.html. Wireframe: click.
7. friction. With a folder locked in this browser the export leaves it out and says nothing; someone moving away or keeping a copy loses those links without knowing. Screens: export. Do: Trust the file. Evidence: log-a "has Finance: false"; internal/server/api.go:707; README says it, the app does not. Wireframe: click.
8. works. The nightly export/bookmarks.html in the data folder holds everything, locked folders too. Screens: term-backup. Do: Copy it with the backup. Evidence: README.md, Your data and backups. Wireframe: click.

## 08 Second factor and Signed in

1. works. The owner makes a secret, sets TOTP_SECRET, restarts and adds it to the authenticator by hand; a bad secret stops the start with a message. Screens: term-totp. Do: Open the login. Evidence: README.md, Second factor; binary output for TOTP_SECRET=ABC. Wireframe: start.
2. works. The login shows Password and Code; Enter in the password moves to the code. Screens: login-code. Do: Type the code. Evidence: shot c01; web/js/app.js:82. Wireframe: click.
3. friction. A wrong code says "Wrong password or code." and both fields are empty again. Screens: login-code-error. Do: Type both again. Evidence: shot c02; internal/server/pages.go:97-103 (redirect, the form is lost). Wireframe: click.
4. friction. The same code used in a second browser inside its 30 seconds is refused with the same text. Screens: login-code-error. Do: Wait for the next code. Evidence: log-c "same code twice: ... Wrong password or code." Wireframe: click.
5. broken. After 5 wrong codes every login is held from 1 minute up to a day, but the page says "Wait 30 seconds and try again." and the right code gets the same answer while the hold lasts. Screens: login-wait. Do: Wait 30 seconds, fail again. Evidence: log-c "after 5 wrong codes", "right code during hold"; web/js/app.js:79; README, Wrong passwords and tokens. Wireframe: click.
6. works. Browsers logged in before stay logged in; API tokens need no code. Screens: dash. Do: Nothing. Evidence: README.md, Second factor. Wireframe: click.
7. works. More, Signed in: each browser with its sign in day and last use, this one marked. Screens: sessions. Do: Find the other one. Evidence: shot a57. Wireframe: click.
8. friction. Two browsers of one kind read the same, "Chrome on macOS", with no address or place to tell them apart. Screens: sessions. Do: Guess which one. Evidence: shot a57; web/js/sheets.js:231. Wireframe: click.
9. works. Sign out, or Sign out all others, asks for the app password; a wrong one says "Wrong password". Screens: sessions-confirm, sessions-wrong. Do: Type the app password. Evidence: shot a58. Wireframe: click.
10. works. Done: "Other browsers signed out". Screens: sessions-done. Do: Close. Evidence: shot a59. Wireframe: click.
11. friction. The signed out browser keeps showing every bookmark until it next asks the server for something. Screens: signed-out-other. Do: Look at the other screen. Evidence: shot a60. Wireframe: click.
12. works. Lost the authenticator: remove TOTP_SECRET and restart. Screens: term-totp. Do: Restart. Evidence: README.md, Second factor. Wireframe: click.

## 09 API tokens

1. works. More, API tokens (or "a token" on How to save): the empty state says what a token can and cannot do. Screens: tokens-empty. Do: Name it. Evidence: shot a52. Wireframe: start.
2. works. Name and app password, Create; a wrong password says "Wrong password" and keeps the name. Screens: tokens-wrong. Do: Type the right one. Evidence: shot a53. Wireframe: click.
3. works. The token shows once with Copy and "Copy it now. It is not shown again." Screens: token-created. Do: Copy. Evidence: shot a54. Wireframe: click.
4. friction. The form is gone after Create: a second token needs the sheet closed and opened again, and nothing says where the token goes next. Screens: token-created. Do: Close, reopen. Evidence: web/js/sheets.js:199-202. Wireframe: click.
5. works. The token reads folders (200) and cannot export (403). Screens: term-curl. Do: Run the script. Evidence: log-a "token GET folders 200", "token export 403". Wireframe: click.
6. works. The list shows when each token was made and last used. Screens: tokens-list. Do: Read it. Evidence: shot a55. Wireframe: click.
7. works. Revoke asks in the row, then "Token revoked"; the token now answers 401. Screens: token-revoke. Do: Revoke. Evidence: shot a56; log-a "revoked token GET 401". Wireframe: click.

## 10 Settings

1. works. Every setting is an environment variable in the compose file. Screens: term-env. Do: Edit, docker compose up -d. Evidence: README.md, Settings table. Wireframe: start.
2. works. Phone: the gear opens Settings with How to save, API tokens and their count, Import, Export, What's new, Source, Signed in, Log out. Screens: p-settings. Do: Open a row. Evidence: shot b10b; axe clean. Wireframe: click.
3. works. Desktop: the same under More in the sidebar. Screens: dash-more. Do: Open More. Evidence: shot a02. Wireframe: click.
4. works. What's new shows the changelog of this version, the last three open. Screens: whats-new. Do: Read. Evidence: shot a61; web/js/sheets.js:164-188. Wireframe: click.
5. works. A new APP_PASSWORD ends every login, token and device cookie after the restart. Screens: term-env. Do: Make new tokens. Evidence: README.md, Changing the password. Wireframe: click.
6. works. Log out goes back to the login page. Screens: login. Do: Log in again. Evidence: log-a "after logout: /login". Wireframe: click.

## 11 Backup and going back a version

1. works. Backing up: sqlite3 .backup, or stop, copy the data folder, start. Screens: term-backup. Do: Copy. Evidence: README.md, Backing up. Not run. Wireframe: start.
2. works. Upgrading names the copy in the log: "database: upgrading from schema 6 to 12; the database as it was is saved at .../bookmarks-schema6-....db". Screens: term-upgrade. Do: Note the file. Evidence: Run: 0.1.10 data folder started with ad2cb8e. Wireframe: click.
3. friction. Going back, 0.1.10 refuses: "database was written by a newer Pinned (schema 12); this version knows 6. Update the image or restore a backup." It names no file and no README section; the container restarts into the same line. Screens: term-downgrade. Do: Find the README section. Evidence: Run: 0.1.10 on the upgraded folder; internal/store/store.go:210 has the same text for the next downgrade. Wireframe: click.
4. works. Restoring as the README says (move bookmarks.db aside, copy the schema 6 file in, no -wal or -shm) brings 0.1.10 back with all 15 bookmarks and 5 folders. Screens: term-restore. Do: Start the older image. Evidence: Run: GET /api/state on 0.1.10 after the restore. Wireframe: click.
5. works. Links saved after the upgrade are not in that copy; the README says to export them first. Screens: term-restore. Do: Export before going back. Evidence: README.md, Going back to an older version. Wireframe: click.

## 12 Errors

1. works. Wrong password and the wait after 5 tries (01.4, 01.5). Screens: login-error, login-wait. Do: See flow 01. Evidence: shots a01, b22. Wireframe: start.
2. friction. The server stops while the app is open: Save says "Could not save. Try again."; nothing says the server cannot be reached. Screens: save-down. Do: Try again, in vain. Evidence: shot c10; web/js/sheets.js:366. Wireframe: click.
3. works. The cards stay on screen, dimmed, under "Bookmarks could not load." with Retry. Screens: notice-down. Do: Retry. Evidence: shot c12; web/js/render.js:147. Wireframe: click.
4. works. Retry while still down shows the same notice. Screens: notice-down. Do: Wait. Evidence: shot c13. Wireframe: click.
5. works. A reload while down shows the browser's own error page. Screens: browser-down. Do: Start the server. Evidence: ERR_CONNECTION_REFUSED. Wireframe: click.
6. works. A bad import file is refused with a message (07.5). Screens: import-bad. Do: See flow 07. Evidence: shots a04, a05. Wireframe: click.
7. works. A login that ended elsewhere sends the next request to /login?next=..., back to the same place after logging in. Screens: login. Do: Log in. Evidence: web/js/api.js, 401 handling. Wireframe: click.
8. works. A revoked or expired share link says "This link does not work." Screens: visitor-revoked. Do: Ask the owner. Evidence: shot a43. Wireframe: click.

## Gaps, by user impact

Each with a suggested fix and whether it fits before Sat 7 Nov. "Fits" means a small change that can be built, tested and released in 0.1.11 without touching the database or the API.

1. The second factor hold says "Wait 30 seconds" while it lasts 1 minute up to a day (steps 08.5, 01.5)
   Why it matters: A user who mistypes codes is told to wait 30 seconds, while the hold lasts at least a minute and doubles; every try in it is refused with the same line, which reads as a broken login on launch day.
   Fix: Send the real wait with the redirect (/login?error=wait&s=<seconds>, checkLogin already returns it) and show "Try again in 2 minutes" or the time it ends. Same for the 30 second address limit.
   Fits before 7 Nov: yes. Size: small, server redirect plus app.js:79.

2. The extension options turn a home address into https and say only "Could not reach" (steps 02.13)
   Why it matters: The default install answers on plain http :9095, so the first thing most self hosters type fails with no hint. The extension is the main way to save on the desktop.
   Fix: When the typed address has no scheme and the https try fails, try http and say "Your server answered on http. Saved as http://...", or at least: "Could not reach https://10.0.0.5:9095. If your server uses http, type http://".
   Fits before 7 Nov: yes. Size: small, extras/extension/options.js and shared.js, repack the zip.

3. Export from the app leaves out locked folders without a word (steps 07.7)
   Why it matters: People export to move away or to keep a copy; links in locked folders are missing and nothing says so. The README explains it, the app does not.
   Fix: When any folder is locked in this browser, say it before or after the download: "Finance and Work are locked, so they are not in this file. Unlock them first, or use the nightly export in the data folder."
   Fits before 7 Nov: yes. Size: small, a toast or confirm in the More and Settings Export rows.

4. All bookmarks freezes after a very large import (steps 03.11)
   Why it matters: 10000 links hold the page 1.4 s, 100000 more than 2 minutes, while the README and CHANGELOG advertise 470000 link imports. Power users who try the big import on launch day get a frozen tab.
   Fix: Draw the first few hundred cards and the rest as the list scrolls (or in chunks after the first paint), and find the step that grows faster than the number of cards in deskBody and sections. Until then, soften the README claim.
   Fits before 7 Nov: no for the render change, yes for the README wording. Size: medium.

5. Import shows nothing while it runs (steps 07.2)
   Why it matters: A 20 MB file takes about 15 seconds with the screen unchanged and Import still clickable; people click again or think it failed.
   Fix: Show "Importing bookmarks.html..." as a toast that stays until the answer, and disable Import meanwhile.
   Fits before 7 Nov: yes. Size: small, actions.js:133-137.

6. The save sheet keeps an old error after the address is fixed (steps 02.3)
   Why it matters: "Enter a full address starting with http or https." stays next to a valid address, so the sheet contradicts itself on the very first save.
   Fix: Clear s.err on input in onInput (actions.js:281) and redraw the error line.
   Fits before 7 Nov: yes. Size: one line.

7. Share is missing from the folder actions (steps 04.4, 06.1)
   Why it matters: Share is a launch feature but only the small link glyph by the title opens it; the three dots, where people look, do not list it, although the right click menu does.
   Fix: Use folderSheetItems for the folder three dots (actions.js:215 folder-menu), so Share or Sharing is the first row, as on right click.
   Fits before 7 Nov: yes. Size: one line.

8. Phone users cannot see how to move, rename or trash a bookmark (steps 04.15)
   Why it matters: A tap opens the link; actions only appear after a long press, with no hint anywhere.
   Fix: Short term: a line in the empty state and How to save ("Hold a card to move, rename or trash it"). Later: a visible more button on phone cards.
   Fits before 7 Nov: yes for the hint. Size: small.

9. Sidebar More squeezes the folder list to two rows and hides its scroll bar (steps 04.13)
   Why it matters: At 800 px height with More open, folders below the second are out of sight and the hidden scroll bar gives no clue; More stays open across visits.
   Fix: Let the folder list keep a minimum height and show a thin scroll bar, or close More after an action and do not keep it open across visits.
   Fits before 7 Nov: yes. Size: small, app.css:198-199 and the stored foot state.

10. Move from the menu or selection bar gives no confirmation and no Undo (steps 04.7)
   Why it matters: The card just disappears; drag and drop says where it went and offers Undo.
   Fix: Route the Move sheet through moveWithUndo (actions.js:158).
   Fits before 7 Nov: yes. Size: one line.

11. A wrong second factor code empties both fields (steps 08.3)
   Why it matters: On a phone with a long password, every mistyped code means typing the password again.
   Fix: Post the login with fetch (the /api/login route exists) and keep the password field, or keep it through the redirect.
   Fits before 7 Nov: yes. Size: small.

12. The going back message names no file (steps 11.3)
   Why it matters: The person rolling back reads "restore a backup" without the name of the copy Pinned made for exactly this.
   Fix: Change store.go:210 to name the newest bookmarks-schemaN-*.db in the data folder and the README section "Going back to an older version". Helps every downgrade from 0.1.12 on.
   Fits before 7 Nov: yes. Size: small.

13. Server unreachable reads as a generic failure (steps 12.2)
   Why it matters: "Could not save. Try again." and "Bookmarks could not load." do not tell a home user that the server is off or the VPN is down.
   Fix: When fetch itself fails (no status), say "Cannot reach your Pinned server." in both places.
   Fits before 7 Nov: yes. Size: small, errorText fallback.

14. The extension is always dark (steps 02.19)
   Why it matters: 0.1.11 made every app page follow light and dark; the popup and options stay dark, which looks unfinished next to a light app.
   Fix: Give extras/extension/ui.css the same light tokens under prefers-color-scheme: light.
   Fits before 7 Nov: yes if the tokens copy over cleanly. Size: small to medium.

15. Lock dialogs have no close button (steps 05.6)
   Why it matters: Only Escape or a tap outside closes them; keyboard and screen reader users get no visible way out (P-WEB-2).
   Fix: Add the same close button the other sheets have to lockHTML.
   Fits before 7 Nov: yes. Size: one line.

16. Signed in lists identical names (steps 08.8)
   Why it matters: Two "Chrome on macOS" rows cannot be told apart.
   Fix: Show the sign in time with hours and minutes now (created_at is stored); add the address in a later version, it needs a new column in the sessions table.
   Fits before 7 Nov: yes for the time, no for the address. Size: small, then a schema change.

17. A second token needs the sheet reopened, and the token has no next step (steps 09.4)
   Why it matters: After Create the form is gone; nothing points to the extension options.
   Fix: Keep the form below the new token and add "Paste it into the extension options or your script."
   Fits before 7 Nov: yes. Size: small.

18. Smaller ones (steps 02.2, 06.4, 05.8, 08.4, 08.11, 01.5)
   Why it matters: No https:// added for a bare address in the app; share password minimum shown only after Set; phone lock note tight under its field; a reused code is called wrong; a signed out browser keeps showing data; no countdown on the 30 second wait.
   Fix: Add https:// like the extension does; put "8 or more characters" in the placeholder; add the gap; say "This code was just used, wait for the next one"; reload state on focus; show the time left.
   Fits before 7 Nov: yes. Size: small each.

## What fits before 7 Nov

17 of 18 gap entries fit, most of them one line to a small change. In order of impact:

1. The second factor hold says "Wait 30 seconds" while it lasts 1 minute up to a day
2. The extension options turn a home address into https and say only "Could not reach"
3. Export from the app leaves out locked folders without a word
4. Import shows nothing while it runs
5. The save sheet keeps an old error after the address is fixed
6. Share is missing from the folder actions
7. Phone users cannot see how to move, rename or trash a bookmark
8. Sidebar More squeezes the folder list to two rows and hides its scroll bar
9. Move from the menu or selection bar gives no confirmation and no Undo
10. A wrong second factor code empties both fields
11. The going back message names no file
12. Server unreachable reads as a generic failure
13. The extension is always dark
14. Lock dialogs have no close button
15. Signed in lists identical names
16. A second token needs the sheet reopened, and the token has no next step
17. Smaller ones

Does not fit: drawing very large libraries in pieces (gap 4). For 0.1.11, soften the README and CHANGELOG claim about 470000 link imports instead, or add "the app slows down above about 20000 links".

## Apple web standards (P-WEB-1 and P-WEB-2) where a flow shows a problem

1. P-WEB-1 (WebKit quality): login, Dashboard, How to save and the save page in WebKit at 390 and 1280, light and dark: no horizontal overflow, no console errors (log-w). Open: the 100000 link freeze (03.11) and the tight phone lock note (05.8).
2. P-WEB-2 (accessibility): axe (WCAG 2 A and AA) clean on login, Dashboard, How to save and the save page, phone and desktop, light and dark, in WebKit, and on Settings in Chromium. Option Tab in WebKit walks the sidebar with a visible ring. Open: lock dialogs without a close button (05.6); the second factor hold message that misinforms (08.5) also fails the error identification criterion in spirit.

## Left out or read from the code

1. Firefox and Safari as browsers for the extension: not loaded in this run. Chromium loaded it unpacked.
2. The browser permission prompt after Save in the extension options, and the right click menu: they cannot show in headless Chromium; read from the code.
3. Drag and drop of cards onto folders and the phone long press: read from the code (drag.js), drawn as dashed targets.
4. A reverse proxy with HTTPS, Tailscale and iCloud Private Relay: not set up here; the README troubleshooting covers them.
5. Icons: the run used ICONS=off, so every card shows its letter.
