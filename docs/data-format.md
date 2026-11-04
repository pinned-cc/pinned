# Data format

Everything the app keeps lives in one folder, `DATA_DIR` (`/data` in the container):

```text
bookmarks.db          the SQLite database
bookmarks.db-wal      SQLite's write ahead log, while the app runs
bookmarks.db-shm      SQLite's shared memory file, while the app runs
secret.key            32 random bytes, made on first start
icons/                the fetched site icons
export/bookmarks.html the nightly export
```

Only the user the app runs as can read them: folders are 0700 and files 0600 (the process runs with umask 077). At start the app makes folders and files written by an older version, which were readable by everyone, private too; where the volume does not allow it, it logs that once and carries on.

`secret.key` is the key for the hashes of sessions, API tokens, unlock cookies and device cookies, and for the hashes of folder lock and share passwords (see `lock_hash`). Keep it with the database, and back the two up together. Without it every session ends, every API token stops working, a locked folder no longer opens with its password (remove the lock with the app password, then lock it again) and a share password no longer matches (set it again).

Device and unlock cookies carry a version marker, `v1.`, before the signed value; values without it, from before 0.1.11, are read the same way. A lock or share password hash from before 0.1.11 (plain bcrypt of the password, without `k1:`) or made at a lower bcrypt cost than the current one is replaced by a hash in the current form at the next right password, only when the stored hash is still the one that was checked, so a password changed meanwhile is never overwritten. The stamp stays, so other browsers stay unlocked; a lock or share without a stamp gets one then (see `lock_stamp`). The app password hash is replaced at start when its cost is lower than the current one.

## The database

SQLite in WAL mode, with foreign keys on. Times are Unix seconds. The schema is created and upgraded by numbered migrations when the app starts; the table `schema_version` holds the number of the last one that ran. Migrations only go forward. Before migrating an existing database, the app writes a copy of it with `VACUUM INTO` next to it as `bookmarks-schema<N>-<YYYY-MM-DD-HHMMSS>.db`, where N is the schema number before the upgrade, and keeps the newest three by modification time, always including the one for this start. An older copy of the same schema with the same bytes is removed. The copy is created with mode 0600. If the copy fails, it does not migrate.

### folders

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `parent_id` | INTEGER NULL | The parent folder. NULL for a top level folder. Deleting a folder deletes its subfolders. |
| `name` | TEXT NOT NULL | Imported names are cut at 200 characters. |
| `position` | INTEGER NOT NULL | Order among its siblings. |
| `created_at` | INTEGER NOT NULL | |
| `lock_hash` | TEXT NULL | The hash of the folder's own password: `k1:` followed by a bcrypt hash of the HMAC-SHA256 of `password\x00` and the password under `secret.key`, base64 encoded (44 bytes whatever the password's length, so bcrypt's 72 byte limit does not apply). Locks set before 0.1.11 hold a plain bcrypt hash of the password until the next right password replaces it. NULL when the folder has no lock. |
| `lock_stamp` | TEXT NULL | 16 random bytes in hex, made whenever the lock password is set or changed and kept when only its hash is replaced. Unlock cookies sign it, so a rehash does not end them. NULL when there is no lock, and for locks set before schema 11 until their hash is replaced at the next right password or the password is set again; until then their cookies sign `lock_hash`, so when the stamp is added, other browsers unlock that folder once more. |
| `hide_recent` | INTEGER NOT NULL | 1 when the folder is left out of Recent; its subfolders are too. 0 by default. |

Folders nest at most 32 deep.

### bookmarks

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `folder_id` | INTEGER NULL | The folder. NULL means Inbox. |
| `title` | TEXT NOT NULL | |
| `url` | TEXT NOT NULL | The address as saved. New and changed addresses are at most 8192 bytes. |
| `url_key` | TEXT NOT NULL | The identity of the address, see below. |
| `position` | INTEGER NOT NULL | Order in its folder. |
| `pinned` | INTEGER NOT NULL | 1 when pinned, 0 when not. |
| `pinned_position` | INTEGER NOT NULL | Order in the pinned row. |
| `icon` | TEXT NULL | File name in `icons/`. NULL when no icon was found. |
| `tile` | TEXT NULL | Background colour for the icon as `#rrggbb`, taken from the icon's edge. NULL for SVG icons. |
| `created_at` | INTEGER NOT NULL | |
| `updated_at` | INTEGER NOT NULL | |
| `opened_at` | INTEGER NULL | Last time it was opened from the app. |
| `deleted_at` | INTEGER NULL | Set when the bookmark is in Trash. NULL otherwise. |

A bookmark with `deleted_at` NULL is live. The same address can sit in Trash and be saved again. Live bookmarks are unique by `url_key` among those one browser or token can see; the app checks it when it saves, edits, restores or imports. A bookmark in a locked folder that is not unlocked does not count, so the same address can be live inside a locked folder and outside it. Up to schema 11 a unique index on `url_key` where `deleted_at IS NULL` enforced one live bookmark per address everywhere; schema 12 drops it, and the index on `url_key` serves the lookups. An index on `folder_id, position` over the live bookmarks gives the end of a folder at once, for saves, moves and imports. Bookmarks in Trash for 30 days are deleted for good by a daily job.

### settings

| Column | Type | Meaning |
|---|---|---|
| `key` | TEXT PRIMARY KEY | |
| `value` | TEXT | JSON for `last_folder`, `recent_folders` and `icons_reencoded`; plain text for `password_hash` and `icon_failures_version`. |

Keys in use: `last_folder` (a folder id), `recent_folders` (an array of up to three folder ids, newest first), and `password_hash`, a bcrypt hash of `APP_PASSWORD`. When the password in the environment no longer matches it at start, every session and every API token is deleted. A hash made with a lower bcrypt cost than the current one is replaced at start. Versions before 0.1.11 kept `password_hmac`, an HMAC of the password keyed with `secret.key`, instead; the first start of a newer version checks it once and replaces it with `password_hash`. `icon_failures_version` is the app version that recorded the rows of `icon_failures`; a start with another version empties that table. `icons_reencoded` is `true` once the stored PNG and JPEG icons of older versions have been re-encoded.

### sessions

| Column | Type | Meaning |
|---|---|---|
| `token_hash` | TEXT PRIMARY KEY | HMAC-SHA256 of the session cookie value, keyed with `secret.key`. The cookie value itself is not stored. |
| `expires_at` | INTEGER NOT NULL | Moves forward by `SESSION_DAYS` when the session is used, never past `created_at` plus `SESSION_MAX_DAYS`. |
| `created_at` | INTEGER NOT NULL | The login. Sessions from before schema 9 carry the time of the upgrade. |
| `used_at` | INTEGER NOT NULL | Last use, updated at most once an hour. |
| `agent` | TEXT NOT NULL | A short browser name taken from the User-Agent at login, such as `Firefox on macOS`, for the list of signed in browsers. |

The list of signed in browsers names a session by its SQLite `rowid`.

### icon_failures

| Column | Type | Meaning |
|---|---|---|
| `bookmark_id` | INTEGER PRIMARY KEY | The bookmark. Deleted with it. |
| `url_key` | TEXT NOT NULL | The address whose icon failed. A failure for another address starts the count again. |
| `count` | INTEGER NOT NULL | Failed fetches in a row. At 3 the fetch at start skips the bookmark. A stored icon deletes the row. |

### tokens

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `name` | TEXT NOT NULL | The name you gave it, up to 80 characters. |
| `hash` | TEXT NOT NULL UNIQUE | HMAC-SHA256 of the token, keyed with `secret.key`. The token itself is not stored. |
| `created_at` | INTEGER NOT NULL | |
| `last_used_at` | INTEGER NULL | Updated at most once a minute. |
| `origin` | TEXT NULL | The browser extension origin, such as `chrome-extension://<id>`, that first used the token. After that, requests with the token that carry any other `Origin`, an extension's or a web page's, are refused; requests without an `Origin` are not. NULL until an extension uses it. |

### shares

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `folder_id` | INTEGER NOT NULL UNIQUE | The shared folder. One share per folder. Deleted with the folder. |
| `token` | TEXT NOT NULL UNIQUE | The random part of the link, `/s/#<token>` (links made before 0.1.11: `/s/<token>`). Stored as is, because it is the link. |
| `password_hash` | TEXT NULL | The hash of the share password, in the same form as `lock_hash` in folders (`k1:` and bcrypt over an HMAC under `secret.key`; a plain bcrypt hash for passwords set before 0.1.11 until the next right password). NULL when there is none. |
| `password_stamp` | TEXT NULL | Like `lock_stamp` in folders, for the share password. |
| `expires_at` | INTEGER NULL | NULL when it never expires. |
| `created_at` | INTEGER NOT NULL | |
| `opens` | INTEGER NOT NULL | How often the link was opened, once per browser per hour. |
| `last_opened_at` | INTEGER NULL | |

## The url_key rule

Host and port are the identity of a link. `url_key` is the address with:

- the scheme and the host lowercased,
- `:80` removed for `http` and `:443` removed for `https`,
- everything from `#` on dropped,
- an empty path written as `/`, so `http://host` and `http://host/` are the same.

Everything else, the user part, the path and the query, is kept byte for byte. Only `http` and `https` addresses with a host are accepted. Any host works, including IP addresses and single word names like `homelab`.

So `http://10.0.0.5:8080/` and `http://10.0.0.5:9000/` are two bookmarks, and `HTTP://Example.com:80` and `http://example.com/` are one.

The code is in `internal/urlkey`.

## The export format

Export in the app, and the nightly file `export/bookmarks.html`, use the Netscape bookmark file format, the HTML file every browser can import and export:

```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. It will be read and overwritten. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://example.com/" ADD_DATE="1791926158">Example</A>
    <DT><H3 ADD_DATE="1791900000">Home lab</H3>
    <DL><p>
        <DT><A HREF="http://10.0.0.5:8080/" ADD_DATE="1791900000">Dashboard</A>
    </DL><p>
</DL><p>
```

- Inbox bookmarks are at the root, folders follow as `<H3>` with their own `<DL>`.
- `ADD_DATE` is the time the bookmark or folder was created.
- Trash, pins, the order of the pinned row, icons, locks, shares, sessions and tokens are not in the export.

The nightly file is written at 03:00 in the time zone set by `TZ`, and on start when the file is older than a day. It is written to a temporary file first and then renamed, so it is never half written.

## Icons

When a bookmark is saved or its address changes, the server looks for the site's icon and stores it in `icons/` as `<bookmark id>-<8 hex characters of the file's SHA-256>.<ext>`, where `<ext>` is `png` or `svg`. PNG, JPEG, GIF and ICO files are stored as a new PNG of what they show; an SVG that passes the check in `docs/security.md` is stored as a new SVG written from what the check kept, never as the site sent it. Versions before 0.1.11 also stored `jpg` files and kept PNG and JPEG files as fetched; the first start of 0.1.11 or later re-encodes those once to a new PNG and points their bookmarks to it. The old file stays in `icons/`: no bookmark names it, so it is never served, and the database copy saved before the upgrade still names it, so going back with that copy shows the icon. The same pass deletes any stored icon that does not decode, and any SVG that fails the check, and takes it off its bookmarks. The `icon` column holds the file name. Bookmarks on the same host and port can share one file. When a bookmark is deleted for good or gets a new icon, the file it used is removed once no bookmark uses it; the files kept from the re-encode are not removed by Pinned.
