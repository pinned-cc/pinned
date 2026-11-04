# Pinned user flows, as built

Pinned 0.1.12, the release-0.1.12 branch from a1fe24b. Each flow as numbered steps, written from the flow test of 04.11.2026 at v0.1.11 and, for the steps 0.1.12 changes, from the 0.1.12 build; the screens are in ../screens, the walk with each verdict in ../walk.html. The flow test of 31.10.2026 is in ../flow-test.md. One Mermaid diagram per flow sits next to this file.

## 01 First start and login

Diagram: 01-first-start-and-login.mmd

1. The owner starts the container with a password: APP_PASSWORD=... docker compose up -d.
2. Without a password, with fewer than 8 characters, or with a common one, the server does not start and says why.
3. Opening the app without a login goes to the login page.
4. A wrong password comes back with "Wrong password." and the caret in the field.
5. The fifth wrong try says "Wrong password. Wait 30 seconds before the next try.", the next one "Too many tries. Wait 30 seconds, then try again.", and the right password during the wait names the time left, such as "Wait 26 seconds". The line does not count down.
6. The right password lands on the empty Dashboard with Add bookmark, Import and How to save.
7. On the phone the same login, then Dashboard, Inbox and Folders tabs, the Settings gear, the search pill and the plus.
8. Light and dark follow the system; the bulb switches and the choice is kept per browser.
9. Password managers fill the login: the form carries a fixed user name.

## 02 Save a link, in the app, with the bookmarklet and with the extension

Diagram: 02-save-a-link-in-the-app-with-the-bookmarklet-and-with-the-extension.mmd

1. Add (desktop) or the plus (phone) opens the save sheet, the folder preset to the last one used.
2. An address typed without http, such as example.com, is refused on Save with "Enter a full address starting with http or https.", the caret at the end of the address. The extension options try https, then http.
3. Typing the address again removes the old error at once; the live check alone says the link is new or already saved.
4. An address already saved shows "Already saved in Homelab. Save anyway moves it here." and the button turns into Save anyway.
5. The same host on another port is a new bookmark: Not saved yet.
6. Choose another folder lists every folder and New folder.
7. Save closes the sheet and the card appears in its folder. No toast; screen readers hear "Saved in Homelab".
8. Bookmarklet: How to save, Computer, drag Save to Pinned into the bookmarks bar.
9. On any page Save to Pinned opens /save in a small window with title, address, recent folders and Log out.
10. Saving draws a tick and closes the window; where the browser keeps it open, a Saved state with Done.
11. Extension: How to save, Extension: download, unzip, load unpacked; "a token" opens API tokens. Firefox removes it when it quits, so after a restart it is loaded again with a new token.
12. With a token made (flow 09), the extension options take the address and the token.
13. A home address typed as most people write it, 10.0.0.5:9095, tries https, then http, and Test says "Connected to http://10.0.0.5:9095, 5 folders." An address typed with http:// for a host outside the own network first says "On plain http your token may cross the internet unencrypted. Use https, or click Test again to connect anyway." (Save: "click Save again to save anyway") and goes ahead on a second click of the same button.
14. With http:// Test says "Connected, 5 folders"; Save stores both and asks the browser for access to that host.
15. The toolbar button or Option Shift S opens the popup: title selected, address, three recent folders, Save to Inbox.
16. Saved: the tick draws and the popup closes.
17. The same page again: "Already saved in Homelab / Network." with Save anyway.
18. On a browser page: "This page cannot be saved".
19. The popup and options are always dark, while the app and its pages follow light and dark since 0.1.11.
20. Right click a page or link, Save to Pinned: it goes to the Inbox and the button shows a tick, = when already saved, ! on failure.
21. iPhone and Android: How to save shows the Safari bookmark and the home screen share target.

## 03 Find and open

Diagram: 03-find-and-open.mmd

1. / or Command K or a click on the search field opens the search over the blurred app, with recent opens.
2. Typing filters by title, address and host, grouped by folder, the first hit marked.
3. Enter opens the marked link in a new tab and records it for Recently opened.
4. No match: "No matches."
5. Escape clears the query first, a second Escape closes the search.
6. From the browser address bar: /search?q=portainer opens the app with that search.
7. A click on a card opens the link in a new tab; Command click opens it behind.
8. The Dashboard keeps the pinned row and Recently opened, else Recently saved.
9. On the phone the search pill opens the same search as a sheet.
10. Links in a locked folder never show in search.
11. After a very large import, All bookmarks draws the first 240 cards with "Show all 100000" in under a second; Show all and scrolling keep every frame short, and the search finds any link.

## 04 Organise folders

Diagram: 04-organise-folders.mmd

1. The plus next to Folders, or N, opens New folder; Create opens the new empty folder.
2. The empty folder offers Add bookmarks, a picker of links saved elsewhere.
3. Moving them shows "Moved 2 to Media" with Undo.
4. The folder three dots: Share first, then Add bookmarks, New folder inside, Rename, Move to, Hide from Recent, Lock with a password, Delete.
5. Move to moves a folder under another or to the top level.
6. A card shows Share, Open, Trash and More on hover; More holds Move, Copy, Share, Trash, Open, Rename, Pin.
7. Move from the card's More or the selection bar says "Moved to Work" with Undo, as a drag onto a folder does; Undo puts it back.
8. Dragging a card onto a folder in the sidebar moves it with Undo.
9. Rename in place: F2 or the menu, Enter saves, Escape cancels.
10. Trash on a card: "Moved to Trash" with Undo.
11. Trash keeps links 30 days; a card offers Restore and Delete now, which asks first; Empty trash asks first.
12. Delete folder asks first and says where its links go: "Delete Media? 2 bookmarks go to Trash."
13. With More open at 1280 by 800 the folder list keeps 4 of 5 folders in view and the actions scroll in their own space. The folder list's scroll bar is hidden, so the fifth folder gives no sign, and More stays open after a reload.
14. Phone: Folders tab, a folder, the three dots as a sheet.
15. Phone: a tap opens the link; Move, Rename and Trash come only after a long press starts selecting, and nothing on screen says so.

## 05 Locked folders

Diagram: 05-locked-folders.mmd

1. Folder actions, Lock with a password: Password, Repeat password, a Close button, and 6 px below the second field the note "Use at least 8 characters. Links in this folder stay out of sight everywhere until you unlock it. The password cannot be recovered."
2. Fewer than 8 characters, two that differ, or one too easy to guess are named under the fields: "Use at least 8 characters.", "The passwords do not match.", "This password is too easy to guess. Choose another one."
3. Lock goes back to the Dashboard with "Folder locked"; the sidebar shows the name with a lock and no count.
4. A locked folder is gone from search, Recent and the counts.
5. A click on it opens Unlock; a wrong password says "Wrong password"; the right one opens it for 10 minutes.
6. The lock, unlock and remove lock dialogs have a Close button in the head, 44 by 44; Escape and a tap outside close them too.
7. Unlocked, the folder actions offer Relock now and Remove lock, which asks the app password.
8. On the phone the lock dialog note sits 6 px below the Repeat password field, as on the desktop.

## 06 Share links

Diagram: 06-share-links.mmd

1. In a folder the link glyph by the title opens Share.
2. On: the link with Copy, and Share where the system has a share sheet.
3. Copy says "Copied".
4. Share with a password: "Use at least 8 characters." sits under the field before Set; a shorter one then says "A share password needs at least 8 characters."
5. Set: Locked with Change and Remove; Expires Never, 1, 7 or 30 days with the end date; "Not opened yet".
6. The visitor gets the folder name and Password; a wrong one says "Wrong password."; the right one shows the cards with a search.
7. On a phone the visitor page is the same.
8. Share with a link off asks "Stop sharing?"; afterwards the visitor sees "This link does not work."
9. Locking a shared folder ends its link, and the lock sheet says so.

## 07 Import and export

Diagram: 07-import-and-export.mmd

1. More in the sidebar (desktop) or Settings (phone), Import, pick a browser bookmarks file.
2. While it runs a toast says "Importing. This can take a moment for a big file." and every Import is disabled and busy. 100000 links (17.4 MB) take about 9 seconds.
3. Done: "Imported 15, skipped 0", folders kept.
4. The same file again: "Imported 0, skipped 15".
5. A file that is not a bookmarks file: "Not a bookmark file."; folders more than 256 deep: "The folders in this file nest more than 256 deep. Pinned cannot import it."
6. Export downloads bookmarks.html.
7. With a folder locked in this browser the export leaves it out and says so: "Exported without Finance: it is locked. Unlock it first to include it."
8. The nightly export/bookmarks.html in the data folder holds everything, locked folders too.

## 08 Second factor and Signed in

Diagram: 08-second-factor-and-signed-in.mmd

1. The owner makes a secret, sets TOTP_SECRET, restarts and adds it to the authenticator by hand; a bad secret stops the start with a message.
2. The login shows Password and Code; Enter in the password moves to the code.
3. A wrong code says "Wrong password or code. A code works once: wait for the next one." and both fields are empty again.
4. The same code used in a second browser inside its 30 seconds is refused with "A code works once: wait for the next one."
5. After 5 wrong codes in a row: "Wrong password or code. Wait 60 seconds before the next try.", then "Too many tries. Wait 59 seconds, then try again."; the right code during the hold names the time left, and after the wait it logs in.
6. Browsers logged in before stay logged in; API tokens need no code.
7. More, Signed in: each browser with its sign in day and last use, this one marked.
8. Two browsers of one kind read the same, "Chrome on macOS", with no address or place to tell them apart.
9. Sign out, or Sign out all others, asks for the app password; a wrong one says "Wrong password".
10. Done: "Other browsers signed out".
11. The signed out browser keeps showing every bookmark until it next asks the server for something.
12. Lost the authenticator: remove TOTP_SECRET and restart.

## 09 API tokens

Diagram: 09-api-tokens.mmd

1. More, API tokens (or "a token" on How to save): the empty state says what a token can and cannot do.
2. Name and app password, Create; a wrong password says "Wrong password" and keeps the name.
3. The token shows once with Copy and "Copy it now. It is not shown again."
4. After Create the sheet says "Next, paste it into the extension's options with the address" of this server "or into your script." The form is gone: a second token needs the sheet closed and opened again.
5. The token reads folders (200) and cannot export (403).
6. The list shows when each token was made and last used.
7. Revoke asks in the row, then "Token revoked"; the token now answers 401.

## 10 Settings

Diagram: 10-settings.mmd

1. Every setting is an environment variable in the compose file.
2. Phone: the gear opens Settings with How to save, API tokens and their count, Import, Export, What's new, Source, Signed in, Log out.
3. Desktop: the same under More in the sidebar.
4. What's new shows the changelog, the last three releases open and older ones folded; the release you run is marked "This version", also on a release image whose version starts with v.
5. A new APP_PASSWORD ends every login, token and device cookie after the restart.
6. Log out goes back to the login page.

## 11 Backup and going back a version

Diagram: 11-backup-and-going-back-a-version.mmd

1. Backing up: sqlite3 .backup, or stop, copy the data folder, start.
2. Upgrading names the copy in the log: "database: upgrading from schema 6 to 12; the database as it was is saved at .../bookmarks-schema6-....db".
3. Going back, 0.1.10 refuses: "database was written by a newer Pinned (schema 12); this version knows 6. Update the image or restore a backup." It names no file. From 0.1.11 on, a version that refuses a newer database names the copy to restore and the README section.
4. Restoring as the README says (move bookmarks.db aside, copy the schema 6 file in, no -wal or -shm) brings 0.1.10 back with all 15 bookmarks and 5 folders.
5. Links saved after the upgrade are not in that copy; the README says to export them first.

## 12 Errors

Diagram: 12-errors.mmd

1. Wrong password, and the wait after 5 tries with the time left (01.4, 01.5).
2. The server stops while the app is open: Save says "Cannot reach your Pinned server. Check your connection, then try again."
3. The cards stay on screen, dimmed, under "Cannot reach your Pinned server." with Retry. On the phone, when the server cannot be reached at the first load, the head with the bulb and the Settings gear shows above the tabs and the notice.
4. Retry while still down shows the same notice.
5. A reload while down shows the browser's own error page.
6. A bad import file is refused with a message (07.5).
7. A login that ended elsewhere sends the next request to /login?next=..., back to the same place after logging in.
8. A revoked or expired share link says "This link does not work."
