# Security details

What the server enforces, which keys and algorithms it uses, what it stores and how, and what it logs. The numbers are the ones in the code. To report a problem, see `SECURITY.md`.

## Limits

### Requests

| What | Limit |
|---|---|
| A JSON request body (everything but import and the login form) | 1 MB |
| Login form body | 64 KB |
| Import file | 20 MB |
| Request headers | 1 MB, Go's default |
| Reading the request headers | 10 seconds |
| Reading the whole request | 60 seconds |
| Writing the answer | 120 seconds |
| An idle kept-alive connection | 120 seconds |
| Finishing open requests at shutdown | 10 seconds |

The server speaks plain HTTP on `PORT` (8080 in the container). HTTPS is the job of a proxy in front, see Behind a reverse proxy in the README.

### Input

| What | Rule |
|---|---|
| Bookmark address | `http` or `https` with a host. New and changed addresses are at most 8192 bytes; addresses saved before this limit are left alone. |
| Bookmark title | Trimmed and cut to 500 characters. An empty title on a new bookmark becomes the host. |
| Folder name | Trimmed, cut to 200 characters, not empty. Folders nest at most 32 deep. |
| API token name | Trimmed, cut to 80 characters, not empty. |
| `APP_PASSWORD` | At least 8 characters, no upper limit: the stored hash is bcrypt over its SHA-256. The app does not start with a shorter one. |
| Folder password | At least 4 characters, at most 72 bytes. |
| Share password | At least 8 characters, at most 72 bytes. |
| Share expiry | 1 to 3650 days, or never. |
| `TOTP_SECRET` | Base32, at least 16 bytes (26 characters). |
| `SESSION_DAYS`, `SESSION_MAX_DAYS` | Whole numbers above 0. |

An import file is parsed as a browser bookmarks file. Folders that nest more than 256 deep refuse the whole file before anything is written. Folders deeper than 32 land in the folder at depth 32. Folder names are cut to 200 characters. Links that are not `http` or `https`, that are longer than 8192 bytes, or that are already saved outside a locked folder are skipped.

There is no cap on the number of bookmarks, folders, API tokens or signed in browsers. A folder has at most one share link.

### Wrong passwords and tokens

| Check | Counted per | Wait | Cap for everyone |
|---|---|---|---|
| App password: login, the second factor code, creating an API token, removing a folder lock, signing out other browsers | client | 30 seconds after 5 wrong tries | 100 wrong tries in 10 minutes |
| API token | client | 30 seconds after 5 wrong tries | 100 wrong tries in 10 minutes, counted apart from the login |
| Share password | client, for each share link on its own | 30 seconds after 5 wrong tries | 100 wrong tries in 10 minutes for that link |
| Folder password: unlocking, changing it | client, for each folder on its own | 30 seconds after 5 wrong tries | 100 wrong tries in 10 minutes for that folder |
| Second factor code after the right password | everyone together | 1 minute after 5 wrong codes in a row, doubling with each further wrong code up to 1 day; a right code clears it | the wait itself |

- A client is its address, IPv6 by its /64. A browser that has logged in with the app password carries a signed device cookie and is counted by that cookie instead; the cap for everyone does not hold it.
- Every wrong try waits 1 second before it answers. Password tries from one client are checked one at a time.
- During a wait no password is checked, not even the right one, and the answer is 429 with `Retry-After`.
- A valid API token is never held by these counts.
- A wrong second factor code also counts as a wrong app password for its client. While the code wait holds, no login is checked at all, from any browser, so a wrong and a right password answer alike. Someone who has the password can try at most 15 codes in the first day and about one a day after that. To get in during a wait, wait, or remove `TOTP_SECRET` and restart.
- The counts live in memory. A restart clears them, and a client quiet for an hour is forgotten.

### Sessions and cookies

| What | How long |
|---|---|
| A login, unused | `SESSION_DAYS`, 90 days by default. Using it renews it, at most once a day. |
| A login, however much it is used | `SESSION_MAX_DAYS`, 365 days by default, from the login. |
| Device cookie (counts wrong passwords by browser) | 400 days, or until `APP_PASSWORD` changes. |
| An unlocked folder | 10 minutes in that browser. |
| An unlocked share link | 7 days in that browser. |
| An API token | Until it is revoked or `APP_PASSWORD` changes. |

Expired logins are removed from the database every night at 03:00 and at start.

#### Why 90 and 365 days

NIST SP 800-63B (Revision 3, June 2017) asks a login to be repeated at least every 30 days whatever the use at AAL1 (section 4.1.3, a SHOULD), and at AAL2 at least every 12 hours and after 30 minutes without use (section 4.2.3, a SHALL). The defaults are longer than both, on purpose:

- Pinned has one user and runs on your own server, on a home network or a tailnet. A login is a browser you use every day for your own bookmarks, and logging in again every day or every month on each phone and laptop is the cost those limits would add.
- What a session can do is bounded: it cannot make an API token, remove a folder lock or sign out other browsers without the app password again, and it never sees a locked folder before that folder is unlocked with its own password.
- The idle limit, `SESSION_DAYS` (90), ends a browser you stopped using, such as an old phone. The absolute limit, `SESSION_MAX_DAYS` (365), ends every login once a year even when it is used every day, so a cookie copied once does not work for ever.
- Signed in lists every login and ends any of them, and changing `APP_PASSWORD` ends them all.

To follow the stricter guidance, set `SESSION_MAX_DAYS=30` for the AAL1 limit, or `SESSION_DAYS=1` and `SESSION_MAX_DAYS=1` to log in again every day, and set `TOTP_SECRET` for a second factor, which AAL2 requires. The idle limit counts in days, so the 30 minute limit of AAL2 is out of reach; put Pinned behind a proxy that signs you in with shorter sessions if you need it.

### Icon fetches

| What | Limit |
|---|---|
| Fetches at the same time | 4 |
| Waiting bookmarks | 4096; when the queue is full, a bookmark keeps its letter |
| Time for one bookmark, all requests together | 6 seconds |
| Name lookup to decide whether the bookmark's host is private | 2 seconds |
| TLS handshake | 5 seconds |
| A page or a web app manifest | 512 KB read |
| An icon file | 2 MB read |
| Icon candidates tried for one bookmark | 8 |
| Redirects for one request | 5 |
| Icon image | 4096 pixels a side and 16,000,000 pixels at most |
| Ports | 80, 443 and the bookmark's own port |

A fetch goes only to public addresses, except that a bookmark whose host is private may load its icon from that same host. Special ranges (documentation, multicast, reserved and the like) are refused always. A redirect from `https` to plain `http` is refused. A bookmark whose icon fails 3 times for a lasting reason is not tried again at start until the next version, or until it is saved, edited or refetched. `ICONS=off` stops every fetch; `ICON_HOSTS` keeps them to a list of hosts.

What is kept of a fetched icon: PNG, JPEG, GIF and ICO files are decoded and stored as a new PNG of what they show, so a second format hidden in the file, bytes after the image or metadata do not survive. WebP is not taken. An SVG icon is kept as it is only when everything in it is on an allow list of drawing elements and attributes: no script, no links, no animation, no other namespace (XHTML included) apart from the notes drawing programs write, `href` only to an `#id` in the file or to an embedded PNG, JPEG, GIF or WebP image, and style only with known CSS functions (colours, gradients, math, transforms, filters, media queries; never `image-set()`, `image()` or `@import`), each written with its name right before its bracket, and `url()` only to an `#id` in the file or to an embedded PNG, JPEG, GIF or WebP image. A style element is checked as one sheet joined from all its text, and a comment, processing instruction or element inside it is refused. Style is read the way a browser reads it: a comment marker inside a string or an unquoted `url()` is plain text, and an unclosed string, comment or `url()` is refused. Anything else is refused and the bookmark keeps its letter. At start, SVG icons stored by an older version are checked again; one that fails is deleted and its bookmarks show their letter. PNG and JPEG icons an older version kept as fetched are re-encoded to a new PNG once, on the first start of 0.1.11 or later; the old file stays in `icons/` for a way back with the database copy, and is never served, since only files a bookmark you can see names are served. Icons are shown only through `img` and served with a content policy that loads nothing and a sandbox. There is no antivirus scan: the image has no scanner to run (it is built from scratch with only the app in it), and re-encoding, the SVG allow list and that policy leave no file that runs or loads anything.

### Heavy work and how it is bounded

- **Import** reads up to 20 MB and up to 256 levels of folders. It writes in steps of about 100 milliseconds each, so saves and logins from other browsers get in between. If a folder it writes into is deleted or locked between two steps, it stops and says how many links came in. It needs a login; an API token cannot import.
- **Export** builds the whole tree in memory and writes it as one file. Its size follows your data; there is no cap. It needs a login; an API token cannot export. The nightly export runs once a day at 03:00, and at start when the file is older than a day.
- **Icon fetch** runs in the background with the limits above. Saving a bookmark never waits for it.
- **Password checks** with bcrypt (folder and share passwords; the app password once at start) are slow on purpose. The limits above keep a guesser to about one try a second per client.
- **Trash** keeps bookmarks 30 days; a daily job deletes older ones and the icon files they used that nothing else uses.

## Keys and algorithms

| What | Algorithm | Used for |
|---|---|---|
| `secret.key` | 32 bytes from the system's secure random source (Go `crypto/rand`), made on first start | The key of every HMAC below. |
| Session cookie | 32 random bytes; the database keeps HMAC-SHA256 of it, keyed with `secret.key` | The login. The cookie value itself is not stored. |
| API token | `tk_` and 32 random bytes; the database keeps HMAC-SHA256 of it, keyed with `secret.key` | Scripts and the extension. Shown once, never stored. |
| Share token | 24 random bytes, stored as is | The share link. |
| Signed cookies: device, folder unlock, share unlock | `v1.`, the value, and an HMAC-SHA256 keyed with `secret.key` | The device cookie signs its id and the app password's fingerprint. A folder unlock signs the folder, its password stamp and the expiry. A share unlock signs the token, the share's creation time, its password stamp and the expiry. The stamp is random, made when the password is set; locks and share passwords set before 0.1.11 sign their hash instead until the password is set again. A new password, a new share or a new key makes the old cookies worthless; a stronger hash of the same password does not. `v1.` marks the format; a later format can take another marker. |
| App password | bcrypt, cost 10, over the SHA-256 of the password, in the database | Only to notice at start that `APP_PASSWORD` changed. |
| App password at login | Both sides hashed with SHA-256, then compared in constant time | The login checks the password in the environment, held in memory. |
| App password fingerprint | HMAC-SHA256 of the password, keyed with `secret.key`, held in memory only | Part of what the device cookie signs. |
| Folder and share passwords | bcrypt, cost 10 | A hash made at a lower cost is replaced at the next right password; unlock cookies keep working. A password set before 0.1.11 has no stamp and keeps its hash (made at cost 10) until it is set again. |
| Second factor | TOTP (RFC 6238): HMAC-SHA1, 6 digits, 30 second steps, one step of clock drift either way | The login code, when `TOTP_SECRET` is set. HMAC-SHA1 is what authenticator apps use, and it is still sound as an HMAC. |
| Icon file names | 4 bytes of SHA-256 of the file | Naming only, not security. |
| Outbound TLS | Go's standard library defaults; certificates checked against the CA certificates in the image | Icon fetches. A site with a self-signed certificate gets no icon. Nothing else goes out. |

A second factor code works once: after a login with the code of one step, codes of that step and earlier ones are refused. That memory is not kept over a restart, so right after one the code just used works again for up to about 90 seconds.

### Rotating `secret.key`

Do it when the key may have left your hands, for example a backup of the data folder that ended up somewhere it should not be. Stop the container, delete `secret.key` (or move it away), and start. A new key is made. Then:

- every browser is logged out;
- every API token stops working. The tokens stay in the list; revoke them and create new ones;
- every device cookie ends, so browsers count as new for the wrong password limits until they log in again;
- every unlocked folder locks again, and every unlocked share link asks for its password again;
- share links keep working, and folder, share and app passwords stay as they are.

A `secret.key` shorter than 32 bytes stops the start with a message, so a damaged file is never replaced without a word.

If the database left your hands too, also change `APP_PASSWORD` and the folder and share passwords, and revoke the share links: their tokens are in the database as they are.

## What Pinned stores

Everything is in the data folder. Nothing is encrypted at rest; use disk encryption on the host if you need that. The data folder and its `icons/` and `export/` folders are 0700, the files the app writes are 0600, and the process runs with umask 077. At start the app tightens files and folders an older version made readable by everyone; where the volume does not allow it, it logs that once and carries on. The image runs as user 1000; the example compose file also makes the root file system read only and drops every capability.

| Data | Where | How sensitive | How it is protected |
|---|---|---|---|
| Bookmark titles and addresses | `bookmarks.db` | Private. An address can carry another site's token or key in its query. | Plain in the database, file 0600. In the nightly export and the export in the app. Shown to anyone with a share link to its folder. |
| Folder names | `bookmarks.db` | Private | The name of a locked folder still shows in the app. |
| Contents of locked folders | `bookmarks.db` | Private | Hidden in the app, from API tokens and from the export in the app until unlocked in that browser. A save, check, restore or import of an address that sits only in a locked folder answers as if it were not saved. Plain in the database and in the nightly export. |
| App password | the environment, or the file `APP_PASSWORD_FILE` names | Secret | Never written to the data folder or the log. The database keeps a bcrypt hash. `docker inspect` shows environment variables to anyone who may run Docker; a file keeps it out of there. |
| Folder and share passwords | `bookmarks.db` | Secret | bcrypt hashes only. |
| Session cookies and API tokens | `bookmarks.db` | Secret | HMAC-SHA256 hashes only. Each session also keeps a short browser name, such as `Firefox on macOS`, and when it logged in and was last used. Each token keeps the extension address it is bound to. |
| Share tokens | `bookmarks.db` | Secret, like a password | Stored as is. The token is the link, and the share sheet shows the link again whenever you open it. Revoke ends it at once. |
| `secret.key` | data folder | Secret | File 0600. Keep it with your backups and as private as the database. |
| Second factor secret | the environment, or the file `TOTP_SECRET_FILE` names | Secret | Never written to the data folder or the log. |
| Database copies before an upgrade | `bookmarks-schema<N>-<date>.db` | As the database | File 0600. The last three are kept. |
| Nightly export | `export/bookmarks.html` | As the database | File 0600. Holds every live link, locked folders included. Leaves out Trash, pins, locks, shares, sessions and tokens. |
| Site icons | `icons/` | Low. The file names hold bookmark ids. | Files 0600. |
| Logs | standard error of the process, not the data folder | Low. They hold client addresses, ids, token names, and the host of a bookmark whose icon fetch failed. | See Logs. |

Held in memory only, gone at a restart: the wrong password counts, the wrong code count and its wait, the step of the last second factor code used, the app password and its fingerprint.

How long things are kept: Trash 30 days; expired logins until the next nightly run; API tokens until revoked or `APP_PASSWORD` changes; share links until revoked or expired, or until their folder is deleted, locked or moved into a locked folder; database copies, the last three.

## Logs

Pinned writes its log to standard error. `docker compose logs pinned` shows it; nothing is written to the data folder.

Each line starts with the time in UTC (RFC 3339). Security events follow one pattern: `security event=<name> ip=<client address>` and then fields as `name=value`. A value with spaces, quotes or `=` in it is quoted, so a folder or token name cannot make a line that looks like another. For example:

```text
2026-10-31T09:12:44Z security event=login.fail ip=192.0.2.7
2026-10-31T09:12:51Z security event=login.ok ip=192.0.2.7 via=form known_browser=true
2026-10-31T09:20:03Z security event=token.create ip=192.0.2.7 token=4 name="Home Assistant"
```

The client address is read the same way as for the wrong password limits: from `X-Forwarded-For` only when the request comes from `TRUSTED_PROXIES`.

### Security events

| Event | When | Fields |
|---|---|---|
| `login.ok` | A login | `via` (`form` or `api`), `known_browser` |
| `login.fail`, `login.wait` | A wrong app password; the client now has to wait | `seconds` on a wait |
| `totp.fail`, `totp.wait` | The password was right, the code wrong or used already; a login came in while wrong codes hold every login | `seconds` on a wait |
| `logout` | A browser logged out | |
| `session.end` | Another browser was signed out from Signed in | `session` |
| `session.end_others` | Sign out all others | `ended` |
| `token.fail`, `token.wait` | A wrong API token | `seconds` on a wait |
| `token.refused` | A valid token called something tokens may not, or came with another origin than the extension it is bound to | `token`, `route`, and `reason=origin` for the second |
| `token.create`, `token.delete` | A token was created or revoked | `token`, and `name` on create |
| `reauth.fail`, `reauth.wait` | A wrong app password when it is asked again | `for` (`token.create`, `lock.remove`, `session.end` or `session.end_others`), `folder` |
| `lock.fail`, `lock.wait` | A wrong folder password | `folder` |
| `lock.unlock` | A folder was unlocked with its password | `folder` |
| `lock.set`, `lock.change`, `lock.remove` | A folder lock was set, changed or removed | `folder` |
| `share.fail`, `share.wait` | A wrong share password | `folder` |
| `share.unlock` | A share link was opened with its password | `folder` |
| `share.create`, `share.change`, `share.delete` | A share link was made, changed or revoked | `folder` and `password` (whether it has one) on create and change |
| `csrf.refused` | A request that changes something came without `X-Requested-With: fetch`, as a form or page on another site would send it. At most one line a minute per client | `method`, `route` |
| `icon.fail` | An icon fetch for a bookmark failed | `host` (never the path or query), `kind`: `certificate`, `blocked` (an address the fetch may not reach), `no_such_host`, `http`, `unreachable`, `no_icon`, `broke` or `other`; no `ip` |
| `password.changed` | At start, when `APP_PASSWORD` changed | `sessions=ended tokens=revoked`, no `ip` |

A `.wait` line is written once per client and kind while the wait lasts, so a client hammering during its wait cannot flood the log.

### Other lines

- At start: the version, the port and the data folder; that the login asks for a code when `TOTP_SECRET` is set; a database upgrade and the name of the copy taken before it; that a file in the data folder could not be made private.
- While running: the number of bookmarks the Trash purge deleted, and failures of the nightly export, the purge, database copies and icon files (by bookmark id or file name).
- `error:` lines for anything unexpected; the request then gets a plain "something went wrong".
- `shutting down` when the container stops.

There is no line per request, so the pages and links you open are not logged.

### Never logged

Passwords, second factor codes, API tokens, session tokens, share tokens, cookie values, hashes and `secret.key`.

### Keeping logs and sending them elsewhere

Docker keeps the log with its logging driver. The default, `json-file`, keeps everything until the container is removed and does not rotate. To cap it, add this to the service in the compose file:

```yaml
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```

To keep the log on another machine, use any other Docker logging driver, for example syslog:

```yaml
    logging:
      driver: syslog
      options:
        syslog-address: "udp://192.168.1.10:514"
        tag: pinned
```

Who can read the log is who can run `docker logs` on the host, or read the place the driver sends it to.
