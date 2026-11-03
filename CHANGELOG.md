# Changelog

Everything that changes for people who run the app goes here. Versions follow semantic versioning once the first release is tagged.

## 0.1.11

Not released yet.

### New

- Before Pinned upgrades the database to a new version, it saves a copy of the database as it was in the data folder, for example `bookmarks-schema6-2026-10-30-154210.db`, and names it in the log. The last three copies are kept, and a failed upgrade that starts again replaces its own identical copy instead of adding one. If the copy cannot be written, Pinned does not upgrade and stops with a message, and the database stays as it was. The README says how to go back to an older version with one of these copies.
- An optional second factor for the login. Set `TOTP_SECRET` (or `TOTP_SECRET_FILE`) to a base32 secret and add it to your authenticator app by hand; the login then asks for a six digit code as well as the password. API tokens keep working without a code. The README says how to make a secret.
- Signed in, under More on the desktop and in Settings on the phone, lists the browsers that are logged in, with when they signed in and were last used, and signs out one of them or all others.
- `APP_PASSWORD_FILE` reads the app password from a file, for Docker or compose secrets.
- `pinned -licenses` prints the licences of the third party parts built into the binary: the common and breached password lists from SecLists (MIT), the Geist fonts (SIL Open Font License), and the licence files of every Go module in the binary and of Go itself.
- New settings `ICONS` and `ICON_HOSTS`. `ICONS=off` stops every icon fetch, so nothing leaves the server and bookmarks keep their letter mark. `ICON_HOSTS` keeps icon fetches to the host names you list.
- The save page and How to save have a Log out.
- Logs record logins, failed logins, lockouts, logouts, API tokens, folder locks and unlocks, share links and unlocks, refused cross site requests and failed icon fetches as `security event=...` lines with the client address, never a password, token or cookie.
- docs/security.md lists the limits Pinned enforces, the cryptography and keys it uses, what it stores and how it protects it, and what it logs.

### Fixes

- Behind a reverse proxy, `X-Forwarded-Proto` is now believed only from `TRUSTED_PROXIES`, or from the same machine (loopback) when that is empty. Before, any private address counted, and behind Docker's published ports every client arrives from one. If your HTTPS proxy runs in another container or on another machine, set `TRUSTED_PROXIES` to its address or network, or `BASE_URL` to the `https://` address, so the login cookie keeps its Secure flag.
- A very long made up `Host` header could keep the password check busy for minutes. Host names longer than a DNS name now add nothing to it, and request headers are capped at 64 KB.
- The login page showed odd waits for a made up `wait` value in its address. It now takes only a whole number of seconds up to a day, and otherwise shows the plain message.
- For screen readers, the hidden page headings, the share page footer and the share search on the phone now sit inside landmarks.
- A site with a broken favicon.ico could stop the server, and it stopped again at every start until the bookmark was removed by hand. A broken icon now leaves the letter mark and the server keeps running.
- A link whose icon fails three times is no longer fetched again at every start. Saving it again, changing its address, Refetch icon or the next version try again. Only lasting failures count: an error page, a broken icon, a certificate that is not trusted, a redirect loop, a domain that does not exist. A network outage at start, a DNS server that does not answer, a refused or reset connection or a timeout does not.
- In the browser extension's options, an address typed with another scheme, such as `ftp://example.com`, was turned into `https://ftp//example.com`. It is now refused with the message to enter an address starting with http or https.
- An import file whose folders nest more than 256 deep could stop the server. It is now refused with a message.
- Someone guessing passwords from many addresses could make every login wait, yours included. A browser that logs in with the password now keeps a signed device cookie, is counted on its own and is no longer held by that limit. Changing the app password ends these cookies. Other browsers keep the limit as before.
- A large import no longer makes saves and logins fail while it runs: the file is saved in short steps, so saving and logging in from other browsers go on meanwhile, and it is much faster than before. A view with more than 240 links, such as All bookmarks after a large import, shows the first 240 with the count and Show all. Show all draws the rest in steps as you scroll. Before, All bookmarks held the page for about 2 seconds at 10000 links and froze it at 100000.
- On the keyboard, Tab moves through every sheet again (it stayed on the first button), and on the desktop Tab goes on past the search field to the rest of the page. Escape in the search leaves the focus in the search field. Enter in the search field opens the search.
- Deleting a bookmark from Trash for good now asks first, like Empty trash.
- Login, How to save, the save page and shared folders follow light and dark like the app. They were always dark.
- Folder colours in light mode, the picked folder in the folder pickers, search hits and the light switch are easier to read, the share page footer too. Touch targets on How to save, the folder share button and the card buttons are at least 44 px.
- What's new can be reached again at window widths between 720 and 999 px.
- Opening a shared folder with a password no longer shows an error in the browser console.
- A shared folder moved into a locked folder keeps no share link. Before, its link stayed alive and could not be seen or revoked while the parent was locked.
- Logging in ends the login the browser held before.
- An SVG icon is kept only when everything in it is on a list of drawing elements and attributes; anything that could run script, link or load from outside is refused and the letter mark is shown. An SVG icon that passes is stored as a new SVG written from that list, never as the site sent it, and a picture inside it as a new PNG. PNG, JPEG and GIF icons are stored as a new PNG, so nothing hidden in the file is kept. GIF icons now show.
- Icons saved by older versions are checked at the first start: PNG and JPEG icons are stored again as a new PNG, SVG icons as a new SVG, and an icon that does not decode or an SVG that fails the new check is removed, so the letter mark shows. The old PNG, JPEG and SVG files stay in the icons folder and are not served, so going back to 0.1.10 with the saved database copy still shows them.
- The icon fetch refuses more special network ranges (such as NAT64 and 6to4), IPv6 addresses with an interface name (such as `fe80::1%en0`), ports other than 80, 443 and the bookmark's own, and redirects from https to plain http.
- A login, share or folder password held after too many tries now says how long the wait really is, for example "Too many tries. Wait 2 minutes, then try again." Before, it always said 30 seconds, also when the second factor held logins for a minute or more.
- With the second factor on, a wrong code says that a code works only once, so wait for the next one.
- The wrong password that starts a wait now says both: "Wrong password. Wait 30 seconds before the next try." Before, it said only to wait.
- After the save sheet refuses an address, the caret waits at the end of it, so typing goes on from there.
- In the browser extension's options, an address typed without `http://` or `https://`, such as `10.0.0.5:9095`, is tried with https first and then with http, and the one that answers is kept. The token goes over plain http only to an address on your own network (a private, loopback, link-local or Tailscale `100.64.0.0/10` address, a name without a dot, or a `.local`, `.lan`, `.home.arpa` or `.internal` name); for any other host the extension says that http answers and to type `http://` to use it anyway, so a blocked https never hands your token over unencrypted. Test says which address it reached, or which addresses it tried when none answered. Before, it only tried https, which fails for a home server on plain http.
- When the data folder belongs to another user, as when Docker made a missing `./data` as root, Pinned now stops with a message that names user 1000 and the command that fixes it: `sudo chown -R 1000:1000 ./data`.
- The one command install for a server (`extras/vps/setup.sh`) now publishes Pinned on that server only (`127.0.0.1`) and ends with the next step: put HTTPS in front. To reach it on plain http from other machines, set `PINNED_BIND=0.0.0.0`; the script then warns that your password crosses the network unencrypted, for any address that is not the server itself. It installs the image of its own release instead of `latest`, and Docker's installer from one pinned commit checked by its checksum. The installer download gives up after a time limit and tries again on a passing fault, every other request has a time limit, and it finds the server's address itself before it asks ifconfig.me. Right after it installs Docker, it runs Docker with sudo for a user who is not yet in the docker group. It keeps the password in a file that the container reads (`APP_PASSWORD_FILE`) instead of `.env`, where a `$` or ` #` in it was changed, and it says Pinned runs only once it answers. `PINNED_BIND=127.0.0.1` publishes the port on the server only, for a proxy on the same server, since a firewall such as ufw does not block Docker's ports.
- How to save and the extension's README say that Firefox removes a temporary add-on when it quits, so after a restart you load it again and give it a new token.
- Export says when it leaves out folders locked in this browser, and that you unlock them first to include them.
- While an import runs, a toast says so and Import is disabled until it ends.
- In the save sheet, an error about the address goes away as soon as you type the address again.
- The folder's three dots menu has Share, as the right click menu already had.
- When the server cannot be reached, the app says "Cannot reach your Pinned server" instead of "Could not save" or "Bookmarks could not load".
- Moving bookmarks from the Move sheet shows where they went, with Undo, as a drag did already.
- The lock, unlock and remove lock dialogs have a Close button.
- With More open in the sidebar on a window about 800 px high, the folder list keeps four folders in view and the actions scroll in their own space. Before, only two folders showed.
- A new API token says the next step: paste it into the extension's options with this address, or into your script.
- The share password field says the password needs 8 or more characters before you set it, as a line under the field that stays while you type and that screen readers read with it.
- From this version on, when Pinned refuses a database that a newer version upgraded, the message names the copy to restore from the data folder.
- Going back to an older version with the database copy is now described plainly, in the README and in the message that names the copy: the copy is your data before the upgrade, so folders you locked, passwords you changed, share links and API tokens you revoked and browsers you signed out since are back as they were. Lock those folders and revoke those links again after going back, and change `APP_PASSWORD` to end every token and session.

### Changes

- Over HTTPS the login cookie is named `__Host-pinned_session`. You stay logged in: the old cookie moves to the new name on your next visit. Plain http on your network works as before.
- New setting `HSTS`, off by default. `HSTS=true` sends `Strict-Transport-Security` on HTTPS answers. Switch it on only when Pinned has its own host name on the public internet and the proxy does not already send it, since it applies to every port of that host name.
- `X-Forwarded-Proto` is believed only from `TRUSTED_PROXIES`, or when that is empty from loopback, private and `100.64.0.0/10` addresses. When `BASE_URL` starts with `https://`, a request for that host without the header counts as HTTPS, so the cookie behind `tailscale serve` is Secure too.
- The database gets a new table for failed icons. 0.1.10 does not start on it any more; to go back, use the copy saved before the upgrade.
- The bookmarks the app loads are sent gzipped when the browser accepts it: in a test with 100000 links, 31 MB became 2.4 MB.
- Pages load faster on the second visit: the scripts, styles and fonts carry a validator, so the browser checks them and downloads nothing when they have not changed.
- Images are built with Go 1.27.3, which fixes a certificate check flaw in Go 1.27.2 (GO-2026-6809), and golang.org/x/net 0.62.0.
- New share links keep the token after `#`, for example `https://host/s/#token`, so it never reaches the server's or a proxy's log. Links made before keep working.
- Wrong share and folder passwords are counted per link and per folder, and a browser that has logged in with the app password is counted on its own, so someone with one link cannot block the others.
- Sessions end at the latest `SESSION_MAX_DAYS` (365 by default) after the login, however often they are used. `SESSION_DAYS` stays the time a login lasts without use. Logins from before count from the upgrade.
- A new `APP_PASSWORD` now also revokes every API token, as it already ended sessions and device cookies.
- Creating an API token asks for the app password again.
- Signing out other browsers in Signed in asks for the app password.
- With the second factor on, wrong codes after the right password hold every login for a time that grows from one minute up to a day; the right code clears it.
- An API token used by the browser extension works only with that extension: requests from any other web page or extension are refused, scripts without an origin keep working. After reinstalling the extension in Firefox or Safari, create a new token.
- Changing the password of a locked folder through the API needs its current password.
- The export in the app leaves out folders that are locked in that browser. The nightly export in the data folder still holds everything, it is the backup.
- Saving, checking or importing a link no longer tells whether it sits in a locked folder: a link that is only in a locked folder is saved again where you save it, so after unlocking it can show twice. The `/health` answer no longer carries a bookmark count.
- Site icons are served only for bookmarks you can see, so icons of locked folders stay hidden.
- Bookmark addresses can be at most 8192 bytes. An import skips longer ones and counts them as skipped.
- Data files are readable only by the user Pinned runs as: folders 0700, files 0600. At start Pinned makes files from older versions private too. A backup job that reads `export/bookmarks.html` as another user needs the same user or a group change.
- The app password is kept as a bcrypt hash in the database instead of a fast keyed hash. When the hash cost is raised, lock and share password hashes are strengthened at the next right password without ending the unlocks of other browsers.
- A new folder password needs at least 8 characters, as share passwords and the app password already did. Folders you locked before with a shorter password keep opening with it; only a new or changed password is checked.
- Common passwords are refused: the 10000 most common ones, and passwords made of words like pinned, bookmark, password or your host name, also with digits or symbols (`Pinned2026!`, `p@ssw0rd`). For a folder or share password you see "This password is too easy to guess. Choose another one." A new install with such an `APP_PASSWORD`, or a change to one, does not start and says so: choose another one and start again. If your `APP_PASSWORD` already ran under an older version, Pinned still starts after the upgrade, writes a warning to the log and shows one in the app: set a stronger one and restart. The check runs inside Pinned; no password is sent anywhere. Pinned does not make passwords for you: use your own password manager.
- New app, folder and share passwords are also checked against 1000000 passwords from public breach lists, built into the app, so no password is sent anywhere.
- Folder and share passwords can be as long as you like, in any script. Before, more than 72 bytes (64 letters such as ü) was refused. Your existing folder and share passwords keep working, and each moves to the new kind of hash the next time it is typed correctly. For a folder or share password set before 0.1.11, other browsers that had it unlocked type it once more after that.
- Folder and share passwords are now tied to `secret.key`. If you replace that file, remove each folder lock with the app password and lock it again, and set each share password again.
- Log lines carry the time in UTC with the zone.
- Bookmarked sites no longer see which Pinned address a link was opened from (`Referrer-Policy: no-referrer`). The content policy also forbids plugins and base elements, and icons can never be framed. SVG answers name their charset.
- Over HTTPS, the folder unlock and share cookies get the `__Host-` or `__Secure-` prefix, and a device cookie from plain http moves to the prefixed name.
- The developer note under `/extras/README.txt` is no longer served.
- The database goes to schema 12: an index for positions in folders, columns for sessions, API tokens and password stamps, and the address of a bookmark is no longer unique across locked folders. 0.1.10 does not start on it; to go back, use the copy saved before the upgrade.
- Images are built with a software bill of materials and provenance, and CI checks the Go modules with govulncheck. Dependabot waits a week before proposing a new version.

## 0.1.10, 2026-10-28

### Fixes

- In light mode on the phone, the selected tab no longer carries a heavy dark shadow. It now has a thin edge and a soft shadow, like the rest of light mode.

## 0.1.9, 2026-10-24

### New

- Light mode, in the paper and ink of pinned.cc. Pinned follows your system until you pick one with the bulb: bottom right on the desktop, next to the gear on the phone. Your pick is kept in that browser.

### Changes

- Dark mode is calmer: one flat background without the coloured glow, and softer card edges.
- No more lines between the sidebar, the pinned row and the content. The background carries the whole screen.
- The name, the page title and Recently opened are set in a serif.
- A little more room under the search.

## 0.1.8, 2026-10-23

### Changes

- How to save is lighter: the steps sit on the page without boxes, the text is brighter, and only the device you pick is marked in the tabs.
- The iPhone steps show the Safari screens you tap through: the Share sheet, Edit Bookmark and your Favorites.

## 0.1.7, 2026-10-23

### New

- What's new: the version under More, and What's new in the phone's Settings, open the releases in a sheet. The last three are open, older ones fold away.
- How to save is steps with small pictures instead of paragraphs, with a tab for iPhone, Computer, Android and the extension. The tab for your device opens first, and Copy shows a tick.
- How to save explains the black page in Safari with iCloud Private Relay and a Tailscale address, with the one line to add in Tailscale and a Copy button.
- How to save says which iPhone browsers can open Pinned as the start page, with the steps for Firefox, Vivaldi and Safari and your address to copy.

### Fixes

- Behind `tailscale serve`, the Save code uses https when your browser is on https, instead of the http the server saw.

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
