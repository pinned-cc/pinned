# Changelog

Everything that changes for people who run the app goes here. Versions follow semantic versioning once the first release is tagged.

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
