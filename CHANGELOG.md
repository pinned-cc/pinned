# Changelog

Everything that changes for people who run the app goes here. Versions follow semantic versioning once the first release is tagged.

## 0.1.6, 2026-10-23

### Changes

- Until you open a link, the Dashboard shows the links you saved last, under Recently saved, so a new install is not empty. After the first open it shows Recently opened as before.

## 0.1.5, 2026-10-22

### Fixes

- On iPhone, the login page no longer zooms in when a password manager fills it.
- Coming back to the app on a phone no longer shows "Bookmarks could not load" when the first refresh is too early for the VPN: it tries once more after a moment, and warns only if that fails too.

## 0.1.4, 2026-10-22

### Changes

- A fresh install points to How to save from the empty Dashboard.
- How to save tells you to keep the extension folder in place, to allow access to your server, and the Option Shift S shortcut.

## 0.1.3, 2026-10-22

### Changes

- The save panel and the extension popup move less: a short soft fade in, a tick on Save, and the window closes about 0.7 seconds after the press. The pin no longer drops onto the favicon.

## 0.1.2, 2026-10-22

### New

- N opens New folder, and New folder is an action in the search palette.
- The New folder plus beside Folders and on the phone Folders tab is a small filled circle.
- The search palette has actions, as in Raycast: with a bookmark highlighted, Cmd K again (Ctrl K elsewhere) or the Right arrow at the end of the field lists Open, Pin or Unpin, Move to folder, Rename, Copy link and Move to Trash. Arrows move, Enter runs, Escape or the Left arrow go back. Enter on a result still opens it.
- The save panel has a soft gradient and moves: it glides in, the Save button draws a tick and the icon's pin drops onto the favicon, then the panel eases out before the window closes.
- The save window opened by the bookmarklet fits the panel, 392 by about 530 instead of 392 by 760, and grows when the folder list opens or the address is already saved.
- One calm gradient sits behind the app, the phone layout and the share page. Cards and folders are a clear tint over it with a softer rim and a small shadow; the sidebar, sheets, menus and the search panel blur it. Anything moving, lifted, pressed, held or dragged stays solid.
- The Save button page is now How to save. Its address stays /bookmarklet.
- On How to save, "a token" in the extension steps opens the app with API tokens open (`/#tokens`).

### Fixes

- Add no longer turns blue on hover.
- Every favicon and letter sits on the same graphite tile, also when an icon fails to load.
- The faint text, the action bar on a card, the Save button page and the expired share page use the graphite palette.
- The settings icons take the colour of their row.
- No matches on a share page is an empty state like the app's, with Clear search. Inside a subfolder it names that folder and offers the matches in the whole shared folder.
- In the list while selecting, the date moves left of the tick instead of under it.
- Every address line has the same line height.
- The browser extension uses the graphite palette and the green accent of the app.
- The browser extension's icons are the app icon instead of the old blue mark.

## 0.1.1, 2026-10-18

### Fixes

- During the 30 second wait after five wrong passwords, no password is checked, not even the right one. Tries from one address are checked one at a time, and after 100 wrong tries within 10 minutes from all addresses together everyone waits. This covers the login, share passwords and folder passwords.
- Icon fetches go only to public addresses, on every redirect too. A bookmark on your own network can still load its icon from its own host.
- Delete for several selected bookmarks only removes bookmarks that are already in Trash.
- Bookmark titles are cut at 500 characters and folder names at 200.
- A database written by a newer version is refused on start with a message, instead of being opened by an older one.
- The server setup script asks for the password when run as `curl ... | sh`, and says to set `APP_PASSWORD` where there is no terminal.
- README: the image is published, and the setup one-liner works as written.
- Sheets on the phone read as solid, and the selection bar steps out of sight while one is open.
- Dragging a card onto the Folders tab on Android Chrome no longer drops the card when the folders open.
- Search hides Recent while you type.
- More in the selection bar has its word on a computer too.
- When the selection bar runs short, Share folds to its icon first and Copy keeps its word.
- The right click menu on a card lists the same actions in the same order as the selection bar and its More.
- The name of a new API token is no longer wiped when the token list finishes loading.
- The iPhone and Mac Shortcut is removed.

## 0.1.0, 2026-10-18

The first release.

### Bookmarks

- Folders that nest, with counts, rename, move and delete. Deleting a folder sends its bookmarks to Trash.
- An Inbox for links saved without a folder.
- A Trash that keeps bookmarks for 30 days, with restore, permanent delete and Empty trash.
- A pinned row with its own order.
- A Dashboard with the links you opened lately, under Today, Yesterday, This week and Earlier.
- Grid and list view. Sort by your own order, name, date saved or date opened.
- Drag to reorder bookmarks and folders, and to move bookmarks into a folder.
- Select bookmarks or folders the same way on a phone and a computer: hold a card and let go, Shift click, Cmd A or a box drawn around them. One selection bar everywhere with Move, Copy, Share and Trash, with Undo after Trash. A tap on an empty spot stops selecting.
- Drop bookmarks or folders on Trash.
- One search: at the top on a computer, at the bottom on a phone, and the words you typed stay when the window changes size.
- Search over titles and addresses, including host and port, and a palette on Cmd K with results grouped by folder.
- Keyboard: `/` and Cmd K search, arrows move, Enter opens, Delete trashes, Escape clears, Cmd Z undoes.
- Host plus port is the identity of a link, so services on one address with different ports are separate bookmarks. Saving a link that exists shows where it is saved.
- Site icons fetched by the server, with a tile colour taken from the icon's edge.

### Saving

- A Save button (bookmarklet) for the Mac bookmarks bar and Safari on the iPhone.
- A home screen app on the iPhone and Android, and an Android share target.
- An iOS Shortcut for the share sheet.
- A browser extension for Brave, Chrome, Edge and Firefox.
- API tokens for scripts, with examples for the terminal, Raycast, Home Assistant, n8n and RSS or Atom feeds.
- Search from the browser address bar through OpenSearch.

### Privacy and sharing

- Locked folders with their own password, hidden everywhere in the app until unlocked for 10 minutes.
- Read only share links for a folder, with an optional password, an expiry, revoke, and an open count.

### Data

- One SQLite file, upgraded on start.
- Import and export in the browser bookmarks format. Import keeps folders and skips links that are already saved.
- A nightly export to `export/bookmarks.html` in the data folder.

### Running it

- One static binary with the web files inside it, and a Docker image for amd64 and arm64 that runs as user 1000.
- `/health` for monitoring.
- `pinned -version` prints the version; `pinned -healthcheck` is the image's Docker health check.
- The example compose file runs the container read only, with all capabilities dropped and no new privileges.
- Images are tagged with the version (`X.Y.Z` and `X.Y`) and `latest` on releases, `main` on the main branch, and `sha-<commit>` always.

### Security and limits

- `APP_PASSWORD` must be at least 8 characters. Changing it signs out every session at the next start; API tokens stay.
- Logins last 90 days by default (`SESSION_DAYS`) and are renewed while in use.
- API tokens can only read the state and the folders, check a link, save a bookmark, and change a saved bookmark's title or folder. Everything else is refused with a token.
- Wrong app passwords, tokens and share passwords are counted apart, per address, IPv6 per /64. Each wrong try waits one second; 5 wrong tries mean a 30 second wait.
- `TRUSTED_PROXIES` lets the app read the visitor's address from `X-Forwarded-For` behind a reverse proxy.
- Share passwords need at least 8 characters.
- Import is capped at 20 MB and folders nest at most 32 deep. An import never writes into a locked folder.
- Site icons are refused above 4096 by 4096 pixels or 16 million pixels, and above 2 MB.
- A Content Security Policy and other security headers on every response.
- `/health` without a login answers only `{"ok":true}`.
- A `secret.key` that is too short stops the start with a message instead of being replaced.
