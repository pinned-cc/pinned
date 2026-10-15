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

`secret.key` is the key for the hashes of sessions, API tokens and unlock cookies. Keep it with the database. Without it every session ends and every API token stops working.

## The database

SQLite in WAL mode, with foreign keys on. Times are Unix seconds. The schema is created and upgraded by numbered migrations when the app starts; the table `schema_version` holds the number of the last one that ran. Migrations only go forward.

### folders

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `parent_id` | INTEGER NULL | The parent folder. NULL for a top level folder. Deleting a folder deletes its subfolders. |
| `name` | TEXT NOT NULL | Imported names are cut at 200 characters. |
| `position` | INTEGER NOT NULL | Order among its siblings. |
| `created_at` | INTEGER NOT NULL | |
| `lock_hash` | TEXT NULL | bcrypt hash of the folder's own password. NULL when the folder has no lock. |

Folders nest at most 32 deep.

### bookmarks

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `folder_id` | INTEGER NULL | The folder. NULL means Inbox. |
| `title` | TEXT NOT NULL | |
| `url` | TEXT NOT NULL | The address as saved. |
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

A bookmark with `deleted_at` NULL is live. Live bookmarks are unique by `url_key` (a unique index on `url_key` where `deleted_at IS NULL`), so the same address can sit in Trash and be saved again. Bookmarks in Trash for 30 days are deleted for good by a daily job.

### settings

| Column | Type | Meaning |
|---|---|---|
| `key` | TEXT PRIMARY KEY | |
| `value` | TEXT | JSON. |

Keys in use: `last_folder` (a folder id), `recent_folders` (an array of up to three folder ids, newest first), and `password_hmac`, an HMAC of `APP_PASSWORD` keyed with `secret.key`. When the password in the environment no longer matches it at start, every session is deleted.

### sessions

| Column | Type | Meaning |
|---|---|---|
| `token_hash` | TEXT PRIMARY KEY | HMAC-SHA256 of the session cookie value, keyed with `secret.key`. The cookie value itself is not stored. |
| `expires_at` | INTEGER NOT NULL | |

### tokens

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `name` | TEXT NOT NULL | The name you gave it, up to 80 characters. |
| `hash` | TEXT NOT NULL UNIQUE | HMAC-SHA256 of the token, keyed with `secret.key`. The token itself is not stored. |
| `created_at` | INTEGER NOT NULL | |
| `last_used_at` | INTEGER NULL | Updated at most once a minute. |

### shares

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `folder_id` | INTEGER NOT NULL UNIQUE | The shared folder. One share per folder. Deleted with the folder. |
| `token` | TEXT NOT NULL UNIQUE | The random part of the link, `/s/<token>`. Stored as is, because it is the link. |
| `password_hash` | TEXT NULL | bcrypt hash of the share password. NULL when there is none. |
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

When a bookmark is saved or its address changes, the server looks for the site's icon and stores it in `icons/` as `<bookmark id>-<8 hex characters of the file's SHA-256>.<ext>`, where `<ext>` is `png`, `jpg` or `svg`. ICO files are converted to PNG. The `icon` column holds the file name. Bookmarks on the same host and port can share one file. Icon files that no bookmark uses any more are removed.
