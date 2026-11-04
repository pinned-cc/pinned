# Pinned spec, 0.1.12

Written 04.11.2026, before any code of 0.1.12. The order of work is this spec, then an independent review of it, then the build.

Sections 1 to 22 are the spec of 0.1.11 as released. That spec was written on 04.11 and checked by two independent review passes against the code at the tag, and every correction of both passes is in it. It is carried over here. Against the branch release-0.1.12 it was checked again in two ways: the product code is the code of the tag (see the baseline below), and every item that 0.1.12 touches was read again in the code at 74e3037; where the branch differs, the item says so. Section 23 is every change 0.1.12 makes, and nothing else goes into 0.1.12. An item of sections 1 to 22 that 0.1.12 changes carries a pointer to its item in section 23 and keeps its 0.1.11 text, so both the old and the new behaviour are on record.

The baseline. The tag v0.1.11 points at commit 44007be (2026-11-03). The first v0.1.11 tag was at 6ab1d8d and moved to 44007be on 2026-11-03 because the first tag built no image (decision log, release log); the two commits differ only in tools/setup.test.sh (`git diff 6ab1d8d v0.1.11`). The branch release-0.1.12 is at 74e3037. Outside design/ and internal/store/testdata/, `git diff --stat v0.1.11 74e3037` touches only internal/store/upgrade_test.go (new), umbrel/docker-compose.yml, umbrel/umbrel-app.yml and casaos/docker-compose.yml. So the product code on the branch is the code of the tag, and every file:line citation in sections 1 to 22 holds on the branch, except those of the three package files, which are to the tag version (`git show v0.1.11:<path>`), and except the new design/ folder (S5.39, S23.18).

Sources read: README.md, CHANGELOG.md (0.1.0 to 0.1.11), SECURITY.md, docs/security.md, docs/data-format.md, docs/testing.md, design/wireframes/flows/flows.md and flows_data.py, design/wireframes/flow-test.md (31.10.2026), design/tokens and design/scripts, the code under cmd/, internal/, web/, extras/ and tools/, Dockerfile, docker-compose.yml, .github/, umbrel/ and casaos/. Documents outside the repository, cited by name: the flow test of 04.11.2026 with its ten width scan (cited as "FT 04.11" and "widths 04.11"), the findings and checklist of release audit 4 (cited as "audit R4") and its re-check of three points on 04.11, the fuzz run of 04.11, and the maintainer's decision log, release log and task list. Earlier tags are read with `git show vX.Y.Z:<path>`, never from memory.

Item ids are S<section>.<item>; in section 23 an item has a third number, S23.<change>.<point>. Citations without a folder name the file the section names first. Lists stand where a table would: each entry gives its fields as "Field: value."

## 1. Purpose and who it is for

S1.1 Pinned is a self hosted bookmark manager and start page for the services people run at home: folders instead of tags, one user, one SQLite file (README.md:3).
S1.2 It holds folders that nest, search, a pinned row, an Inbox for quick saves, a Trash that keeps things 30 days, import and export in the browser bookmarks format, a Save button for every browser and search from the address bar (README.md:7).
S1.3 Host plus port is the identity of a link: two links on one host with different ports are two bookmarks, and an IP address stays an IP address (README.md:11).
S1.4 It is for one person who runs Docker on a NAS, a Raspberry Pi, an old laptop or a small rented server (README.md:17).
S1.5 It is one password, one binary, one data folder (README.md:7); the binary is one static Go program with the web files embedded (assets.go:6-9, README.md:324).
S1.6 Licence: AGPL-3.0-only (README.md:336, cmd/pinned/main.go:77). The common and breached password lists come from SecLists under MIT (README.md:338).
S1.7 Supported versions: only the latest release gets security fixes (SECURITY.md:58-60).

## 2. Out of scope

S2.1 No tags, no page archiving, no accounts (README.md:3). There is one user and no user table (internal/store/store.go:106-202 has none).
S2.2 No telemetry, no update checks, no fonts or scripts from other servers (README.md:307).
S2.3 No HTTPS in the server: it speaks plain HTTP on one port; HTTPS is the job of a proxy (README.md:194, docs/security.md:21).
S2.4 It must sit at the root of a host name, not under a path (README.md:194).
S2.5 No encryption at rest; a folder lock hides, it does not encrypt (README.md:283, docs/security.md:153).
S2.6 No password generator: users bring their own tools (docs/security.md:40, release log).
S2.7 No service worker and no offline mode (no serviceWorker in web/; front end extraction).
S2.8 No antivirus scan of fetched icons; rebuilding stands in for it (docs/security.md:107, audit R4 F-111).
S2.9 No iOS Shortcut since 0.1.1 (CHANGELOG.md:206).
S2.10 No cap on the number of bookmarks, folders, tokens or signed in browsers (docs/security.md:46).
S2.11 Out of scope for security reports: problems that need the app password or a valid token, the user's proxy, NAS or network, and limits the README documents (SECURITY.md:28-32).

## 3. Install ways and settings

### 3a. Compose by hand

S3.1 The image is `ghcr.io/pinned-cc/pinned` for amd64 and arm64, from 0.1.0 on (README.md:31).
S3.2 The data folder must be writable by user 1000 (README.md:33-38); the image runs as 1000:1000 (Dockerfile:27).
S3.3 The repository compose file: image `ghcr.io/pinned-cc/pinned:latest`, container_name `pinned`, `APP_PASSWORD: ${APP_PASSWORD:?set APP_PASSWORD}`, `TZ: UTC`, `./data:/data`, port `9095:8080`, `restart: unless-stopped`, `read_only: true`, tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges:true` (docker-compose.yml:1-21; README.md:43-63). It publishes on every address.
S3.4 Start: `APP_PASSWORD='...' docker compose up -d`, or the password in `.env` (README.md:66-72).
S3.5 Portainer on Umbrel: paste the compose, replace `./data` with a full path user 1000 can write, add APP_PASSWORD, open port 9095 (README.md:78-82).

### 3b. setup.sh (one command install)

S3.6 One command: extras/vps/setup.sh of the tag v0.1.11, fetched from raw.githubusercontent.com with `curl -fsSL` and piped into `sh` (README.md:24). 0.1.12 names its own tag (S23.20).
S3.7 Settings and defaults: `PINNED_DIR` `$HOME/pinned`, `PINNED_PORT` 9095, `PINNED_IMAGE` `ghcr.io/pinned-cc/pinned:0.1.11`, `PINNED_BIND` `127.0.0.1`, `APP_PASSWORD` asked on the terminal when unset (extras/vps/setup.sh:16-22, 64). 0.1.12 defaults to its own image (S23.20).
S3.8 Bind: `::` or `[::]` writes two port lines, `0.0.0.0:PORT:8080` and `[::]:PORT:8080`; `127.*`, `::1` or `[::1]` count as loopback (setup.sh:23-34).
S3.9 Docker: when missing, installs it with docker/docker-install at commit `ada7a567e59b3935bd601bb21e422da50e80e376`, checked against SHA-256 `2b102d809152ea157a59f171319f489d971273b2d26dd7e9a6d1d737ce89289d`, download with connect timeout 10 s, max time 120 s, 3 retries (setup.sh:35-56).
S3.10 It uses `sudo docker` when `docker info` fails for a non root user (setup.sh:59-61), and needs the compose plugin (setup.sh:62).
S3.11 Password: read with echo off from stdin or `/dev/tty`; at least 8 characters (setup.sh:64-82). Stored in `$DIR/app_password` with umask 077, owned 1000:1000; any old `.env` is removed (setup.sh:111-117).
S3.12 Generated compose: no container_name, `APP_PASSWORD_FILE: /run/secrets/app_password`, `TZ: ${TZ:-UTC}`, the password file mounted read only, read only root, tmpfs, all capabilities dropped, no new privileges (setup.sh:89-109).
S3.13 A second install in another folder with the same folder name is refused (setup.sh:121-123; CHANGELOG.md:21).
S3.14 It runs `compose pull` and `up -d --force-recreate`, then waits up to 30 tries, 2 s apart, for `/health`; on failure it prints the last 20 log lines and stops (setup.sh:124-140).
S3.15 For a loopback bind it ends with "Next: put HTTPS in front ..." and the BASE_URL hint; for other binds it warns that the password crosses the network unencrypted (setup.sh:150-173). It asks ifconfig.me only when published on every address and the server cannot tell its own address (setup.sh:152-157; README.md:27).
S3.16 Tested for 0.1.11 on a fresh Ubuntu 26.04 server (README.md:27; release log).

### 3c. Umbrel and CasaOS packages (at the tag)

S3.17 Umbrel compose: app_proxy to `pinned_web_1:8080` with `PROXY_AUTH_WHITELIST: "/api/*,/s/*,/extras/*,/health,/static/*,/favicon.svg"`, which lets these paths past the Umbrel login (umbrel/docker-compose.yml:2-10 at v0.1.11; README.md:215).
S3.18 Umbrel web service: image `ghcr.io/pinned-cc/pinned:0.1.10@sha256:cf19c3cc...` at the tag, user 1000:1000, read only, `TRUSTED_PROXIES: "127.0.0.0/8,::1,${GATEWAY_IP}/32"`, no BASE_URL (umbrel/docker-compose.yml:13-28 at v0.1.11). Commit 04c8de4 moved the image to `0.1.11@sha256:70e25477...`, as it stands on the branch.
S3.19 Umbrel app: `id: pinned`, `version: "0.1.10"` at the tag, `port: 9097`, submission PR 6243 (umbrel/umbrel-app.yml:2, 7, 38, 47 at v0.1.11); 04c8de4 set version 0.1.11 and added its release note; 74e3037 then set `releaseNotes: ""`, as the store lint asks for a new app (S23.18).
S3.20 CasaOS compose: image 0.1.10 by digest at the tag, container_name `pinned`, user 1000:1000, port 9095 to 8080, `APP_PASSWORD: ""`, `TZ: $TZ`, data at `/DATA/AppData/$AppID/data`, read only, all capabilities dropped; x-casaos id `cc.pinned.pinned`, version 0.1.10, `update_at` 2026-10-28 (casaos/docker-compose.yml:4-80 at v0.1.11). 04c8de4 moved it to 0.1.11, `update_at` 2026-11-03.
S3.21 Store order decided: Umbrel first (release log). Umbrel PR 6243 and Zima PR 1116 were updated to 0.1.11 by digest after the release (release log).

### 3d. Image and build

S3.22 Builder `golang:1.27.3-alpine` pinned by digest, cross compiled, `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w -X main.version=$VERSION"` (Dockerfile:6-18).
S3.23 Final image `FROM scratch` with only the CA bundle, zoneinfo, the binary and `/data` owned 1000:1000; `ENV DATA_DIR=/data PORT=8080 TZ=UTC`; `USER 1000:1000`; `EXPOSE 8080`; `VOLUME /data` (Dockerfile:20-29).
S3.24 Health check every 30 s, timeout 5 s, start period 10 s, 3 retries: `/pinned -healthcheck`, which gets `http://127.0.0.1:$PORT/health` with a 5 s timeout and passes only on 200 (Dockerfile:31; cmd/pinned/main.go:42, 99-112).
S3.25 CI: on push to main and on `v*` tags, gofmt, go vet, staticcheck, govulncheck, `go test -race`, the extension tests, the setup.sh test and a build; then the image for linux/amd64 and linux/arm64 with SBOM and provenance (.github/workflows/build.yml:3-80). 0.1.12: provenance in mode=min (S23.3).
S3.26 Image tags: `X.Y.Z` and `X.Y` and `latest` on release tags, `main` on the main branch, `sha-<commit>` always (CHANGELOG.md:255; build.yml tags block). VERSION is the tag name with the "v" on tags, else the short commit (build.yml:62-66).
S3.27 Flags: `-version` prints the version, `-healthcheck` checks the server, `-licenses` prints the third party licences (cmd/pinned/main.go:41-58, 72-81).

### 3e. Environment settings

- `APP_PASSWORD`. Default: none, required. Rule: at least 8 characters; not common on a new install or a change. Source: cmd/pinned/main.go:218-228; README.md:90.
- `APP_PASSWORD_FILE`. Default: empty. Rule: file holding the password; one trailing newline dropped; not both. Source: main.go:135-152; README.md:91.
- `TZ`. Default: `UTC`. Rule: time zone of the 03:00 jobs. Source: Dockerfile:26; README.md:92.
- `BASE_URL`. Default: taken from each request. Rule: used in the Save code, OpenSearch, share links; an `https://` value marks requests for its host as HTTPS. Source: internal/server/server.go:140-142, 440, 566-575; README.md:93.
- `TRUSTED_PROXIES`. Default: empty. Rule: comma separated addresses or CIDRs. Source: internal/server/guard.go:20-41; README.md:94.
- `HSTS`. Default: off. Rule: `true` is max-age 31536000; a positive number sets max-age; `false`, `0` or empty is off. Source: server.go:33-37, 64-79; README.md:95.
- `SESSION_DAYS`. Default: 90. Rule: whole number above 0. Source: main.go:231-234; server.go:82.
- `SESSION_MAX_DAYS`. Default: 365. Rule: whole number above 0. Source: main.go:235-238; server.go:86.
- `TOTP_SECRET`. Default: empty, off. Rule: base32, at least 16 bytes. Source: main.go:251-259; internal/auth/totp.go:34-50.
- `TOTP_SECRET_FILE`. Default: empty. Rule: file form of TOTP_SECRET. Source: main.go:251.
- `ICONS`. Default: `on`. Rule: `on` or `off`, case and spaces ignored. Source: main.go:114-123.
- `ICON_HOSTS`. Default: empty, any public host. Rule: comma separated host names, each with subdomains; `/ : @ space *` refused. Source: internal/favicon/guard.go:234-260.
- `DATA_DIR`. Default: `/data`. Source: main.go:229.
- `PORT`. Default: `8080`. Rule: the server listens on `":"+PORT`, every address. Source: main.go:230, 383.

S3.28 A wrong value stops the start with a message that says what to fix (main.go:215-261).
S3.29 No other environment variable is read by the Go code; the table is complete (a grep of Getenv at the tag; review section 3).
S3.30 `APP_PASSWORD_FILE` and `TOTP_SECRET_FILE` drop one trailing newline and a `\r` before it; an empty file stops the start (main.go:147-150).
S3.31 An empty value counts as unset for every variable read through `env` (main.go:125-130); an empty `ICONS` means on (main.go:117).
S3.32 The BASE_URL host also feeds the easy password check of APP_PASSWORD (main.go:228); the server fills `{{BASE_URL}}` into the pages, so the Save code carries it (internal/server/pages.go:40).
S3.33 HSTS ignores case; any value other than empty, false, 0, true or a positive whole number stops the start (server.go:64-79).
S3.34 Nothing compares SESSION_MAX_DAYS with SESSION_DAYS; a smaller SESSION_MAX_DAYS is accepted (main.go:231-238); the first lifetime of a session is the smaller of the two (server.go:348).
S3.35 TOTP_SECRET ignores case, spaces and `=` padding (internal/auth/totp.go:38-41).
S3.36 `-healthcheck` reads PORT too (main.go:53).
S3.37 The 8 characters of APP_PASSWORD are counted as Unicode characters (main.go:224); setup.sh counts with `${#APP_PASSWORD}`, which follows the shell's locale (setup.sh:82).

### 3f. Start order and supply chain

S3.38 Start order: settings, umask, data folders and write check, file modes, secret.key, open and migrate, password check, icon pool (with its start passes), icon queue, background jobs, listen (cmd/pinned/main.go:288-386). The first failing step is the error the user sees.
S3.39 A `.write-check-*` file is made and removed in the data folder at every start (main.go:273-278).
S3.40 The image entry point is `/pinned`; the builder installs `zip` and packs the extension before the Go build (Dockerfile:7, 16, 32).
S3.41 CI runs on pushes to main and on `v*` tags only, not on pull requests; permissions are read only except `packages: write` for the image job; every action is pinned by commit SHA; the build uses the Actions cache (.github/workflows/build.yml:3-10, 38-45, 75-76).
S3.42 Dependabot proposes updates for the Docker builder, the Go modules and the Actions weekly, with a 7 day cooldown (.github/dependabot.yml:6-24).
S3.43 Toolchain Go 1.27.3; direct modules github.com/sergeymakinen/go-ico v1.0.0, golang.org/x/crypto v0.58.0, golang.org/x/net v0.62.0, modernc.org/sqlite v1.60.1 (go.mod:3-10).
S3.44 setup.sh needs curl, and sha256sum when it installs Docker; downloads use `--proto '=https'` with a 2 s retry delay; it writes `compose.yml`; it ends with summary lines for address, files, update and stop (setup.sh:43-49, 89, 146-164).
S3.45 Umbrel at the tag: `deterministicPassword: true`, so Umbrel makes the password; `restart: on-failure`; `TZ: UTC` fixed; `category: files` (umbrel/umbrel-app.yml:5, 44; umbrel/docker-compose.yml:15, 26, all at v0.1.11).
S3.46 CasaOS at the tag sets no TRUSTED_PROXIES and no BASE_URL, uses `restart: unless-stopped`, and has a before install tip on the password rules (casaos/docker-compose.yml:7, 65-67 at v0.1.11).
S3.47 The generated compose of setup.sh also has `restart: unless-stopped` (setup.sh:93); the password file is written without a trailing newline (setup.sh:115); an IPv6 PINNED_BIND is put in brackets (setup.sh:23-27, 129-134).
S3.48 In CI, staticcheck and govulncheck run with `go run`, pinned by version, not by commit SHA; the test job packs the extension first (.github/workflows/build.yml:20, 24, 27).
S3.49 A test caps every function at 150 lines (cmd/pinned/funclen_test.go:15).
S3.50 Builds outside unix set no umask (cmd/pinned/umask_other.go:1-5).
S3.51 Shutdown order: the HTTP server gets up to 10 s, then icon fetches in flight are cancelled and waited for, then the background jobs stop, then the store closes (cmd/pinned/main.go:308, 357-367, 392-399).

## 4. Data model and schema

### 4a. Files in the data folder

S4.1 `bookmarks.db` with `-wal` and `-shm` while running, `secret.key`, `icons/`, `export/bookmarks.html`, and upgrade copies `bookmarks-schema<N>-<YYYY-MM-DD-HHMMSS>.db` (docs/data-format.md:3-12; README.md:239-245; internal/store/backup.go:30-32).
S4.2 Folders are 0700 and files 0600; the process runs with umask 077 (cmd/pinned/modes.go:13-16; cmd/pinned/umask_unix.go:10).
S4.3 At start, folders and the app's own files made readable by an older version are made private; a failure is logged once and skipped (cmd/pinned/modes.go:18-54).
S4.4 The code does not check who owns the folder. A permission error while it makes the data folder, `icons/` or `export/`, or writes the test file `.write-check-*`, stops the start with a message that names the uid the process runs as (1000 in the image) and `sudo chown -R <uid>:<uid> ./data` (cmd/pinned/main.go:263-286).
S4.5 `secret.key` is 32 random bytes made on first start, file 0600; a shorter file stops the start (internal/auth/auth.go:24, 97-117).

### 4b. Database

S4.6 SQLite through modernc.org/sqlite, WAL, foreign keys on, busy timeout 5000 ms, synchronous NORMAL, immediate transactions, at most 4 connections (internal/store/store.go:15, 74-87).
S4.7 Most writes hold one mutex, so a long import lets other writes in between its batches (store.go:58-65, 302-324; internal/store/transfer.go:135-174). Not all: DropIcon, RenameIcon and MarkIconsReencoded write directly (internal/store/icons.go:110, 116, 130), and the migrations run without it, before any other writer starts (store.go:252-291).
S4.8 The table `schema_version` holds the number of the last migration run; migrations only go forward and a shipped entry is never edited (store.go:104-106, 251-293).

### 4c. Migrations

- 1. What it does: tables folders, bookmarks, settings, sessions (token_hash, expires_at); index folders_parent; unique index on live url_key; index on bookmark folder. store.go: 107-134. First version: 0.1.0.
- 2. What it does: table shares. store.go: 136-145. First version: 0.1.0.
- 3. What it does: folders.lock_hash. store.go: 147. First version: 0.1.0.
- 4. What it does: table tokens. store.go: 149-155. First version: 0.1.0.
- 5. What it does: indexes on url_key, icon, deleted_at, pinned_position, sessions.expires_at. store.go: 160-164. First version: 0.1.0.
- 6. What it does: folders.hide_recent. store.go: 167. First version: 0.1.0.
- 7. What it does: table icon_failures. store.go: 171-175. First version: 0.1.11.
- 8. What it does: index bookmarks_folder_position on live bookmarks. store.go: 180. First version: 0.1.11.
- 9. What it does: sessions.created_at, used_at, agent; existing rows get the upgrade time. store.go: 184-187. First version: 0.1.11.
- 10. What it does: tokens.origin. store.go: 190. First version: 0.1.11.
- 11. What it does: folders.lock_stamp, shares.password_stamp. store.go: 195-196. First version: 0.1.11.
- 12. What it does: drop the unique index bookmarks_live_key. store.go: 201. First version: 0.1.11.

S4.9 What each released version installs: 0.1.0 to 0.1.10 hold 6 migrations, identical in every one of them, so they install schema 6 (`git show vX:internal/store/store.go`, migrations list, for each tag). 0.1.11 holds 12 and installs schema 12 (store.go:106-202).
S4.10 The newer schema check (0.1.12 corrects the README on it, S23.16): 0.1.0 has none; its migrate loop runs `for i := version; i < len(migrations)` and does nothing when the stored version is higher, so it opens a database a newer version upgraded (`git show v0.1.0:internal/store/store.go` lines 133-165). 0.1.1 to 0.1.10 refuse it with "database was written by a newer Pinned (schema N); this version knows 6. Update the image or restore a backup." (`git show v0.1.1:internal/store/store.go` line 161; CHANGELOG.md:196).
S4.11 0.1.11 refuses a newer schema and names the newest upgrade copy of its own schema to restore, with what that copy brings back (store.go:204-236, 264-266).

### 4d. Tables at schema 12

S4.12 folders: id, parent_id (cascade delete), name, position, created_at, lock_hash, hide_recent, lock_stamp (store.go:107-114, 147, 167, 195). Folders nest at most 32 deep (store.go:30-31).
S4.13 bookmarks: id, folder_id (set NULL on folder delete), title, url, url_key, position, pinned, pinned_position, icon, tile, created_at, updated_at, opened_at, deleted_at (store.go:115-130). NULL folder_id is the Inbox; deleted_at set means Trash (docs/data-format.md:43, 55).
S4.14 settings: key, value. Keys in use: `last_folder`, `recent_folders` (up to 3 ids, newest first), `password_hash` (bcrypt of the SHA-256 of APP_PASSWORD), `password_hmac` (pre 0.1.11, replaced at first start), `icon_failures_version`, `icons_reencoded` (internal/store/folders.go:334-398; internal/store/sessions.go:95-144; internal/store/icons.go:61-133).
S4.15 sessions: token_hash (HMAC-SHA256 of the cookie value), expires_at, created_at, used_at, agent (store.go:134, 184-186; docs/data-format.md:68-78). The list of signed in browsers names a session by its rowid (internal/store/sessions.go:27).
S4.16 icon_failures: bookmark_id (cascade), url_key, count (store.go:171-175).
S4.17 tokens: id, name (up to 80 characters), hash (HMAC-SHA256, unique), created_at, last_used_at, origin (store.go:149-155, 190; internal/store/tokens.go:21).
S4.18 shares: id, folder_id (unique, cascade), token (unique, stored as is), password_hash, password_stamp, expires_at, created_at, opens, last_opened_at (store.go:136-145, 196).
S4.19 Live bookmarks are unique by url_key only among those the caller can see: a bookmark in a locked folder that is not unlocked does not count, and the check runs inside the write transaction (internal/store/bookmarks.go:104-137, 241-307; store.go:197-201).
S4.20 url_key: scheme and host lowercased, `:80` dropped for http and `:443` for https, everything from `#` dropped, an empty path written as `/`; user part, path and query kept byte for byte; only http and https with a host (internal/urlkey/urlkey.go:45-84; docs/data-format.md:113-124).
S4.21 Titles are trimmed and cut to 500 characters; an empty title on a new bookmark becomes the host. Folder names are trimmed, cut to 200 and must not be empty (store.go:33-47; bookmarks.go:250-253; folders.go:113).
S4.22 An address is at most 8192 bytes for new and changed bookmarks (urlkey.go:16-36; bookmarks.go:242).
S4.23 Save with Force on an existing address moves that bookmark to the chosen folder and gives it the new title (bookmarks.go:224-276).
S4.24 Deleting a folder deletes its subfolders and sends every live bookmark inside to Trash with its folder cleared (folders.go:289-313).
S4.25 Bulk actions: move, trash, restore, pin, unpin, delete; delete removes only bookmarks already in Trash (bookmarks.go:570-622).
S4.26 A save into a folder remembers it as last folder and at the front of the recent list of 3 (folders.go:370-398).
S4.27 The connection pool also keeps 4 idle connections (store.go:86).
S4.28 A bulk restore of a bookmark whose address was saved again meanwhile leaves it in Trash without an error (bookmarks.go:570-601).
S4.29 Force on an existing address keeps that bookmark's stored URL; it changes title, folder and position only (bookmarks.go:269-283).
S4.30 An edit that changes the address to another scheme, host or port clears the icon and tile. A changed address whose key another visible live bookmark has is a duplicate, except for a bookmark in Trash, which skips that check (bookmarks.go:355-372, 359).

## 5. Screens and states

### 5a. Layout and theme

S5.1 Phone layout below 720 px, desktop from 720 px; crossing the line redraws live (web/js/util.js:52-53; web/js/render.js:522; web/js/app.js:49).
S5.2 From 720 to 999 px the sidebar is a 72 px icon rail with names in a tooltip (web/app.css:1429-1445; render.js:578-580); the sidebar is 288 px, 240 px at up to 1100 px (app.css:194, 411-412).
S5.3 Sheets are bottom sheets on the phone and 392 px centred dialogs from 720 px (app.css:648-649).
S5.4 Theme: light or dark, chosen before first paint by web/js/theme.js on every page; a saved choice in localStorage `pinned-theme` wins, else the system (theme.js:1-27). Since 0.1.9 (CHANGELOG.md:104-108).
S5.5 The bulb toggles and stores the choice (theme.js:14-20): bottom right on the desktop, made by theme.js on the app page (theme.js:21-26) and shown only from 900 px, so a desktop window from 720 to 899 px has no bulb (app.css:1598-1605); next to the gear on the phone (render.js:340). Login, How to save, save and share pages follow the choice but have no bulb (theme.js:21).

### 5b. Pages

S5.6 Login, `/login`: Password, Code (only with TOTP_SECRET), Log in; a hidden read only user name `pinned` for password managers (web/login.html:78-86; internal/server/pages.go:42-46). Error states from the query: without TOTP "Wrong password." or "Wrong password. Wait N before the next try."; with TOTP "Wrong password or code. A code works once: wait for the next one." or "Wrong password or code. Wait N before the next try."; during a wait "Too many tries. Wait N, then try again." (web/js/app.js:78-83; util.js:69-72; pages.go:85-118).
S5.7 App shell, `/`: needs a login (internal/server/server.go:162; web/index.html:21-27).
S5.8 Save page, `/save`: one sheet with Log out, Title, URL, status line, recent folders, Choose another folder, Save to Inbox and Save; after Save a tick, then the window closes, or a Saved state with Done (web/save.html:13-20; web/js/sheets.js:310-383).
S5.9 How to save, `/bookmarklet`: tabs iPhone, Computer, Android, Extension, the tab for the device first; Copy with a tick; the iCloud Private Relay and Tailscale help; start page help; Show the Save code; Log out (web/bookmarklet.html:16-155; app.js:104-115).
S5.10 Share visitor page, `/s/#<token>` or `/s/<token>`: states "This link does not work.", password screen (Password, Open, "Wrong password.", wait text, "Cannot reach the server..."), the cards with search and folder chips, "Nothing here yet.", no match with Clear search and Show in all of (web/share.js:44-104; web/share.html:8-19). A revoked or expired token on the old path form gets an HTML page "This link is no longer available." with status 404 (internal/server/shares.go:257-292).
S5.11 There is no styled 404 page: unknown `/api/` paths answer JSON "no such endpoint" (server.go:227-229); other unknown routes get Go's plain text answer (server.go:159-230 registers no catch all; FT 04.11 Found on the way 3). 0.1.12: a styled page (S23.8).

### 5c. Views inside the app

S5.12 Dashboard: Recently opened in five bands (Today, Yesterday, Last 7 days, Last 30 days, Earlier), at most 60 links; Inbox links never show there; until a link in a folder is opened it shows Recently saved, Inbox links included; locked folders and folders hidden from Recent are left out; with links but none to show it says "Nothing opened yet" (web/js/home.js:11, 62-74; web/js/state.js:83-92; CHANGELOG.md:141). The pinned row is not part of the Dashboard: it sits above every view, as the dock on the desktop and as a row on the phone on every view but Settings (render.js:196, 363).
S5.13 Empty install: "Nothing here yet" with Add bookmark, Import and a line to How to save (home.js:33; CHANGELOG.md:154).
S5.14 All bookmarks, Inbox (empty: "All sorted"), folder view (title, count, share or lock button, Add, layout, Sort, Select, folder actions), Folders screen (tiles, a Trash row), Trash ("Kept for 30 days", Empty trash) (render.js:110-230, 556-557; home.js:45; state.js:132).
S5.15 On the desktop the Folders screen has no sidebar entry (render.js:186-188). Back links past the top folder go to the Dashboard on the desktop and to Folders only on the phone (render.js:78-83). On the desktop the Folders screen is reached through the palette's Views group (palette.js:63), or by keeping the phone's Folders tab open while the window widens (render.js:520-527).
S5.16 Settings on the phone (gear): How to save, API tokens with count, Import, Export, What's new, Source, Signed in, Log out, with the version and counts (render.js:276, 304-325). On the desktop the same sit under More in the sidebar (render.js:181-194).
S5.17 Views with more than 240 cards show the first 240, "Showing N of M bookmarks" and Show all; Show all draws the rest in blocks of 120 as you scroll and keeps about 6000 drawn (render.js:400-431, 488-516; CHANGELOG.md:28).
S5.18 Grid or list layout; sort Newest, A to Z, Last opened, Your order; Folders sort Your order, A to Z, Newest (state.js:70-74; render.js:28-30, 559-575).
S5.19 Loading: skeleton cards, 8 on the desktop and 6 on the phone (render.js:147, 156, 273, 326).
S5.20 Unreachable: "Cannot reach your Pinned server." (no answer) or "Bookmarks could not load." with Retry; cards already shown are dimmed (render.js:148-154; web/js/api.js:5). A failed refresh with data on screen retries once after 1500 ms (state.js:154-157; CHANGELOG.md:148).
S5.21 Easy password notice: "Your app password is easy to guess. Set a stronger APP_PASSWORD and restart Pinned." when `/api/state` says password_easy (render.js:150-151; internal/server/api.go:182).

### 5d. Sheets, menus and other parts

S5.22 Save sheet: favicon, Title, URL, status "Not saved yet" or "Already saved in <path>. Save anyway moves it here.", up to 3 recent folders, folder picker with New folder; errors "Enter a full address starting with http or https." and "Could not save. Try again."; the error clears on typing (sheets.js:305-366; actions.js:295; CHANGELOG.md:43, 50). The sheet has a Close button (sheets.js:317). A third status, "Already saved" with Save disabled, exists for a duplicate in a locked folder (sheets.js:334, 354, 365); the server never sends that answer (S20.1). 0.1.12 removes it (S23.15).
S5.23 Move sheet with Inbox first, and Move to for folders with Top level first (sheets.js:47-54). A bookmark move shows a toast with Undo (actions.js:98-103, 169; CHANGELOG.md:53); a folder moved with Move to gets no toast and no Undo (actions.js:170).
S5.24 Rename in place on the desktop (F2, Enter saves, Escape cancels), a sheet on the phone; New folder and Rename folder sheets (actions.js:55-74).
S5.25 Confirms: Delete folder ("Its N subfolders go too. N bookmarks go to Trash."), Delete now, Empty trash, Stop sharing, Remove the password (actions.js:75-96; sheets.js:136, 155; CHANGELOG.md:30).
S5.26 Lock, Unlock and Remove lock dialogs, each with Close; the lock note "Use at least 8 characters. Links in this folder stay out of sight everywhere until you unlock it. The password cannot be recovered." plus "Locking ends the share link." when shared (sheets.js:82-106; CHANGELOG.md:54).
S5.27 Share sheet: Share with a link, Copy, Share (with the Web Share API), Lock with a password (Set, Change, Remove, the rule line "Use at least 8 characters."), Expires Never, 1, 7 or 30 days, and the open count (sheets.js:109-156).
S5.28 API tokens sheet: list with created and last used, New token form (name, app password, Create), the token shown once with Copy and the next step, revoke asked in the row (sheets.js:189-222; CHANGELOG.md:56).
S5.29 Signed in sheet: each browser with sign in day and last use, this one marked; Sign out and Sign out all others ask the app password (sheets.js:226-248).
S5.30 What's new: the embedded CHANGELOG from `/changelog`, the newest 3 releases open, older folded (sheets.js:163-188; server.go:171; pages.go:201-206). 0.1.12 marks the running release (S23.13).
S5.31 Add to <folder>: a searchable list of bookmarks not in the folder, "Move N to <folder>", toast with Undo (sheets.js:250-295).
S5.32 Selection bar: desktop top bar, phone bottom bar; Select all, Move, Copy, Share, Trash, More; in Trash Restore and Delete; for folders Delete (render.js:86-105, 349-355).
S5.33 Card hover actions on the desktop: Share, Open, Trash, More (render.js:130-134); in Trash, Restore and Delete now (render.js:128-129). The right click menu and the hover More open one menu with another order: Move, Copy, Share, Trash, then Open, Rename, Pin or Unpin; in Trash, Restore and Delete now (web/js/menu.js:35-45; opened at drag.js:192-197 and actions.js:207).
S5.34 Folder three dots: Share (or Sharing), Add bookmarks, New folder inside, Rename, Move to, Hide from Recent (Show in Recent once set), Lock with a password (or Relock now, Remove lock), Delete (actions.js:104-122; CHANGELOG.md:51). Share is left out for any folder with a lock, open or not; a folder still locked shows only Unlock and Remove lock (actions.js:104-110); Hide from Recent is absent on a subfolder already hidden through its parent (actions.js:119-121).
S5.35 Search palette: Recent (10), Views, Actions (New folder), results grouped by folder, 40 at most then "N more, keep typing", "No matches."; with a result highlighted, Cmd K or Right arrow lists Open, Pin or Unpin, Move to folder, Rename, Copy link, Move to Trash (web/js/palette.js:13-171; CHANGELOG.md:169).
S5.36 Import: a toast "Importing. This can take a moment for a big file." while it runs, Import disabled, then "Imported N, skipped N" (actions.js:134-141; render.js:549).
S5.37 Export: a download of `/api/export`; with locked folders a toast "Exported without <name>: it is locked. Unlock it first to include it." (actions.js:144-147, 161).
S5.38 Toasts: at most 3; 2400 ms; 6000 ms with Undo or for a long text such as the export note; a hold toast (the running import) stays until it is closed, at most 120000 ms (web/js/toast.js:16-28).
S5.39 Visual system: colours, type scale, spacing, radii and component sizes are not written in this spec. At the tag they live only in web/app.css. On the branch release-0.1.12 (9911272, merged at 22fc1d5) they are also W3C design tokens in design/tokens/*.json, each taken from app.css with the line it came from; design/scripts/check-tokens.mjs fails when the tokens and app.css differ, and a Storybook of the app's screens and parts is built from them (design/package.json). From 0.1.12 on the token files are the source of truth (design/scripts/extract-tokens.mjs:2). A px value in this spec is quoted only where a behaviour depends on it.

## 6. Flows

S6.1 The flows are the 12 in design/wireframes/flows/flows.md, one Mermaid diagram each, 119 steps: 01 First start and login (flows.md:5-17), 02 Save a link (19-43), 03 Find and open (45-59), 04 Organise folders (61-79), 05 Locked folders (81-92), 06 Share links (94-106), 07 Import and export (108-119), 08 Second factor and Signed in (121-136), 09 API tokens (138-148), 10 Settings (150-159), 11 Backup and going back (161-169), 12 Errors (171-182).
S6.2 Step ids are flow.step, for example 01.5; FT 04.11 numbers the steps per flow section from line 21 and writes them as flow.step from line 178 (FT 04.11 lines 21 to 200).
S6.3 The step texts of flows.md describe ad2cb8e, the 0.1.11 candidate of 31.10, not v0.1.11 (flows.md:3; FT 04.11 Counts 7). The behaviour at v0.1.11 per step is in FT 04.11, sections 01 to 12. Section 19 lists where they differ. 0.1.12: S23.17.
S6.4 Flows not drawn: VPS install, Firefox token, phone, forgotten password, updates (release log).

## 7. HTTP API

### 7a. Guards

S7.1 Every answer carries `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Frame-Options: DENY` (internal/server/guard.go:203-216; server.go:148).
S7.2 HSTS only when set and the request is HTTPS (server.go:149-151).
S7.3 `api` routes need a session cookie, then `X-Requested-With: fetch` on every method but GET and HEAD; a request with a Bearer token is checked as a token instead and skips both (server.go:292-326). `/api/*` answers carry `Cache-Control: no-store` (server.go:315).
S7.4 A refused CSRF answers 403 "missing X-Requested-With: fetch header" and logs csrf.refused at most once a minute per client (server.go:295-308).
S7.5 OPTIONS on `/api/*` is a CORS preflight answered only for extension origins (chrome-extension, moz-extension, safari-web-extension), with headers Authorization and Content-Type, methods GET, POST, PATCH, DELETE, OPTIONS, max age 600; anything else 403 (server.go:152-155; internal/server/tokens.go:42-84). Credentials are never allowed (tokens.go:52-55).
S7.6 Pages that need a login redirect to `/login?next=<path>` (server.go:328-337); `next` is kept only when it is a path on this site (pages.go:57-75).
S7.7 Errors are JSON `{"error": ...}`: 409 with `duplicate` for an existing address, 404, 400 for bad input, 409 for an existing share or a folder holding a locked folder, 500 "something went wrong" (server.go:642-668).

### 7b. Routes

Auth: "public" needs nothing; "session" needs the login cookie (and the CSRF header when not GET); "token ok" means a Bearer token may call it too (tokens.go:91-97).

- GET /. Auth: session page. What: app. Source: server.go:162.
- GET /login, POST /login. Auth: public. What: login page, form login (body 64 KB). Source: server.go:163-164; pages.go:77-118.
- GET /save. Auth: session page. What: save page; Android share text redirect. Source: server.go:165; pages.go:120-141.
- GET /bookmarklet. Auth: session page. What: How to save. Source: server.go:166.
- GET /search?q=. Auth: public. What: 303 to `/#q=`. Source: server.go:167; pages.go:143-146.
- GET /opensearch.xml. Auth: public. What: OpenSearch description. Source: server.go:168; pages.go:148-160.
- GET /manifest.webmanifest. Auth: public. What: web app manifest with share target. Source: server.go:169; pages.go:162-183.
- GET /health. Auth: public. What: `{"ok":true}`, plus version with a session; 503 when the database fails. Source: server.go:170; pages.go:185-199.
- GET /changelog. Auth: session page. What: CHANGELOG.md. Source: server.go:171.
- GET /icon-192.png, /icon-512.png, /apple-touch-icon.png, /favicon.svg. Auth: public. What: app icons, cached a day. Source: server.go:172-174; pages.go:208-220.
- GET /icons/{file}. Auth: session page. What: a fetched icon, only for a bookmark the session can see. Source: server.go:175; pages.go:222-263.
- GET /extras/{file}. Auth: public. What: the extension zip only. Source: server.go:176; tokens.go:241-259.
- GET /static/. Auth: public. What: web files, no listings, ETag. Source: server.go:177; pages.go:265-304.
- GET /s/, GET /s/{token}. Auth: public. What: share page. Source: server.go:183, 187.
- GET /s/-/data, GET /s/{token}/data. Auth: public, share token. What: share contents. Source: server.go:184, 188.
- GET /s/-/icons/{file}, GET /s/{token}/icons/{file}. Auth: public, share token. What: share icons. Source: server.go:185, 189.
- POST /s/-/unlock, POST /s/{token}/unlock. Auth: public, share token. What: share password. Source: server.go:186, 190.
- POST /api/login. Auth: CSRF header. What: JSON login. Source: server.go:193; api.go:77-96.
- POST /api/logout. Auth: session. What: logout. Source: server.go:194.
- GET /api/sessions; DELETE /api/sessions; DELETE /api/sessions/{id}. Auth: session. What: signed in browsers; end others or one, with the app password. Source: server.go:195-197; sessions.go:34-91.
- GET /api/state. Auth: session, token ok. What: folders, bookmarks, settings, version, password_easy; gzipped when accepted. Source: server.go:198; api.go:112-184.
- GET /api/check?url=. Auth: session, token ok. What: duplicate and icon of the same origin. Source: server.go:199; api.go:186-212.
- POST /api/bookmarks. Auth: session, token ok. What: save; 201 new, 200 when Force updated, 409 duplicate. Source: server.go:200; api.go:216-250.
- POST /api/bookmarks/bulk. Auth: session. What: bulk action. Source: server.go:201; api.go:436-466.
- PUT /api/bookmarks/order. Auth: session. What: order in a folder. Source: server.go:202.
- PATCH /api/bookmarks/{id}. Auth: session, token ok (title and folder_id only, else 400). What: edit. Source: server.go:203; api.go:281-341.
- POST /api/bookmarks/{id}/open. Auth: session. What: mark opened. Source: server.go:204.
- POST /api/bookmarks/{id}/restore. Auth: session. What: restore. Source: server.go:205.
- POST /api/bookmarks/{id}/refetch-icon. Auth: session. What: queue an icon fetch. Source: server.go:206; api.go:376-381.
- DELETE /api/bookmarks/{id}[?permanent=1]. Auth: session. What: Trash, or delete for good. Source: server.go:207; api.go:383-393.
- DELETE /api/trash. Auth: session. What: empty the Trash the session can see. Source: server.go:208; api.go:409-434.
- PUT /api/pinned/order. Auth: session. What: pinned row order. Source: server.go:209.
- GET /api/folders. Auth: session, token ok. What: light folder list without hidden folders. Source: server.go:210; tokens.go:212-239.
- POST /api/folders; PUT /api/folders/order; PATCH /api/folders/{id}; DELETE /api/folders/{id}. Auth: session. What: folders. Source: server.go:211-214; api.go:535-652.
- POST /api/folders/{id}/share. Auth: session. What: create a share. Source: server.go:215; shares.go:167-202.
- POST, DELETE /api/folders/{id}/lock; POST .../unlock; POST .../relock. Auth: session. What: locks. Source: server.go:216-219; locks.go:218-373.
- PATCH, DELETE /api/shares/{token}. Auth: session. What: change or revoke a share. Source: server.go:220-221.
- POST /api/import. Auth: session. What: multipart field `file`, 20 MB. Source: server.go:222; api.go:656-704.
- GET /api/export. Auth: session. What: bookmarks.html download. Source: server.go:223; api.go:706-725.
- GET, POST /api/tokens; DELETE /api/tokens/{id}. Auth: session. What: tokens; create asks the app password. Source: server.go:224-226; tokens.go:162-210.
- any other /api/. Auth: session. What: 404 "no such endpoint". Source: server.go:227-229.

S7.8 A token on any route outside the five gets 403 "not allowed with a token" and logs token.refused (tokens.go:117-121).
S7.9 A JSON body is at most 1 MB (server.go:670-678).
S7.10 A bookmark in a hidden folder answers 404 on single routes; a duplicate that sits only in a hidden folder answers 409 with `"duplicate": null, "locked": true` (internal/server/locks.go:171-208).
S7.11 `/api/state` answers are gzipped at BestSpeed when the client accepts gzip (server.go:585-640; CHANGELOG.md:68).
S7.12 The front end calls the API with same origin credentials and sends `X-Requested-With: fetch` on every method but GET; a 401 on any path but `/api/login` sends the browser to `/login?next=` with path, query and hash (web/js/api.js:8-18).
S7.13 `GET /login` with a live session redirects at once to `next` (pages.go:77-83).
S7.14 `GET /icons/{file}` without a session answers 303 to `/login` (server.go:175, 328-337).
S7.15 An unknown `/api/` path answers 401 "not logged in" without a session and 404 "no such endpoint" with one (server.go:227-229, 320-322).
S7.16 `/static/` serves the embedded web/ folder with `no-cache` and an ETag from 12 bytes of SHA-256, without directory listings (pages.go:265-304). login.html, save.html, bookmarklet.html, share.html and the extension zip are served raw, with `{{BASE_URL}}` not filled in. `/static/index.html` is not served: Go's file server answers 301 to `/static/`, which answers 404 (pages.go:275-280).
S7.17 `/extras/{file}` serves any `.zip` in web/extras as an attachment (tokens.go:241-259).
S7.18 `POST /login`, the form login, is not wrapped in the CSRF header check (server.go:164; pages.go:89-118). The session cookie is SameSite Lax (server.go:386-388).

## 8. Auth, sessions, login code, tokens, locks, shares

### 8a. App password

S8.1 At start the password is checked against `password_hash` (bcrypt cost 10 over SHA-256 of the password); a changed password deletes every session and every token and logs password.changed (cmd/pinned/main.go:154-182, 320-323; internal/store/sessions.go:106-144; internal/auth/auth.go:59-92).
S8.2 The login compares SHA-256 of both sides in constant time against the password in memory (auth.go:28-32; server.go:486-488).
S8.3 An easy password (common list, breached filter, or only words like pinned, bookmark, password or parts of the host names) is refused on a new install or a change; one that ran before 0.1.11 starts with a warning in the log and the app (main.go:162-197, 316-319; internal/auth/passwords.go; CHANGELOG.md:87).
S8.4 The common list holds 10000 entries; the breached filter holds 1000000 entries as a Bloom filter in four files, false positive about one in a million, and refuses everything when it does not open (docs/security.md:40-44; internal/auth/breached.go:33, 138-148; audit R4 F-7).
S8.5 Host words depend on the password kind: APP_PASSWORD is checked at start with the BASE_URL host and the machine name (main.go:188-197); lock and share passwords with the request Host and the BASE_URL host (internal/server/signed.go:47-55). Ports are cut off; parts of at least 4 letters count; stop words www, local, localhost, home, lan, com, net, org; at most 8 words; hosts over 255 characters skipped (internal/auth/passwords.go:44-80).

### 8b. Sessions

S8.6 A login makes a 32 byte random token; the database keeps HMAC-SHA256 of it under secret.key; a login ends the session the browser held before (auth.go:35-48; server.go:339-355).
S8.7 Cookie `__Host-pinned_session` over HTTPS, `pinned_session` over plain HTTP; HttpOnly, SameSite Lax, Path /, Secure over HTTPS; an old unprefixed cookie is moved to the new name (server.go:25-31, 357-391).
S8.8 Idle limit SESSION_DAYS, renewed at most once a day, never past SESSION_MAX_DAYS from the login; last use recorded at most once an hour (server.go:234-290).
S8.9 Expired sessions are removed at start and every night at 03:00 (internal/jobs/jobs.go:51-63, 94-118).
S8.10 HTTPS is decided by TLS, by X-Forwarded-Proto from TRUSTED_PROXIES (or loopback when that is empty), or by an https BASE_URL naming the request host; the first ignored header from a private or loopback or 100.64.0.0/10 address is logged once (server.go:416-476).
S8.11 Signed in lists live sessions by rowid with browser name, created and last use; ending another session or all others asks the app password; ending one's own is a logout (internal/server/sessions.go:34-115).
S8.12 Browser names come from the User-Agent: Edge, Opera, Firefox, Samsung Internet, Chrome, Safari on iPhone, iPad, Android, ChromeOS, macOS, Windows, Linux (sessions.go:117-163).

### 8c. Device cookie and wrong tries

S8.13 After the right app password a browser gets `pinned_device` (`__Host-` over HTTPS), `v1.` plus a random id and an HMAC over the id and the password fingerprint, 400 days, HttpOnly, Lax (internal/server/device.go:12-88).
S8.14 Limiter: 5 wrong tries give a 30 second wait; 100 wrong tries in 10 minutes from all clients hold every client that is not a known device; during a wait no password is checked; tries from one client run one at a time; every wrong try waits 1 second (auth.go:130-298; guard.go:16-18, 127-154).
S8.15 A client is its address, IPv6 by /64; X-Forwarded-For is read right to left only from a trusted proxy (guard.go:52-94).
S8.16 Separate counters: app password (login, code, token create, lock remove, sign outs), tokens, one per share, one per folder (server.go:100-105; guard.go:96-125).
S8.17 A wait answers 429 with Retry-After and "Too many tries. Wait <time>, then try again.", the time said in seconds, minutes or hours rounded up (guard.go:178-201).
S8.18 Counts live in memory; a restart clears them; a client quiet for an hour is forgotten (auth.go:292-298; docs/security.md:63).

### 8d. Login code (TOTP)

S8.19 RFC 6238 with HMAC-SHA1, 6 digits, 30 second steps, one step of drift either way; spaces in the code ignored (internal/auth/totp.go:28-95).
S8.20 A code works once: a step at or before the last used is refused; this memory is lost on restart (totp.go:97-105; docs/security.md:134).
S8.21 The code is checked only after the right password; after 5 wrong codes in a row every login is held 1 minute, doubling to at most 1 day, until a right code (internal/auth/backoff.go:25-90; server.go:498-554).
S8.22 A device cookie does not skip the code; API tokens need no code (server.go:498-500; README.md:129).

### 8e. API tokens

S8.23 `tk_` plus 32 random bytes in base64url; the database keeps HMAC-SHA256; shown once. Creation needs a name and the app password; an empty name answers 400 before the password is checked (tokens.go:186-189); a name over 80 characters is cut, not refused (internal/store/tokens.go:57-66); the answer is 201 with id, name, token and created_at (tokens.go:205).
S8.24 A token may call five routes: GET /api/state, GET /api/folders, GET /api/check, POST /api/bookmarks, PATCH /api/bookmarks/{id} (tokens.go:86-97).
S8.25 A token request carries no cookies, so it never sees inside a locked folder (tokens.go:148-151).
S8.26 Only an extension Origin binds a token, the first one that uses it. While a token is unbound, a request with a web page Origin passes and binds nothing. Once bound, any other Origin gets 403 "This token is used by another copy of the extension. Create a new token for this one." and token.refused with reason=origin. Requests without Origin always pass (tokens.go:122-141).
S8.27 Last use is written at most once a minute (tokens.go:142-147).
S8.28 A wrong token gets 401 "invalid token" under the token limiter (tokens.go:109-116).

### 8f. Locked folders

S8.29 A lock password needs at least 8 characters and must not be easy; changing it needs the current one (locks.go:22-26, 241-259).
S8.30 Lock and share hashes: `k1:` plus bcrypt cost 10 over base64 HMAC-SHA256 of `password\x00` and the password under secret.key; pre 0.1.11 hashes are plain bcrypt and are replaced at the next right password (internal/auth/passwords.go keyed functions; signed.go:30-43, 80-113; docs/data-format.md:33).
S8.31 A random 16 byte stamp is made when the password is set; unlock cookies sign it, so a rehash keeps them (internal/store/folders.go:52-58; internal/store/locks.go:8-38). A lock set before schema 11 has no stamp and its cookies sign the hash; its first rehash adds a stamp (`COALESCE(lock_stamp, ?)`, locks.go:32-38), so other browsers unlock once more. Shares work the same way (internal/server/signed.go:70-113).
S8.32 Unlock: cookie `pinned_unlock_<id>` (`__Host-` over HTTPS) with `v1.`, the expiry and an HMAC over folder, stamp and expiry; 10 minutes (locks.go:22-64, 312-359).
S8.33 While locked, the folder's subfolders and bookmarks are left out of state, search, Recent, pinned row, Inbox, Trash, export in the app, icons and token answers (locks.go:66-170; api.go:142-162; pages.go:226-248). In `/api/state` only the folder's name shows (api.go:142-155); `/api/folders` leaves the folder out entirely (tokens.go:233-236) and `/api/check` skips its bookmarks (api.go:202).
S8.34 Remove lock needs the app password (locks.go:278-310). Relock clears the cookie (locks.go:361-373).
S8.35 Setting or removing a lock deletes the shares of the folder and every folder below; moving a folder into a locked one does too (internal/store/locks.go:5-56; folders.go:251-260).
S8.36 A folder holding a locked subfolder that is not unlocked cannot be deleted (api.go:629-633; locks.go:152).

### 8g. Share links

S8.37 One share per folder; the token is 24 random bytes in base64url, stored as is; new links are `/s/#<token>` and the page sends the token in `X-Share-Token`; `/s/<token>` links still work (shares.go:24-111; server.go:179-190).
S8.38 A locked folder cannot be shared (409) (shares.go:191-194).
S8.39 Optional password of at least 8 characters, not easy; expiry 1 to 3650 days or never (shares.go:122-165).
S8.40 After the right password the browser stays unlocked 7 days: cookie `pinned_share_<id>` (`__Secure-` over HTTPS), Path /s/, signed over token, creation time, stamp and expiry (shares.go:24-87, 298-353).
S8.41 Opens are counted once per browser per hour through a `pinned_share_seen_<id>` cookie (shares.go:396-405).
S8.42 Share answers carry `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`; the share page allows blob images (shares.go:251-292).
S8.43 Shares are not in any export (README.md:299).

### 8h. Further facts

S8.44 HSTS is sent without includeSubDomains or preload (server.go:33-37, 150).
S8.45 Only the first X-Forwarded-Proto value is read (server.go:435); a broken X-Forwarded-For entry stops the right to left walk (guard.go:70-79).
S8.46 Ending one's own session through `DELETE /api/sessions/{id}` is a logout without the app password, logged as `logout` (internal/server/sessions.go:61-66).
S8.47 The per share and per folder limiters are kept in maps that are never pruned while the server runs (guard.go:96-115).
S8.48 token.refused lines have no rate cap, unlike csrf.refused (tokens.go:118, 137; server.go:300).
S8.49 A lock or share hash from before 0.1.11 never matches a password over 72 bytes (internal/auth/passwords.go:175-183).
S8.50 The form login takes the password and code from the posted form without the CSRF header (S7.18); the JSON login `POST /api/login` checks the header (server.go:193).
S8.51 Form login: a body that does not parse redirects to `/login?error=1` without `next` (pages.go:90-93); a session that cannot start answers plain text 500 "could not start a session" (pages.go:111-114).
S8.52 Unlocking a share that has no password answers 204 and sets the cookie with no check (shares.go:335-352).
S8.53 PATCH or DELETE of a share whose folder is hidden by a lock answers 404 (shares.go:207-223); a share create in a folder under a hidden parent answers 404 before the 409 for a locked folder (shares.go:187-194).
S8.54 The sign out routes answer 400 "invalid JSON body" when the body is missing, before the password is checked (internal/server/sessions.go:97-105).
S8.55 A Bearer token on an unknown `/api/` path gets 403 "not allowed with a token", or 401 "invalid token" for a bad token, not 404 (server.go:227-229; tokens.go:109-121).
S8.56 The easy password check blocks passwords made only of the words pinned, bookmarks, bookmark, password, passwort, passwd and the host words, joined in any order, also in leet spelling (0 o, 1 i, 3 e, 4 a, @ a, $ s, 5 s, 7 t, ! i) and with digits or symbols around them (internal/auth/passwords.go:42, 85-145). Host words are split at dots, hyphens and underscores, and only letters count (passwords.go:65-69).
S8.57 A 429 is sent on the try that starts a wait as well as during one (guard.go:156-176; server.go:544-553).
S8.58 The icon writes that skip the store mutex (S4.7) also skip the import's `writes` counter (internal/store/icons.go:110, 116, 130; store.go:63-65).

## 9. Icons

S9.1 When a bookmark is created, the icon of a bookmark on the same scheme, host and port is reused if one the caller can see has one; up to 20 are looked at, live first, Trash included (internal/store/bookmarks.go:171-204; api.go:252-279). Otherwise a fetch is queued. A changed address, an import and Refetch also queue one (api.go:334-338, 376-381, 690-692). A Force save that updates an existing bookmark (200) queues nothing (api.go:244-248).
S9.2 At start every live bookmark without an icon is queued, except one whose icon failed 3 times for its current address; the count is emptied when the version differs (cmd/pinned/main.go:335-355; internal/store/icons.go:7-81).
S9.3 Workers 4, queue 4096 (a full queue drops the request), 6 seconds per bookmark, user agent `Mozilla/5.0 (compatible; Pinned bookmarks; favicon fetch)` (internal/favicon/fetch.go:27-35, 289-297, 414-424).
S9.4 Reads: page or manifest 512 KB, icon 2 MB; 8 candidates; 5 redirects; TLS handshake 5 s; private host lookup 2 s (fetch.go:29-31; guard.go:17, 146, 161-167, 200).
S9.5 Candidate order: apple-touch-icon links (`apple-touch-icon-precomposed` counts), manifest icons, icon links; then, only when the page declared no apple link, no icon link and no manifest and its path is not `/`, the site root's apple and icon links (no manifest); then `/favicon.ico` and `/favicon.svg` (fetch.go:45-113, 78-88; choose.go:73). Within a group the largest comes first; `sizes="any"` or an SVG without sizes ranks above every pixel size; `<base href>` is honoured; `data:` hrefs are skipped (choose.go:56-63, 80-82, 113, 133-140).
S9.6 Network guard: only public addresses, except that a private bookmark host may load from itself; special ranges always refused; NAT64 and 6to4 judged by the embedded IPv4; zoned IPv6 refused; ports 80, 443 and the bookmark's own; no step from https to http; checked on the dialled address; no proxy (guard.go:25-226).
S9.7 `ICONS=off` stops every fetch; `ICON_HOSTS` keeps fetches to listed hosts and subdomains, also for redirects (fetch.go:277-279, 417, 448, 455-460; guard.go:179-181, 234-260).
S9.8 Formats: PNG, JPEG, GIF (first frame) and ICO (largest frame) are decoded and stored as a new PNG; WebP is not taken (internal/favicon/image.go:45-122, 193-201).
S9.9 Size caps: 4096 px a side, 16000000 pixels (ICO frames summed), stored PNG at most 2 MB (image.go:29-43, 131, 147-191).
S9.10 SVG: checked against an allow list of 53 elements (svg.go:64-71) and listed attributes, CSS functions and at rules; no script, links, animation or foreign namespaces, except 14 drawing program namespaces that pass the check (svg.go:43-58, 177, 225); `href` only to `#id` or an embedded raster data URI. Then a new SVG is written from the checked tree, which drops those drawing program namespaces with their content and the `metadata` element (svg.go:533), and is checked again (image.go:86-107).
S9.11 SVG caps: input and output 1 MB, checked in processSVG (image.go:88-102; constants svg.go:20-24). At most 8 embedded pictures, counted twice: `data:image` in the raw text (svg.go:483) and the decoded count (svg.go:541, 653). Each picture at most 1024 px a side (svg.go:670-695).
S9.12 Tile colour: the median of each colour channel taken separately over the outer 2 px ring, after undoing premultiplied alpha and ignoring pixels under half alpha; none for SVG (image.go:203-238).
S9.13 File name `<bookmark id>-<8 hex of SHA-256>.<png or svg>`, written through a temp file, 0600 (fetch.go:489-490, 525-545).
S9.14 Failure counting: lasting failures (an HTTP error, a broken icon, a certificate error, a redirect loop, a refused address, a domain that does not exist) count once per fetch; outages (timeouts, DNS server errors, refused or reset connections, unreachable networks) do not (fetch.go:37-43, 200-230, 481-487). Nothing is counted when no request got a lasting answer or the 6 s budget ran out (fetch.go:106-108). A decoder panic is caught by Process and reported as "broken image" (image.go:50-61); that candidate is skipped (fetch.go:102) and the bookmark counts once like any no_icon. Only a panic elsewhere in the fetch reaches the recover in Run, logs `broke` and counts as 3 at once (fetch.go:461-466; store/icons.go:31-33).
S9.15 Start passes: every start rewrites stored SVG icons in use; once per data folder PNG and JPEG icons are stored again as new PNG (flag `icons_reencoded`); an icon that fails is dropped and its bookmarks show the letter; old files stay, unserved (fetch.go:285-409).
S9.16 Serving: only to a session that can see a bookmark using the file, or through an unlocked share whose live visible bookmark uses it; `Cache-Control: private, max-age=31536000, immutable`; CSP `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox` (pages.go:222-263; shares.go:448-481).
S9.17 Unused icon files are removed after delete for good, Empty trash, a bulk delete, the Trash purge, an address change, and when a fetch replaces a bookmark's icon (api.go:334-337, 386-388, 427-432, 459-464; internal/jobs/jobs.go:51-75; fetch.go:503-505).
S9.18 The start passes run even with ICONS=off (main.go:332-333; fetch.go:285-298).
S9.19 At start, bookmarks without an icon go into the 4096 slot queue; any past that are dropped until the next start (main.go:346-354; fetch.go:414-424).
S9.20 The guard refuses IPv4 compatible IPv6 addresses (guard.go:35-61); allows the bookmark's own port on every host a fetch reaches, not only its own host (guard.go:102-108); lets a redirect go only to http or https (guard.go:199-218); and treats a bookmark host whose lookup fails as not private, so no private address is allowed for it (guard.go:140-158).
S9.21 A page over 512 KB is cut and parsed as far as it was read, not refused (fetch.go:196).
S9.22 SVG check details: the root must be `svg`; a DOCTYPE with an internal subset, processing instructions other than the XML declaration, backslashes in CSS and `xml:base` are refused; HTML entities are accepted (svg.go:130-215, 223-224, 296).
S9.23 Re-encoded files at start get a new name and their bookmarks are pointed to it; a failed repoint removes the new file and the next start tries again (fetch.go:386-408).

## 10. Import and export

S10.1 Import takes a Netscape bookmarks file as multipart field `file`, at most 20 MB, or answers 413 (api.go:656-672).
S10.2 A file not parsed answers "not a bookmark file"; a file nesting more than 256 deep is refused before anything is written with "The folders in this file nest more than 256 deep. Pinned cannot import it." (api.go:659, 674-682; internal/netscape/netscape.go:36-43; internal/store/transfer.go:44-47).
S10.3 Folders are matched by name under the same parent and made when missing; deeper than 32 lands in the folder at depth 32; names cut to 200 characters (transfer.go:23-35, 208-232, 286-340).
S10.4 Skipped: links that are not http or https, longer than 8192 bytes, or already saved outside a hidden folder; root links go to the Inbox (transfer.go:26-33, 233-260).
S10.5 A folder in the file with the name of a locked folder comes in as `<name> (imported)` (transfer.go:31-32, 341-372; README.md:288).
S10.6 The import commits in steps of about 100 ms; if a folder it writes into is deleted or locked between steps it stops with 409 and the count that came in (transfer.go:36-40, 89; api.go:697-698).
S10.7 The answer is `{"added", "skipped", "folders"}` (transfer.go:14-21).
S10.8 Export in the app leaves out folders hidden in that browser and is sent as `bookmarks.html` (api.go:706-725).
S10.9 The nightly export `export/bookmarks.html` holds every live link, locked folders included, written at 03:00 in TZ and at start when older than a day, through a temp file and rename, mode 0600 (internal/jobs/jobs.go:20-49, 77-105).
S10.10 The export format: Inbox links at the root, folders as H3 with their own DL, ADD_DATE the creation time; no Trash, pins, icons, locks, shares, sessions or tokens (docs/data-format.md:128-151; internal/netscape/netscape.go:164-205).
S10.11 Import or export needs a login; a token cannot (tokens.go:91-97; docs/security.md:111-112).
S10.12 A folder with an empty name comes in as "Imported" (transfer.go:286-290).
S10.13 ADD_DATE becomes created_at; millisecond and microsecond values are scaled down to seconds; a missing or negative date takes the import time (transfer.go:253-256, 310-313; netscape.go:149-159).
S10.14 A link repeated within the same file comes in once; the repeats count as skipped (transfer.go:244-246).
S10.15 A link with an empty HREF is dropped and counted nowhere (netscape.go:100-102).
S10.16 A file with no `<DL>` list is "not a bookmark file" (netscape.go:58-62).
S10.17 A request without the multipart field gets 400 "send the bookmark file as multipart field \"file\"" (api.go:670).
S10.18 Where two folders on one level share a name, the unlocked one wins, then the first by position (transfer.go:343-347).
S10.19 Links saved before an import stopped midway still get icon fetches (api.go:689-693).
S10.20 Nesting deeper than 256 is refused by Parse (netscape.go:92-94) and checked again by Import (transfer.go:45-46), although the comment at transfer.go:43 says Parse never returns it.
S10.21 Export indentation stops growing after 32 levels (netscape.go:164-183). The export folder is made 0700 (jobs.go:26).
S10.22 The Trash purge runs at every start; the nightly export at start only when stale (jobs.go:95, 107-118).

## 11. Extension, bookmarklet, search engine and other ways to save

S11.1 Bookmarklet: `javascript:` code that opens `<origin>/save?url=...&title=...` in a 392 by 544 window, or navigates when the window is blocked; the origin is BASE_URL, or the page's own origin when it is the same host (web/js/app.js:88-95).
S11.2 Android: the manifest declares a share target to `/save` with GET title, text and url; a URL inside `text` is moved to `url` by a 303 (pages.go:120-141, 162-183).
S11.3 Home screen: the manifest with standalone display, and Apple web app meta tags (pages.go:162-183; web/index.html:9-15).
S11.4 Search engine: `/opensearch.xml` names `<base>/search?q={searchTerms}`; `/search` redirects to `/#q=` and the app opens the palette with it; the link tag is in index.html only (pages.go:143-160; web/index.html:16; app.js:40-44).
S11.5 Extension: Manifest V3, version 1.0.0, permissions activeTab, storage, contextMenus, optional host permissions for any http and https host, a Firefox add-on id under pinned.cc, from Firefox 142 (extras/extension/manifest.json:2-33).
S11.6 Shortcut Alt Shift S opens the popup; the popup shows title, address, 3 recent folders, Choose a folder, Save to Inbox; a duplicate offers Save anyway; a browser page says "This page cannot be saved" (manifest.json:21-26; extras/extension/popup.js:8-169).
S11.7 Context menu "Save to Pinned" on pages and links saves to the Inbox; the badge shows a tick, `=` when already saved, `!` on failure, for 2 seconds (extras/extension/background.js:5-48).
S11.8 Options take an address and a token. An address typed with `http://` or `https://` is used as typed, and the token goes to it as typed, over plain http too, for any host (extras/extension/shared.js:20-24, 46-56). An address typed without a scheme is tried with https, then http; that http guess gets the token only when the host is on the own network: IPv4 private, loopback, link local and 100.64.0.0/10, IPv6 `::1`, `fc00::/7` and `fe80::/10`, a name without a dot, `.local`, `.lan`, `.home.arpa`, `.internal` (shared.js:25-38). For any other host the options report that http answers and say to type `http://` to use it (shared.js:48-52; options.js:15-72; CHANGELOG.md:44). This is the open audit finding F-138 of 04.11 (low, user impact possible): with `http://` typed for a public host the token goes over plain http and the options show Connected with no warning (task list). 0.1.12: S23.1.
S11.9 Storage keys `address`, `token`, `recent` in the browser's local extension storage (shared.js:76-101).
S11.10 The extension zip is packed by tools/pack-extension.sh into web/extras/pinned-extension.zip at build time, deterministic, and served at `/extras/pinned-extension.zip` without login (tools/pack-extension.sh:6-22; Dockerfile:15-16; tokens.go:241-259).
S11.11 Browsers named: Brave, Chrome, Edge and Firefox (extras/extension/README.md:3); Firefox loads it as a temporary add-on, removed at quit (README.md:144; bookmarklet.html:139).
S11.12 Script examples: save.sh, raycast-save-link.sh, homeassistant.yaml, n8n-save-bookmark.json and feed-to-folder.py, using GET /api/folders and POST /api/bookmarks with a token (extras/examples/README.md; save.sh:77, 107; feed-to-folder.py:96, 115).
S11.13 The iOS Shortcut of 0.1.0 was removed in 0.1.1 (CHANGELOG.md:206, 233).
S11.14 Popup states: "Set your address and token first" with Open settings, "This page cannot be saved", "The token was not accepted", "Could not reach your server" (popup.js:145-152). A right click save with no setup opens the options page (background.js:39).
S11.15 Options: Test reports "Connected to <address>, N folders." (options.js:27-35). Save asks host permission for the address only, gives back the permissions it does not use, and clears the recent folders when the address changes (options.js:37-72).
S11.16 The manifest names both a background service worker and background scripts (manifest.json:14-17): Chromium browsers run the service worker, Firefox runs the scripts as a background page (extras/extension/README.md:40).

## 12. Backups, upgrade and going back

S12.1 Backup: `sqlite3 data/bookmarks.db ".backup backup.db"`, or stop, copy the data folder, start; keep secret.key and icons with it (README.md:251-263).
S12.2 Restore: stop, put the files back (a `.backup` copy as bookmarks.db with no -wal or -shm), owned by 1000, start (README.md:265).
S12.3 Upgrade: `docker compose pull` and `up -d`; migrations run at start (README.md:267; store.go:251-293).
S12.4 Before migrating an existing database (version above 0 and below the newest) Pinned writes a copy with `VACUUM INTO` under a temp name, renames it to `bookmarks-schema<old>-<date>.db`, 0600, removes an older copy of the same schema with the same bytes, and keeps the newest 3 by modification time, always the one of this start (store.go:267-274; internal/store/backup.go:18-184).
S12.5 If the copy fails, nothing is migrated and the start stops with "could not back up the database before upgrading it from schema N ..." (store.go:238-249, 268-272).
S12.6 The log names the copy: "database: upgrading from schema 6 to 12; the database as it was is saved at ..." (store.go:273; FT 04.11 11.2).
S12.7 Going back: 0.1.1 to 0.1.10 refuse the upgraded database (S4.10); 0.1.0 has no such check and opens it (S4.10). The README says to move bookmarks.db aside, copy the copy in as bookmarks.db without -wal or -shm, set the old image and start (README.md:269). 0.1.12 corrects the README's first sentence (S23.16).
S12.8 The copy is the state before the upgrade: links saved since are missing, and locks, passwords, revoked shares and tokens and ended sessions are as they were; the README says to lock and revoke again and change APP_PASSWORD (README.md:269; store.go:219).
S12.9 Icons: 0.1.11 keeps the PNG and JPEG files of older versions next to the re-encoded ones, so going back shows them; icons it removed show the letter until refetched (README.md:269; docs/data-format.md:155).
S12.10 Changing APP_PASSWORD ends every session, every token and every device cookie (README.md:273; internal/store/sessions.go:106-144; device.go:22-26).
S12.11 Rotating secret.key: delete it and start; sessions end, tokens stop, device cookies end, every unlocked folder locks again and every unlocked share asks again, share links keep working, and lock and share passwords set or used since 0.1.11 no longer match, because a pre 0.1.11 hash is replaced at the next right password (docs/security.md:136-149).
S12.12 The flow test ran the upgrade from 0.1.10 and the way back with the copy: 0.1.10 ran with 15 bookmarks and 5 folders (FT 04.11 11.2 to 11.5).
S12.13 Upgrade copy names use local time in TZ, not UTC (internal/store/backup.go:23, 30-32, 77).
S12.14 Leftover `.backup-*.tmp` files from a crash are deleted before a new copy is made (backup.go:83-87).
S12.15 The 3 kept copies are counted across all schemas, not per schema (backup.go:163-183).

## 13. Limits and sizes

- JSON body. Limit: 1 MB. Source: server.go:670-678.
- Login form body. Limit: 64 KB. Source: pages.go:90.
- Import file. Limit: 20 MB. Source: api.go:657.
- Request line and headers. Limit: 64 KB. Source: cmd/pinned/main.go:402-416.
- Read headers / whole request / write / idle. Limit: 10 s / 60 s / 120 s / 120 s. Source: main.go:407-416.
- Shutdown. Limit: 10 s. Source: main.go:397.
- Address. Limit: 8192 bytes. Source: urlkey.go:19.
- Title / folder name / token name. Limit: 500 / 200 / 80 characters. Source: store.go:35-38; internal/store/tokens.go:21.
- Folder depth / import nesting. Limit: 32 / 256. Source: store.go:31; netscape.go:40.
- App, lock, share password. Limit: at least 8 characters, no upper limit. Source: main.go:38; locks.go:25; shares.go:31.
- Share expiry. Limit: 1 to 3650 days or never. Source: shares.go:30, 152-163.
- TOTP secret. Limit: at least 16 bytes. Source: totp.go:34.
- Wrong tries. Limit: 5 then 30 s; 100 in 10 min for everyone; 1 s each. Source: auth.go:151-156; guard.go:18.
- Wrong codes. Limit: 5 then 1 min doubling to 1 day. Source: backoff.go:25-28.
- Session idle / absolute / device cookie. Limit: 90 days / 365 days / 400 days. Source: server.go:82, 86; device.go:20.
- Folder unlock / share unlock. Limit: 10 min / 7 days. Source: locks.go:24; shares.go:29.
- Trash. Limit: 30 days. Source: jobs.go:18.
- Upgrade copies kept. Limit: 3. Source: backup.go:20.
- Icon limits. Limit: S9.3, S9.4, S9.9, S9.11.
- Cards drawn before Show all. Limit: 240. Source: render.js:410.
- Token last use written. Limit: at most once a minute. Source: internal/server/tokens.go:143.
- Session last use written / renewed. Limit: at most once an hour / once a day. Source: server.go:278, 284.
- Share open counter cookie. Limit: 1 hour. Source: shares.go:403.
- csrf.refused log line. Limit: once a minute per client. Source: server.go:300.
- Healthcheck client timeout. Limit: 5 s. Source: main.go:102.
- Free wrong codes before the code wait. Limit: 5. Source: backoff.go:26.
- Limiter forgets a quiet client. Limit: 1 hour. Source: auth.go:292-297.
- bcrypt cost. Limit: 10. Source: auth.go:59 (bcrypt.DefaultCost).
- App icon cache. Limit: 86400 s. Source: pages.go:217.
- Icon fetch dial and request timeout. Limit: 6 s. Source: internal/favicon/guard.go:182, 197.
- First session lifetime. Limit: the smaller of SESSION_DAYS and SESSION_MAX_DAYS. Source: server.go:348.

S13.1 Footprint: binary about 12 MB, about 40 MB of memory idle as measured on 2026-10-12 (README.md:311-312).
S13.2 Measured at v0.1.11: import of 100000 links (17.4 MB) in 9.0 s and 114000 links (19.9 MB) in 8.7 s; All bookmarks with 100000 links drawn in 919 ms (FT 04.11 07.2, 03.11).

## 14. Logging

S14.1 The log goes to standard error, every line starting with the time in UTC (RFC 3339); nothing is written to the data folder (cmd/pinned/main.go:59-60, 83-97; docs/security.md:177).
S14.2 Security events are `security event=<name> ip=<client>` and fields; values with spaces, quotes, `=` or unprintable characters are quoted (internal/server/seclog.go:18-55).
S14.3 Events: login.ok, login.fail, login.wait, totp.fail, totp.wait, logout, session.end, session.end_others, token.fail, token.wait, token.refused, token.create, token.delete, reauth.fail, reauth.wait, lock.fail, lock.wait, lock.unlock, lock.set, lock.change, lock.remove, share.fail, share.wait, share.unlock, share.create, share.change, share.delete, csrf.refused, icon.fail, password.changed, password.easy (docs/security.md:189-212). Code sites: login and totp fail and wait at server.go:519, 547-552 through seclog.go:60-68; api.go:94-107; sessions.go:63-89; tokens.go:118, 137, 204, 209; locks.go:255, 269-273, 307, 343, 357; shares.go:200, 238, 246, 341, 345; server.go:301; internal/favicon/fetch.go:272; main.go:317, 321.
S14.4 A `.wait` line is written once per client and kind while the wait lasts (seclog.go:57-86).
S14.5 icon.fail carries the host only and a kind: certificate, blocked, no_such_host, http, unreachable, no_icon, broke, other (docs/security.md:210; fetch.go:107-110, 143, 156-177, 464). When several requests fail, the kind with the highest fixed rank is logged (fetch.go:146-148).
S14.6 Other lines: start line with version, port and data folder; the TOTP line; upgrade and copy; files not made private; Trash purge counts; failures of the nightly export, purge, copies and icon files; `error:` lines; `shutting down` (main.go:386-396; jobs.go:107-118; store.go:273; docs/security.md:216-221).
S14.7 No line per request; never logged: passwords, codes, tokens, share tokens, cookie values, hashes, secret.key (docs/security.md:223-227).

## 15. Accessibility and browser support

S15.1 Landmarks: header with a hidden h1, aside "Folders", main, nav "Pinned" and nav "Recent", toolbars with labels; the share page has main, header, footer and a search landmark on the phone (web/index.html:22; render.js:42-43, 73, 90-118, 344; share.js:75-77; share.html:17-19; CHANGELOG.md:22).
S15.2 One polite live region announces toasts, palette counts and saves; errors use role alert, the Already saved line and the easy password notice role status (index.html:26; toast.js:5-18; login.html:85; render.js:148-151; sheets.js:321).
S15.3 Sheets are modal dialogs: focus moves in on open and back on close, Tab is trapped, Escape closes (sheets.js:12-28, 75; web/js/keys.js:34-49; CHANGELOG.md:29).
S15.4 Visible focus: a 2 px accent outline on :focus-visible and own rings on cards, dock and buttons (app.css:186, 264-266, 325-328).
S15.5 Reduced motion turns transitions and animations off in CSS and skips them in JS (app.css:1194; util.js:51; sheets.js:18, 371; toast.js:22).
S15.6 Touch targets: a 44 px token `--tap` used for phone controls and How to save buttons (app.css:157, 722, 737, 907); the snippet Copy buttons on How to save are 36 px (app.css:976); mouse desktop controls are smaller (card action buttons 28 px, controls 36 px, app.css:156, 342) and become 44 px for coarse pointers from 720 px (app.css:1448-1460). 0.1.12 gives Show the Save code on How to save a 44 px target (S23.5).
S15.7 Keyboard: `/` and Cmd K or Ctrl K search, N new folder, S select, F2 rename, arrows move, Shift arrows extend, Enter opens, Delete or Backspace trashes, Escape steps back, Cmd Z undoes while an Undo toast shows, Cmd A selects all (keys.js:12-71; palette.js:150-171; CHANGELOG.md:225).
S15.8 Pointer: long press 450 ms starts selecting, drag from 8 px moves and reorders, a box drawn on empty space selects, finger painting selects on touch, swipe down closes a phone sheet (web/js/drag.js:13-201; web/js/select.js:39-116; sheets.js:403-425).
S15.9 Browsers tested at v0.1.11: the UI test passed 141 tests in Chromium 149 and 140 in WebKit 26.5 at the tag (FT 04.11 line 227); Firefox 151 passed 140 at 175a5d2 on Ubuntu 26.04 (docs/testing.md:47; release log).
S15.10 Feature checks with fallbacks: Web Share API (fallback mailto or Copy), Clipboard API (fallback execCommand), visualViewport, ResizeObserver, IntersectionObserver, View Transitions (fallback a fade), backdrop-filter by @supports (actions.js:19-24; util.js:97-101; render.js:255, 488, 563-574; app.css:424).
S15.11 The axe run of 04.11 found label-content-name-mismatch (WCAG 2.5.3) on sidebar folders, the phone pinned row and phone share cards; login, How to save and the save page were clean (FT 04.11 Found on the way 2, P-WEB-2). 0.1.12 fixes the sidebar folders (S23.11).

## 16. Security controls and the audit

S16.1 Release audit 4 of 0.1.11 against OWASP ASVS 5.0.0 Level 2 at commit 895474a, last tag v0.1.10: 134 pass, 1 fail (V5.4.3), 1 not applicable (V5.2.3); our checks 35 pass; platform check P-DOCKER-1 fail (audit R4 checklist.json; findings.json `commit`, `last_tag`; release log). The audited commit is two commits before the tag; `git diff 895474a v0.1.11` touches only README.md, CHANGELOG.md and tools/setup.test.sh, no product code.
S16.2 The one documented exception: V5.4.3, no antivirus scan of fetched files; icons are rebuilt instead. Accepted by the maintainer on 2026-11-03 (audit R4 F-111; decision log).

- V2.4.1. Control: anti-automation: wrong try limits, header cap against slow password checks. Code or doc: guard.go:96-160; auth.go:130-298; main.go:402-404.
- V3.2.1, V3.2.2. Control: content served as text, icons sandboxed. Code or doc: pages.go:222-263; shares.go:274.
- V3.3.1 to V3.3.4. Control: cookies Secure over HTTPS, SameSite Lax, HttpOnly; `__Host-` prefix on session, device and unlock cookies, `__Secure-` on share cookies, which are scoped to /s/. Code or doc: server.go:369-415; device.go:78-88; locks.go:347-356; shares.go:56-72, 347-351.
- V3.4.1. Control: HSTS, off by default. Code or doc: server.go:33-37, 149-151.
- V3.4.2. Control: CORS only for extension origins, per token origin. Code or doc: tokens.go:42-84, 122-141.
- V3.4.3 to V3.4.6. Control: CSP, nosniff, no-referrer, frame-ancestors none. Code or doc: guard.go:203-216.
- V3.5.1, V3.5.3. Control: CSRF header on changes; methods per route. Code or doc: server.go:159-230, 292-308.
- V3.5.4. Control: own host name advised. Code or doc: README.md:196.
- V3.7.2. Control: redirects only to paths on the site. Code or doc: pages.go:57-75.
- V5.1.1, V5.2.1, V5.2.2. Control: file types and sizes for import and icons. Code or doc: api.go:656-673; image.go; svg.go.
- V5.3.1, V5.3.2. Control: icons served under a fixed folder with server made names. Code or doc: pages.go:250-263; internal/favicon/fetch.go:489-490 (fresh fetch), 386-393 (start pass).
- V5.4.3. Control: fail, accepted (S16.2). Code or doc: docs/security.md:107.
- V6.2.1, V6.2.9. Control: at least 8 characters, 64 and more allowed. Code or doc: locks.go:25; shares.go:31; main.go:38, 224-225.
- V6.2.3. Control: changing a lock password needs the current one. Code or doc: locks.go:249-258.
- V6.2.4, V6.2.11, V6.2.12. Control: common list, context words, breached filter. Code or doc: passwords.go; breached.go.
- V6.3.1. Control: brute force limits. Code or doc: guard.go:96-115; server.go:486-554.
- V6.3.3. Control: second factor available. Code or doc: server.go:498-554; totp.go.
- V6.4.3. Control: forgotten lock password: remove with the app password. Code or doc: locks.go:278-305.
- V7.1.1, V7.3.1, V7.3.2. Control: idle and absolute session limits. Code or doc: server.go:234-290; docs/security.md:65-87.
- V7.2.1 to V7.2.4. Control: random reference tokens, new token at login. Code or doc: auth.go:35-48; server.go:339-355.
- V7.4.3, V7.5.1, V7.5.2. Control: sign out others, re-authentication for tokens, lock removal, sign outs. Code or doc: sessions.go:52-115; tokens.go:175-206.
- V8.2.1 to V8.3.1. Control: token routes, lock view at the server. Code or doc: tokens.go:86-121; locks.go:66-170.
- V11.4.2. Control: bcrypt for stored passwords. Code or doc: auth.go:59-92; passwords.go keyed functions.
- V11.5.1. Control: crypto/rand for every secret. Code or doc: auth.go:35-41, 109-111; shares.go:105-111.
- V12.3.1, V12.3.2. Control: outbound TLS with certificate checks. Code or doc: internal/favicon/guard.go:161-214.
- V13.3.2. Control: files 0600, folders 0700, umask 077, user 1000. Code or doc: modes.go; umask_unix.go; Dockerfile:27.
- V15.1.1, V15.1.2. Control: remediation times, SBOM. Code or doc: SECURITY.md:40-56; build.yml.
- V15.3.2. Control: outbound fetch guard (SSRF). Code or doc: internal/favicon/guard.go.
- V15.3.4. Control: client address from trusted proxies only. Code or doc: guard.go:52-94; server.go:429-476.
- V16.1.1 to V16.5.3. Control: log inventory, metadata, UTC time, injection safe values, generic errors. Code or doc: docs/security.md:175-251; seclog.go; main.go:83-97; server.go:664-666.

S16.3 Findings at merge: 24 in all; open F-60 (no image for the audited commit, store packages at 0.1.10), F-134 (Alpine CA bundle and zoneinfo shipped without their licence notices); accepted F-111; the rest fixed (audit R4 findings.json).

## 17. Known friction and open items (flow test 04.11.2026)

S17.1 Counts at v0.1.11: 119 steps, 107 work, 11 friction, 0 broken, 1 by hand; on 31.10: 96 work, 21 friction, 2 broken (FT 04.11 Counts 2).
S17.2 01.5: no countdown during a wait; the line keeps saying the wait it started with (FT 04.11 01.5).
S17.3 02.2: the app refuses `example.com` without a scheme, while the extension options try https then http (FT 04.11 02.2).
S17.4 02.19: the extension popup and options are always dark (FT 04.11 02.19; extras/extension/ui.css:17).
S17.5 04.13: with More open the folder list has a hidden scroll bar and More stays open after a reload (FT 04.11 04.13; app.css scrollbar-width none).
S17.6 04.15: nothing on the phone says that holding a card selects it (FT 04.11 04.15).
S17.7 05.8: the lock note overlaps the second field by 6 px (FT 04.11 05.8). 0.1.12: S23.10.
S17.8 08.3: a wrong code empties both fields (FT 04.11 08.3; pages.go:89-109).
S17.9 08.8: Signed in rows of one browser kind read the same, day only (FT 04.11 08.8; sheets.js:231-238).
S17.10 08.11: a browser signed out elsewhere keeps showing data until its window gets focus or it sends a request (FT 04.11 08.11).
S17.11 09.4: the token form is gone after Create; a second token needs the sheet reopened (FT 04.11 09.4).
S17.12 11.3: 0.1.10 cannot name the copy when it refuses an upgraded database (FT 04.11 11.3).
S17.13 02.20: the right click menu was not run (headless) (FT 04.11 02.20).
S17.14 Found on the way: the axe 2.5.3 finding (S15.11); at 360 px the Add sheet cuts the Folder row to a sliver; the phone unreachable state has no head with the gear; the 404 is plain text; How to save "Show the Save code" is a 136 by 19 px target; text below 12 px in places; the binary listens on every address outside Docker (FT 04.11 Found on the way 2 to 6). 0.1.12: S23.11, S23.6, S23.7, S23.8, S23.5, S23.9; the listen address is not changed.
S17.15 Not run on 04.11: Firefox and Safari for the extension, the permission prompt, the phone long press (covered by the UI test), a reverse proxy with HTTPS, Tailscale and Private Relay, icons (ICONS=off), Docker and setup.sh (FT 04.11 Left out).
S17.16 Open process items of 04.11: spec, store terms, REUSE, Storybook with tokens and a soundness review start after the current runs; nothing in the repo is pushed until aligned (decision log). On the branch, the tokens with Storybook (9911272) and the upgrade tests (5454d4f) are merged (22fc1d5, S23.18).
S17.17 F-137 leftover (re-check 04.11 point 1): an SVG icon with more than eight pictures written with character references in style `url()` is stored, dropped at the next start and fetched again at every start. Low, user impact none. 0.1.12: S23.21.

## 18. Decisions log

- 2026-10-13 to 14. Decision: Built from competitors and three directions; the name Tiles replaced by Pinned. Source: release log.
- 2026-10-18. Decision: 0.1.0 public, repo pinned-cc/pinned, AGPL-3.0, image amd64 and arm64. Source: release log; CHANGELOG.md:208.
- 2026-10-18. Decision: 0.1.1: the iPhone and Mac Shortcut removed; newer schema refused. Source: CHANGELOG.md:196, 206; release log.
- 2026-10-22. Decision: 0.1.2 to 0.1.5 released (palette actions, How to save naming, calmer save, VPN retry). Source: CHANGELOG.md:143-186; release log.
- 2026-10-23. Decision: 0.1.6 Recently saved; 0.1.7 What's new and How to save steps; 0.1.8 lighter How to save. Source: CHANGELOG.md:117-141; release log.
- 2026-10-23. Decision: Umbrel PR 6243 submitted; store order Umbrel first. Source: release log.
- 2026-10-24. Decision: 0.1.9 light mode with the bulb. Source: CHANGELOG.md:104-115; release log.
- 2026-10-28. Decision: 0.1.10 calm selected tab in light mode. Source: CHANGELOG.md:98-102; release log.
- 2026-10-31. Decision: Password rules only, no generator ("Everyone shall use their own tools"): lock minimum 8, about 10000 common passwords blocked offline, hash before bcrypt. Source: release log.
- 2026-11-02. Decision: pinned.cc local draft approved; it goes live the day of the 0.1.11 tag. Source: decision log.
- 2026-11-02. Decision: Firefox taken out, then the same day Firefox back in and tested before 0.1.11. Source: decision log.
- 2026-11-03. Decision: Fix all 7 open findings of release audit 3 so a passing audit can claim ASVS Level 2. Source: decision log.
- 2026-11-03. Decision: The VM test runs from a script the test machine fetches from the build machine. Source: decision log.
- 2026-11-03. Decision: Run release audit 4; if the gate opens, tag, release and deploy pinned.cc the same day. Source: decision log.
- 2026-11-03. Decision: V5.4.3 accepted as the one exception to ASVS 5.0.0 Level 2. Source: decision log; audit R4 F-111.
- 2026-11-03. Decision: 0.1.11 released; the tag moved from 6ab1d8d to 44007be. Source: decision log; release log; CHANGELOG.md:5.
- 2026-11-03. Decision: Ten widths and the releases page belong to the website work; the app's screens take the ten widths. Source: decision log.
- 2026-11-04. Decision: Spec, store terms, REUSE, Storybook and the soundness review start after the current runs; nothing pushed until aligned. Source: decision log.
- 2026-11-04. Decision: the scope of 0.1.12 is the items of section 23 and nothing else; spec first, then an independent review, then the build; the app's look stays as it is. Source: the 0.1.12 brief.

S18.1 Undated design choices recorded in the docs: HSTS off by default because it covers every port of a host name (README.md:202; server.go:33-37); session defaults of 90 and 365 days longer than NIST AAL1 on purpose, with the reasons (docs/security.md:78-87).

## 19. Disagreements

Code and docs, or docs and docs, that do not agree at v0.1.11. 0.1.12 settles each one: S19.1 to S19.17 in S23.14, S19.18 in S23.13, S19.19 in S23.15.

S19.1 Going back. README.md:269 says "An older version does not start on a database a newer one has upgraded." v0.1.0 has no newer schema check and opens such a database (`git show v0.1.0:internal/store/store.go` lines 133-165); the check came in 0.1.1 (CHANGELOG.md:196).
S19.2 Header cap. docs/security.md:14 says request headers are capped at "1 MB, Go's default". The code sets 64 KB (cmd/pinned/main.go:402-416).
S19.3 SVG storage. docs/data-format.md:155 says "an SVG is kept as it is, only when it passes the check". The code stores a new SVG written from the checked tree (internal/favicon/image.go:86-107), as docs/security.md:107 and CHANGELOG.md:37 say.
S19.4 Embedded pictures in SVG. docs/security.md:107 says `href` may point to an embedded PNG, JPEG, GIF or WebP image and that an embedded PNG or JPEG is stored as a new PNG. The check accepts WebP data (internal/favicon/svg.go:257) but the rewrite refuses WebP and drops that element, and GIF is also re-encoded (svg.go:643-695). Source: the extraction of svg.go; worth a direct read in review.
S19.5 Folders table. docs/data-format.md:24-34 lists no `hide_recent` column; it exists since migration 6 (store.go:167) and is in the API (api.go:63).
S19.6 Settings values. docs/data-format.md:64 says `value` is JSON. `password_hash` holds a bcrypt string (sessions.go:139-140) and `icon_failures_version` the plain version text (icons.go:77-78), neither of them JSON. (`icons_reencoded` holds `true`, which is valid JSON.)
S19.7 Flows text. design/wireframes/flows/flows.md describes ad2cb8e (flows.md:3). At v0.1.11 these steps read or behave differently: 01.2, 01.5, 02.2, 02.3, 02.11, 02.13, 03.11, 04.4, 04.7, 04.13, 05.1, 05.2 (says fewer than 4 characters; the code needs 8, locks.go:25), 05.6, 06.4, 07.2, 07.7, 08.3, 08.4, 08.5, 09.4, 11.3, 12.1, 12.2, 12.3 (FT 04.11 per step and Counts 7).
S19.8 Extension message. CHANGELOG.md:25 says an address with another scheme is refused "with the message to enter an address starting with http or https". options.js:17 says "Enter an address, such as 10.0.0.5:9095 or https://bookmarks.example.com." (FT 04.11 Found on the way 1).
S19.9 Touch targets. CHANGELOG.md:32 says the card buttons are at least 44 px. On a mouse desktop they are 28 px; 44 px only for coarse pointers from 720 px (app.css:342, 1458).
S19.10 Refetch icon. CHANGELOG.md:24 names "Refetch icon" among the user's actions. There is no control for it in web/; only the API route (server.go:206), which README.md:269 names. (Review 04.11 said no user doc names it; checked again at the build: README.md:269 ends with `POST /api/bookmarks/{id}/refetch-icon`, so this line stands.)
S19.11 Token answers. README.md:176 says everything else answers 403 with a token. A token PATCH with a field other than title and folder_id answers 400 "a token can change only title and folder_id" (api.go:294-296).
S19.12 Home screen on iPhone. README.md:138 says the app can be added to the home screen on the iPhone. The iPhone panel of How to save (web/bookmarklet.html:29-92) has no such step; its only "Add to Home Screen" is a row in the drawn iOS share menu (bookmarklet.html:40). The only home screen step is on the Android tab (bookmarklet.html:118).
S19.13 Bookmarklet window (weak). CHANGELOG.md:171 (0.1.2) says the save window is 392 by about 530. The code opens it at 392 by 544 (web/js/app.js:93) and the save page then fits the window to the panel's height (app.js:64-72), so the fitted height can be the "about 530".
S19.14 Umbrel draft README. umbrel/README.md:3 calls the files a draft "not used by anything in this repository", :9 a `sha256:PLACEHOLDER`, :21 a BASE_URL, :24 "Not tested on an Umbrel yet". At the tag the compose has a real digest and no BASE_URL (umbrel/docker-compose.yml:13-28), umbrel-app.yml:47 names PR 6243, and release log records the PR updated.
S19.15 Examples count. extras/examples/README.md:3 says "Six small ways"; the folder holds five example files.
S19.16 Testing log order. docs/testing.md:30 says newest first; the two rows of 2026-11-03 sit at the end (docs/testing.md:46-47).
S19.17 Flow test tag. FT 04.11 line 3 names the tag as 6ab1d8d; the tag is 44007be since 2026-11-03 (decision log). The two differ only in tools/setup.test.sh, so the product tested is the same.
S19.18 "This version" in What's new (moved from S20.9). The release binary carries `v0.1.11`: build.yml:62-66 passes the tag name and Dockerfile:14, 18 build it in as main.version. The app takes `ui.version` from `/health` (web/js/app.js:46). What's new marks "This version" only when `ui.version === r.v` (web/js/sheets.js:182), and `r.v` is `0.1.11` from the CHANGELOG heading. So "This version" never shows on a released image; the app shows "Pinned v0.1.11" (render.js:193, 312, 318). The image tags use `0.1.11` without the "v", and the icon failure reset compares the same `v0.1.11` string (main.go:339; store/icons.go:64-81).
S19.19 Dead code against the server. The save sheet's "Already saved" branch for a locked duplicate (web/js/sheets.js:334, 365) and the extension popup's `locked` handling (extras/extension/popup.js:153, 163) wait for answers the server never sends (S20.1, S20.2). README.md:163 and 285 describe what does happen: a second bookmark outside the locked folder.

## 20. Unclear, and what the review settled

Each item says whether the code settles it. Settled items stay listed so their ids hold.

S20.1 Settled: the `"locked": true` answer (locks.go:191-207) cannot happen. 0.1.12 removes it (S23.15). Every duplicate lookup goes through `liveByKey` with the hidden set of the same lock view (internal/store/bookmarks.go:117-137, 265, 359, 452), and `handleDuplicate` checks against that same view, so the branch at locks.go:202-204 never runs. The save sheet's handling of it is dead code (S19.19).
S20.2 Settled: dead code. `/api/check` answers only `duplicate` and `icon` (api.go:196); `/api/folders` gives id, parent_id, name and position and already leaves hidden folders out (tokens.go:226-237). So extras/extension/popup.js:153 and 163 never take effect (S19.19). 0.1.12 removes them (S23.15).
S20.3 Partly settled: `/icons/` is behind requirePage; without a session cookie it answers 303 to `/login`, the image fails and the popup shows the letter (server.go:175, 328-337; popup.js:35). With a token alone the letter always shows. Whether a browser sends its Pinned session cookie on an image load from an extension page depends on its SameSite handling, which the code cannot settle.
S20.4 Partly settled by reading v0.1.0, not run. 0.1.0 opens a schema 12 database and runs no migration (S4.10). 0.1.11 deleted `password_hmac` (internal/store/sessions.go:136-137), which is the key 0.1.0 reads (`git show v0.1.0:internal/store/sessions.go` line 48), so 0.1.0 treats the start as a first start, stores a new record and keeps every session and token. Its inserts still work, as the new columns have defaults or allow NULL (store.go:184-190). Lock and share hashes in the `k1:` form fail its plain bcrypt compare (`git show v0.1.0:internal/server/locks.go` line 300), so those folders and shares do not open. Going forward to 0.1.11 again ends the sessions 0.1.0 made, since their created_at is 0 (server.go:238-241).
S20.5 Settled: theme.js runs in the head of all five pages and sets #0f0f11 in dark and #f4f1ea in light before first paint (theme.js:8); the static #0a0a0b in the HTML shows only without script (index.html:7). The manifest's #0a0a0b (pages.go:169-170) is what an installed home screen app uses. So the browser tab and the installed app differ; which colour is meant is not written down.
S20.6 Settled: the verifier's F-150, F-151 and F-160 were renumbered F-135 to F-137 at merge. F-137's `verified` field says it was fixed after verification at 895474a and not re-checked by the verifier, so "open" in the summary is the state before the fix (audit R4 findings.json F-137).
S20.7 As a fact: the extension manifest says 1.0.0 at v0.1.0, v0.1.10 and v0.1.11 (`git show vX:extras/extension/manifest.json` line 5), although extension files changed in 0.1.11. The zip is packed at image build and served by the same binary, so every server hands out its own build (Dockerfile:16; tokens.go:241-259). Nothing reads the version. How it should relate to the app version is not written down.
S20.8 Settled as real: tokens.go:44 accepts `safari-web-extension://` and README.md:180 speaks of Safari, but there is no Safari package or Xcode project, and extras/extension/README.md:3 names only Brave, Chrome, Edge and Firefox.
S20.9 Moved to S19.18.
S20.10 As far as code goes: no catch all page route exists (server.go:159-230). An unknown page gets Go's plain text "404 page not found" with the app's security headers (server.go:147-148), and a wrong method on a known path Go's plain text 405; the only test accepts either (server_test.go:263). No document promises a styled page. 0.1.12 adds one (S23.8).

## 21. API contract

All bodies are JSON unless said otherwise; JSON bodies are at most 1 MB (S7.9). "204" means no body. Errors are `{"error": "<text>"}` (server.go:642-644).

### 21a. Shapes

S21.1 Bookmark: id, folder_id, title, url, host, position, pinned, pinned_position, icon (`/icons/<file>` or null), tile, letter, created_at, updated_at, opened_at, deleted_at (api.go:18-52).
S21.2 Folder in `/api/state`: id, parent_id, name, position, share (or null), locked, unlocked, hide_recent (api.go:54-68, 142-155).
S21.3 Share: token, url (`<base>/s/#<token>`), has_password, expires_at, opens, last_opened_at (shares.go:89-103).
S21.4 Token in a list: id, name, created_at, last_used_at; the token value only in the create answer (tokens.go:154-173, 205).
S21.5 Session: id, browser, created_at, used_at, current (sessions.go:15-21).
S21.6 Folder in `/api/folders`: id, parent_id, name, position (tokens.go:226-237).
S21.7 Times are Unix seconds (docs/data-format.md:22).

### 21b. Per route

- POST /login (form). Request: form fields password, code, next (64 KB). Success: 303 to next. Errors: 303 to `/login?error=1`, `error=1&wait=N` (that try started the wait) or `error=wait&wait=N` (refused during a wait), with next (pages.go:85-118).
- POST /api/login. Request: password, code. Success: 204 and the cookies. Errors: 401 "Wrong password" or "Wrong password or code"; 429 (api.go:77-96; server.go:556-562).
- POST /api/logout. Request: none. Success: 204 (api.go:104-108).
- GET /api/state. Request: none. Success: 200: folders, bookmarks, settings {last_folder, recent_folders}, version, password_easy (api.go:174-183).
- GET /api/check?url=. Request: url. Success: 200: duplicate (bookmark or null), icon ({icon, tile} or null) (api.go:190-212). Errors: 400 for an invalid url.
- POST /api/bookmarks. Request: title, url, folder_id, force. Success: 201 new bookmark; 200 when force updated one (api.go:216-250). Errors: 409 {"error":"Already saved","duplicate":bookmark}; 400 "url must start with http:// or https:// and have a host", "url is longer than 8192 bytes", "folder does not exist"; 404 for a folder hidden by a lock.
- PATCH /api/bookmarks/{id}. Request: any of title, url, folder_id, pinned; a token only title and folder_id (api.go:291-314). Success: 200 bookmark. Errors: 400 "a token can change only title and folder_id", "invalid <field>", "title cannot be empty"; 404; 409 duplicate.
- POST /api/bookmarks/bulk. Request: ids, action (move, trash, restore, pin, unpin, delete), folder_id (api.go:436-466). Success: 204. Errors: 400 "unknown action"; 404 when one id is hidden.
- PUT /api/bookmarks/order. Request: folder_id, ids. Success: 204. Errors: 404 for a hidden folder (api.go:468-481).
- PUT /api/pinned/order. Request: ids. Success: 204. Errors: 404 when one id is hidden (api.go:483-494).
- POST /api/bookmarks/{id}/open, /restore, /refetch-icon. Request: none. Success: 204 (api.go:343-381). Errors: 404; restore 409 duplicate.
- DELETE /api/bookmarks/{id}[?permanent=1]. Request: none. Success: 204 (api.go:383-393). Errors: 404.
- DELETE /api/trash. Request: none. Success: 204 (api.go:409-434).
- GET /api/folders. Request: none. Success: 200 list (S21.6).
- POST /api/folders. Request: name, parent_id. Success: 201 folder (api.go:535-556). Errors: 400 "name cannot be empty", "folders can nest at most 32 deep", "folder does not exist" for a missing parent (locks.go:163-164); 404 for a parent hidden by a lock.
- PATCH /api/folders/{id}. Request: any of name, parent_id, hide_recent; a null name means no change (api.go:558-618). Success: 200 folder. Errors: 400 "invalid name", "invalid parent_id", "invalid hide_recent", "name cannot be empty", "folder does not exist", "a folder cannot move into itself or one of its subfolders", "folders can nest at most 32 deep" (internal/store/folders.go:210, 223, 230, 241); 404 while locked.
- DELETE /api/folders/{id}. Request: none. Success: 204 (api.go:620-637). Errors: 404; 409 "this folder holds a locked folder; unlock it first".
- PUT /api/folders/order. Request: parent_id, ids. Success: 204. Errors: 404 for a hidden parent (api.go:639-652).
- POST /api/folders/{id}/lock. Request: password, current_password when already locked (locks.go:224-227). Success: 204. Errors: 400 "Use at least 8 characters.", "This password is too easy to guess. Choose another one."; 403 "Wrong password"; 429; 404 "not found" for a missing folder, a folder still locked whose password is to change (unlock it first), or a folder under a parent still locked (locks.go:236-239).
- DELETE /api/folders/{id}/lock. Request: app_password (locks.go:284-286). Success: 204. Errors: 403 "Wrong password"; 429; 404 "not found" for a missing folder or one under a parent still locked (locks.go:294-297).
- POST /api/folders/{id}/unlock. Request: password. Success: 204 and the unlock cookie (locks.go:312-359). Errors: 400 "folder is not locked"; 403 "Wrong password"; 429; 404 "not found" for a missing folder or one under a parent still locked (locks.go:331-334).
- POST /api/folders/{id}/relock. Request: none. Success: 204 for any folder that exists, locked or not, hidden or not (locks.go:361-373). Errors: 404 only when the folder does not exist.
- POST /api/folders/{id}/share. Request: password (string or null), expires_days (null or 1 to 3650) (shares.go:122-165). Success: 201 share. Errors: 400 "invalid password", "A share password needs at least 8 characters.", "This password is too easy to guess. Choose another one.", "expires_days must be null or 1 to 3650"; 409 "a locked folder cannot be shared", "this folder is already shared"; 404.
- PATCH /api/shares/{token}. Request: password, expires_days, each optional. Success: 200 share (shares.go:225-240). Errors: as for create; 404.
- DELETE /api/shares/{token}. Request: none. Success: 204 (shares.go:242-247). Errors: 404.
- POST /api/import. Request: multipart field file, 20 MB. Success: 200 {added, skipped, folders} (transfer.go:14-21). Errors: 413 "the file is larger than 20 MB"; 400 "send the bookmark file as multipart field \"file\"", "not a bookmark file", the nesting text; 409 "A folder was deleted or locked during the import. N links came in. Import the file again to add the rest." (api.go:656-704).
- GET /api/export. Request: none. Success: 200 text/html, `Content-Disposition: attachment; filename="bookmarks.html"`, `Last-Modified` (api.go:706-725).
- GET /api/tokens. Request: none. Success: 200 list.
- POST /api/tokens. Request: name, password. Success: 201 {id, name, token, created_at}. Errors: 400 "name cannot be empty"; 403 "Wrong password"; 429 (tokens.go:175-206).
- DELETE /api/tokens/{id}. Request: none. Success: 204. Errors: 404.
- GET /api/sessions. Request: none. Success: 200 list of live sessions.
- DELETE /api/sessions/{id}. Request: password, unless it is this browser's own session. Success: 204 (sessions.go:52-71). Errors: 403 "Wrong password"; 429; 404.
- DELETE /api/sessions. Request: password. Success: 200 {"ended": N} (sessions.go:73-91). Errors: 401 "not logged in"; 403; 429.
- GET /health. Request: none. Success: 200 {"ok":true}, plus version with a session; `no-store` (pages.go:185-199). Errors: 503 {"ok":false}.

### 21c. Common errors

S21.8 401 "not logged in" without a session (server.go:321); 401 "invalid token" for a wrong token (tokens.go:114); 403 "not allowed with a token" (tokens.go:119); 403 "missing X-Requested-With: fetch header" (server.go:303); 403 "origin not allowed" on a preflight (tokens.go:76); 400 "invalid JSON body" (server.go:674); 404 "not found" and "no such endpoint" (server.go:228, 653); 429 "Too many tries. Wait <time>, then try again." with Retry-After (guard.go:178-182); 500 "something went wrong" (server.go:666).
S21.9 Store errors answer 400 with their own text: "url must start with http:// or https:// and have a host", "url is longer than 8192 bytes", "folder does not exist", "a folder cannot move into itself or one of its subfolders", "name cannot be empty", "title cannot be empty", "unknown action", "folders can nest at most 32 deep" (store.go:18-28; urlkey.go:14, 27; server.go:654-661).
S21.10 Headers: `Cache-Control: no-store` on `/api/*` (server.go:315); `Vary: Accept-Encoding` on `/api/state` (server.go:590); `Vary: Origin` on token requests and preflights, and a preflight answers 204 (tokens.go:64, 83); pages are sent with `{{BASE_URL}}` (HTML escaped) and `{{CODE_HIDDEN}}` filled and `Cache-Control: no-cache` (pages.go:31-55).

### 21d. Share visitor answers

S21.11 The token comes from the path (`/s/{token}/...`) or the `X-Share-Token` header (`/s/-/...`) (shares.go:40-45).
S21.12 `GET .../data` for a share with a password not yet given: 200 `{"locked": true, "folder": {"name": ...}}` (shares.go:375-385).
S21.13 `GET .../data` when open: 200 `{"folder": {"name"}, "folders": [id, parent_id, name, position], "bookmarks": [id, folder_id, title, url, host, icon, tile, letter, created_at]}`; locked subfolders are left out (shares.go:355-365, 386-446).
S21.14 `POST .../unlock` with `{"password"}`: 204 and the share cookie; a wrong password 401 "Wrong password" (a wrong lock password is 403); 429 during a wait (shares.go:321-353).
S21.15 A revoked or expired share answers 404 "This link is no longer available." on data and unlock, and the old path page answers the HTML page of S5.10 (shares.go:257-292, 324-327, 370-373).
S21.16 Data and unlock answers carry `Cache-Control: no-store` (shares.go:323, 369); icons only for a live visible bookmark in the shared subtree (shares.go:448-481).
S21.17 For a session, unknown keys in a bookmark PATCH are ignored, not refused (api.go:299-310).
S21.18 Every JSON answer is sent as `application/json; charset=utf-8`; a gzipped `/api/state` drops Content-Length (server.go:579-583, 595-598).
S21.19 The share icon routes and `/extras/{file}` answer 404 in plain text, not JSON (shares.go:452-460; tokens.go:244-252).
S21.20 Toasts and announcements after API calls: "Moved to Trash" or "N moved to Trash" with Undo, which restores them (actions.js:30); "Copied", "N links copied", "Could not copy the link.", "Could not copy the links." (actions.js:24, 50); "That did not work. Try again." when a call fails without a login problem (actions.js:28; state.js:169).
S21.21 More messages: "Could not copy the token." (sheets.js:219), "Sharing stopped" (sheets.js:137), "Lock removed" (sheets.js:104), "Token revoked" (sheets.js:221), "Hidden from Recent" and "Shown in Recent" (actions.js:123), "Could not load the releases." (sheets.js:167); after Relock now "Folder locked" is announced (actions.js:125).
S21.22 Opening a link from the app posts `/api/bookmarks/{id}/open` with keepalive, so the call survives the page going away (actions.js:17-18, 187, 195).

## 22. Front end behaviour

S22.1 Browser storage: localStorage `pinned.sort`, `pinned.fsort`, `pinned.layout`, `pinned.foot` (through a helper that adds the `pinned.` prefix, util.js:58-62; state.js:74; actions.js:215) and `pinned-theme` (theme.js:4, 17); sessionStorage `pinned.pile` (home.js:38). `pinned.foot` is why More stays open after a reload (S17.5).
S22.2 Phone start screen: Dashboard, Inbox and Folders tabs with counts and a sliding indicator (render.js:283-288, 383-391; phone.js:4); a bottom bar with the search pill and Add that rides above the keyboard (render.js:248-256; phone.js:6-12).
S22.3 `/#tokens` opens the API tokens sheet; How to save links to it (app.js:42-43; bookmarklet.html:142). `/#q=<text>` opens the palette with that text (app.js:40-44).
S22.4 The state is fetched again when the window gets focus and when the tab becomes visible, at most once per 1.5 s (app.js:47-48); this is how a browser signed out elsewhere finds out (S17.10).
S22.5 The version comes from `/health` and shows in the sidebar foot and in Settings (app.js:46; render.js:193, 312); see S19.18.
S22.6 Save page window: it fits itself to the panel when it is 720 px wide or less and was opened by script (app.js:64-72); when it cannot close it shows Saved with Done, or goes to `/` when nothing was saved (sheets.js:380-383); it also takes a URL out of Android `text` (app.js:52-58).
S22.7 Login with TOTP on: Enter in the password field with an empty code moves to the code field; the button is disabled after submit (app.js:86).
S22.8 The desktop search field opens the palette on focus, click or typing (palette.js:194-198); Down arrow moves to the cards (keys.js:53). On the phone the back gesture and a swipe down close the palette (palette.js:45, 199-204).
S22.9 Drag and drop: cards drop on a folder, the Inbox or Trash (drag.js:31, 43, 114-122); folders dropped on Trash ask first (drag.js:120). A reorder of cards or on the Folders screen toasts "Order saved" and switches the sort to Your order (drag.js:132-134); a reorder in the sidebar tree toasts but keeps its sort (drag.js:135); the pinned dock saves with no toast (drag.js:136). A card held over the phone Folders tab opens it after 450 ms (drag.js:33-41).
S22.10 Selection works like the Finder: Cmd or Ctrl click toggles, Shift click or Shift arrows take a range (select.js:68-77; actions.js:175-178); a finger tap on empty space ends selecting (select.js:108-117).
S22.11 The selection bar's More holds Pin or Unpin for several cards, and Open, Rename and Pin for one (menu.js:46-53). A bulk folder delete toasts "Unlock the folders inside first" when it meets a locked subfolder (actions.js:79, 82-89).
S22.12 Locked folders: opening one shows the Unlock dialog (actions.js:152); when an unlock runs out the view goes back to the Dashboard with "Folder locked again" (state.js:162); a folder with a lock shows a "Lock now" button instead of Share beside its title (render.js:299-302).
S22.13 Menus move with arrows, Home, End and type ahead; Tab closes them (menu.js:20-27; palette.js:148-159).
S22.14 An empty folder shows "Nothing here yet." with Add bookmark and Add existing (render.js:555-557).
S22.15 `window.Pinned` (render, load, ui, data, layers and a kit of builders) is set on every app page for the style guide (app.js:117-121); it ships with the app.
S22.16 A click on the bookmarklet button instead of a drag toasts "Drag this button to the bookmarks bar." (app.js:94-95).
S22.17 When the layout switches between phone and desktop an open search moves with it, and widening on Settings lands on the Dashboard with More open (render.js:520-527).
S22.18 In Trash the card title is a button that offers Restore and Delete now (render.js:140); Delete on the keyboard asks first (keys.js:69).
S22.19 Share page: `/` focuses the search and Escape clears it; for the `/s/#<token>` form a hash change reloads the page, not for the path form (share.js:101-104); icons are fetched with the token header and shown from blob URLs when they come within 200 px of the screen (share.js:13-21).
S22.20 A broken icon image falls back to the letter on a blank tile (util.js:104-107; share.js:15).
S22.21 In the desktop search field, Enter after Escape opens the palette again (keys.js:54).
S22.22 How to save: Left and Right arrows move between the device tabs; the first tab is picked by user agent (app.js:104-115).
S22.23 Extension popup: Escape closes it; Enter runs the button of a setup notice (extras/extension/popup.js:8, 21).
S22.24 Inbox picture: the "All sorted" pile settles into place once per browser session (`pinned.pile`), only when motion is allowed (home.js:34-41).
S22.25 Save sheet: the URL field is a textarea that grows with its text (sheets.js:76, 320).
S22.26 Folders screen: Shift click and Cmd or Ctrl click pick folders while selecting (actions.js:174-178).

## 23. Changes in 0.1.12

This section is the whole of 0.1.12. Nothing outside it goes in. Every item names what changes, why (the finding or file), every case it touches, the test that proves it, and the exact user facing words before and after. Items whose words or look the maintainer has to approve before the build carry "WORDING: needs his OK".

Sources for this section, besides the code at 74e3037: FT 04.11 and widths 04.11 (S6.2, S17), the re-check of three audit points of 04.11 ("re-check 04.11"), the fuzz run of 04.11 ("fuzz 04.11"), and the independent soundness review of this section of 04.11 ("review 04.11"). Where review 04.11 found an item SOUND WITH CHANGES or UNSOUND, its change is written into the item below and wins over the first draft.

### 23.0 Rules for every item

S23.0.1 The look stays. The app's look is approved as it is. A fix changes the named defect and nothing else: no new colours, sizes, spacing or motion beyond what the item states. Where a value is needed, an existing token or an existing rule is reused, and the item names it.

S23.0.2 CSS edits are made in place in web/app.css, on the lines that hold the rule, adding no lines where that can be done, so the `source` lines in design/tokens/*.json keep pointing at the right declarations. Any value that changes is changed in design/tokens/*.json too, which are the source of truth from 0.1.12 on (design/scripts/extract-tokens.mjs:2). `npm run check:tokens` in design/ passes after the build.

S23.0.3 Whole release check, after every item is built: the ten width scan of widths 04.11 (360x780, 390x844, 430x932, 440x956, 768x1024, 900x1200, 1024x768, 1180x820, 1440x900, 1920x1080; the same 26 screens, error-404 now showing the page of S23.8; Chromium and WebKit; light and dark) is run again on the 0.1.12 build and compared with the 0.1.11 screenshots. A difference is allowed only inside the parts an item names. tools/ui-test.mjs passes in Chromium, WebKit and Firefox (Firefox on Linux, docs/testing.md:47), and `go test -race ./...`, `node --test tools/extension.test.mjs` and `sh tools/setup.test.sh` pass, as in CI (.github/workflows/build.yml:15-33).

S23.0.4 No schema change. 0.1.12 adds no migration: it stays at schema 12 (S4.9), and 0.1.11 opens a database 0.1.12 used, as it is. The one data change is the key pass of S23.4.7, which rewrites only `url_key` values and writes a copy of the database first, and only on a database that has keys to rewrite.

S23.0.5 The extension. There is one extension build: tools/pack-extension.sh packs extras/extension into one zip for Chromium browsers and Firefox (pack-extension.sh:3), served by each server at `/extras/pinned-extension.zip` (S11.10). There is no store build for the Chrome Web Store, Firefox Add-ons or Safari (S20.8). A server hands out its own build, so a 0.1.12 server serves the 0.1.12 extension; an extension already loaded keeps running until it is loaded again.

### 23.1 Extension: warn before the token goes over plain http to a public host (F-138)

S23.1.1 What changes. In the extension's options (extras/extension/options.js), the warning is decided on the cleaned address, not on the typed text: it applies when `addressCandidates()` gives one candidate, `new URL(candidate).protocol === 'http:'` and `Pinned.localHost(hostname)` is false (extras/extension/shared.js:29-38). This covers `HTTP://` typed in capitals too. Then Test and Save do not send anything on the first click. They show a warning in the status line, with the warn icon (the existing `.status.bad` style, extras/extension/ui.css:140), and go ahead only on a second click of the same button while the cleaned address is still the one warned about. The confirmation is kept as that cleaned candidate in a variable and compared at each click, not with an `input` listener, so the address Save writes back into the field (options.js:63: trailing slash, case) does not count as a change. Once confirmed by a second click of either button, the address is confirmed for both buttons until the cleaned address changes or the options page is opened again. The permission request of Save stays synchronous inside the second click, with no await before it (options.js:41-44): Firefox drops a request made after an await. Nothing changes for an `https://` address, for an address typed without a scheme (S11.8, the probe already refuses the http guess for a public host), or for an `http://` address on the own network (for example `http://10.0.0.5:9095`, `http://localhost:9095`, `http://nas`, `http://[::1]:9095`).

S23.1.2 Why. Release audit 4 finding F-138 (low, user impact possible) and re-check 04.11 point 3: an address typed with `http://` for a public host is used as typed (shared.js:20-26, line 23), probe applies the own network test only to a second candidate (shared.js:48), and api() sends the token in the Authorization header (shared.js:80-86). The options then say "Connected" with the check icon (options.js:32) and "Saved" (options.js:71); every popup open and save sends the token in clear from then on (popup.js:113, 151, 162). The fix decided: show the existing http warning on Test and Save for a non local http address and require a second click.

S23.1.3 Cases.
- Test, first click, public http address: no request at all (no /health, no /api/folders), so the token is not sent; the status shows the warning.
- Test, second click, same address: runs as today and reports "Connected to <address>, N folders." or the error.
- Save, first click, public http address: no permission request, nothing stored; the status shows the warning. The permission request has to start inside a click (options.js:41-44), so it starts on the second click, which is a click too.
- Save, second click: as today: the browser asks for that host, the address and token are stored, "Saved <address>.".
- The address field changed between the clicks: the next click warns again.
- An address saved before 0.1.12 with `http://` for a public host: the popup, the right click save and the options page warn before the token is sent again (S23.1.8).
- Own network and https addresses, and addresses without a scheme: one click, as in 0.1.11.
- An `http://` name on the own network that has a dot now warns: split DNS such as `http://nas.example.home:9095` resolving to 192.168.x, or a Tailscale MagicDNS name such as `http://nas.tailnet.ts.net`, which travels inside WireGuard. Accepted, since one more click goes ahead; it is why the words say "may cross" (S23.1.5). An IPv4 mapped IPv6 address (`http://[::ffff:10.0.0.5]`) warns too; accepted.
- A warning shown by Test does not arm Save, and the other way round: the second click of the same button confirms. Once confirmed, the address is confirmed for both.
- Browsers: the options page is the same file in Chromium browsers (Brave, Chrome, Edge) and in Firefox (S11.11); both run it as a normal extension page. The popup and background scripts do not change.
- Light and dark: the options page is always dark (S17.4); the warning uses the existing `status bad` style (options.js:9-13).
- Phone: the extension does not run on a phone.

S23.1.4 Test. In tools/extension.test.mjs, with the options page stand-in (optionsPage, tools/extension.test.mjs:323) and the fetch stand-in (fakeFetch, :293):
- `http://bookmarks.example.com` and a token: first Test click makes no request and the status reads the Test warning; second click makes the request with `Bearer <token>` and the status reads "Connected to http://bookmarks.example.com, 1 folder.".
- The same with Save: first submit makes no `permissions.request` and stores nothing; second submit requests `http://bookmarks.example.com/*`, stores the address and token, and reads "Saved http://bookmarks.example.com.".
- Confirm on Test, then Save: Save does not warn again. Change the address after the first click: the next click warns.
- `http://10.0.0.5:9095`, `http://127.0.0.1:<port>` and `bookmarks.example.com`: no warning, behaviour as in the existing tests (:111, :303, :342). `https://bookmarks.example.com`: fakeFetch fails every https request (tools/extension.test.mjs:293-301), so the test asserts only that no warning is shown and that one request is made.
- `http://203.0.113.5:9095` warns; `http://[2001:db8::1]` warns; `HTTP://bookmarks.example.com` warns.
- The stand-in optionsPage gets a request counter in `permissions.request`, which the check "no permissions.request on the first Save" needs; it has none today (tools/extension.test.mjs:323-339).
- A Save that writes back a cleaned address (trailing slash added) followed by Test: Test does not warn again.
By hand once in Chromium and in Firefox (temporary add-on): the two clicks, and the browser's access prompt appears only on the second Save.

S23.1.5 Wording. WORDING: needs his OK. The warning reuses the words of the existing probe message, "<https address> did not answer. <http address> does, but on plain http your token would cross the internet unencrypted. Use https, or type <http address> to connect anyway" (shared.js:50, shown with a full stop by options.js:33).
- Test, proposed (review 04.11: "may", since a dotted name on the own network warns too): "On plain http your token may cross the internet unencrypted. Use https, or click Test again to connect anyway."
- Save, proposed: "On plain http your token may cross the internet unencrypted. Use https, or click Save again to save anyway."
- extras/extension/README.md:20, current last sentence: "For any other host it does not send the token over plain http: it says that http answers and that you type `http://` in front to use it anyway." Proposed, added after it: "Typed with `http://` for such a host, Test and Save first say that your token may cross the internet unencrypted, and go ahead when you click again."
- CHANGELOG 0.1.12: see S23.20.

S23.1.6 After an address without a scheme gets the existing message "... or type http://... to connect anyway", typing `http://` and clicking Test asks once more. That is intended: the second click is the confirmation.

S23.1.7 The first draft left the popup and the right click save out of 0.1.12. Release audit 5, F-170 (low, user impact possible), and the fix brief of 04.11: the warning applies whenever the extension would send the token to a public http address, however and whenever it was stored. S23.1.8 does that.

S23.1.8 A stored address (F-170). What changes.
- extras/extension/shared.js: `config()` also reads `plainOK`, the one public http address the user has gone ahead with; `Pinned.plainUnconfirmed(cfg)` is true when `cfg.address` is `http:` for a host `localHost` refuses and `plainOK` is not that address. An address typed with `http://` for the own network, an https address and an address without a stored token are never held.
- extras/extension/options.js: a Save that goes ahead on its second click stores `plainOK` with the address; a Save of any other address stores `plainOK` empty. When the options page opens on a stored address that is held, the status shows the warning at once and Save is armed for that address, so one click on Save confirms it, as the second click does; Test still asks twice.
- extras/extension/popup.js: when the stored address is held, the popup sends nothing (no /api/folders, no /api/check, no save) and shows a notice with two buttons, Continue and Open settings. Continue stores `plainOK` and goes on as today; Open settings opens the options page.
- extras/extension/background.js: the right click save, when the address is held, sends nothing and opens the options page, as it does today without an address or token.
Why: popup.js and background.js read the stored config and send the token with no check (F-170: popup.js:113, 151, 162; background.js:38-42). A 0.1.11 user who saved `http://<public host>` kept sending the token in clear at every popup open and save.
Cases.
- A setting stored by 0.1.11, `{address: "http://bookmarks.example.com", token}` with no `plainOK`: the popup shows the notice and sends nothing; the right click save opens the options page and sends nothing; the options page shows the warning; Continue in the popup or Save in the options then goes ahead, and from then on the popup and the right click save work as before.
- Stored by 0.1.12 after the two clicks: `plainOK` is set, nothing more is asked.
- The address changed in the options (Save of another address): `plainOK` is cleared; a later return to the public http address asks again.
- Own network (`http://10.0.0.5:9095`, `http://nas`), https, no address: unchanged.
- Chromium and Firefox: the same files. Phone: no extension.
WORDING: needs his OK.
- Popup notice, title: "Plain http to <host>" (the host and port of the address); text: "On plain http your token may cross the internet unencrypted. Use https, or click Continue to connect anyway."; buttons "Continue" and "Open settings".
- Options page, opened on a held address: "On plain http your token may cross the internet unencrypted. Use https, or click Save to keep using this address."
Test. tools/extension.test.mjs, with a setting stored the 0.1.11 way: the popup makes no request and shows the notice; Continue stores `plainOK` and then the popup asks for /api/folders with the token; the right click save makes no request and opens the options page, and with `plainOK` set it posts as before; the options page shows the open warning, one Save click stores the address with `plainOK`, a Save of an own network address clears it. Own network and https settings: the popup asks for /api/folders at once. These fail before the change.

### 23.2 Audit record: the V3.5.1 evidence names the routes outside csrf() (no code)

S23.2.1 What changes. The checklist of release audit 4 (outside the repository) gives for ASVS V3.5.1 the evidence "csrf() internal/server/server.go:295-308: a non GET or HEAD request needs X-Requested-With: fetch". It is corrected to say that `POST /login` (server.go:164) and the two share unlock routes `POST /s/-/unlock` and `POST /s/{token}/unlock` (server.go:186, 190) are outside csrf() by design: a plain HTML form cannot send the header, a forged form login with the one account only makes the owner's own session, and the unlock routes set only a share cookie and need the share password. The pass stays a pass. F-138 is marked fixed by S23.1. The same record also states:
- The re-check of F-137 (re-check 04.11 point 1): fixed in 0.1.11 for what the finding claims (embedded pictures are counted as they are decoded, internal/favicon/svg.go:541-542, 653), with a test that fails without the fix (TestSVGEmbeddedPicturesBounded, internal/favicon/svg_test.go:350, fails on 72325b9 and passes at v0.1.11). The leftover outside the finding's claim, pictures in a style `url()` refetched at every start, is fixed in 0.1.12 by S23.21.
- The optional hardening of re-check 04.11 point 2, refusing `POST /login` when `Sec-Fetch-Site` is cross-site or an `Origin` header names another site: not taken in 0.1.12, and recorded as not applicable. Login CSRF means logging the victim into the attacker's account so the victim's data lands there; Pinned has one account and one password (README.md:3), so a forged login can only make the owner's own session, and only with the password. Cross site guessing through the owner's browser stays under the login limiter, and the answer cannot be read (frame-ancestors 'none', X-Frame-Options DENY, Referrer-Policy no-referrer, guard.go:205, 215). No ASVS 5.0.0 Level 2 requirement asks for more (V3.5.1, V3.3.2, V7.2.4, V7.6.2, re-check 04.11 point 2).

S23.2.2 Why. Re-check 04.11 point 2: not a finding, but the evidence overstates what csrf() covers. S7.18 and S8.50 already state the choice in this spec. Review 04.11 Missing 1 and 2: the F-137 re-check and the declined hardening were not recorded.

S23.2.3 Cases and test: none in the product. The audit of 0.1.12 checks the corrected text against server.go.

### 23.3 Image provenance without the pusher's account, and a signed provenance on the release

S23.3.1 What changes, in .github/workflows/build.yml.
- The image job: `provenance: mode=max` (build.yml:80) becomes `provenance: mode=min`, and the setup-buildx-action step (build.yml:44) gets `with: driver-opts: provenance-add-gha=false`. `sbom: true` (build.yml:79) stays. The comment at build.yml:77-78 stays true as written. The build step gets `id: build`, and the job gets `outputs: digest: ${{ steps.build.outputs.digest }}`, the image index digest.
- A new job `release-assets`, only on a release tag (`if: startsWith(github.ref, 'refs/tags/v')`, `needs: image`), with its own permissions `contents: write`, `id-token: write` and `attestations: write` (the workflow default stays `contents: read`). It signs a build provenance of the image with actions/attest-build-provenance (subject `ghcr.io/<owner>/pinned` at the image job's digest), reads the SPDX SBOM of linux/amd64 and linux/arm64 from the image's attestation (`docker buildx imagetools inspect ... --format '{{ json (index .SBOM "linux/<arch>").SPDX }}'`), fails if an SBOM has no `spdxVersion`, waits up to 15 minutes for the GitHub release of the tag (the release is made by hand right after the tag), and uploads `sbom-<version>-amd64.spdx.json`, `sbom-<version>-arm64.spdx.json` and `pinned-<version>-provenance.sigstore.json` to it. The job's lines are those of the prepared change build-sbom.diff of 04.11, merged with the mode=min line and the driver option above.
- Every action stays pinned to a full commit, with its tag in a comment. Checked on 04.11 against each upstream repository's tags (`git ls-remote --tags`): actions/checkout 11d5960a = v4.4.0, actions/setup-go 40f1582b = v5.6.0, docker/setup-buildx-action 8d2750c6 = v3.12.0, docker/login-action c94ce9fb = v3.7.0, docker/metadata-action c299e40c = v5.10.0, docker/build-push-action 10e90e36 = v6.19.2, actions/attest-build-provenance 4d101475 = v4.2.2 (it runs actions/attest 508db95d = v4.2.1, pinned by commit in its own action.yml).

S23.3.2 Why. With the GitHub context in the build record, the record attached to the public image carries the whole push event, among it `pusher.email`, the GitHub account email of whoever pushed the commit or tag (review 04.11 read it in the published provenance of 0.1.11: attestation sha256:1883d9a2, `predicate.buildDefinition.internalParameters.github_event_payload`). mode=min alone does not take it out, contrary to the first draft of this item: docker buildx writes the push event into the builder as `provenance.d/github_actions_context.json` (docker/buildx driver/docker-container/driver.go:177-185, util/ghutil/ghutil.go: `github_event_payload`, `github_actor`, `github_triggering_actor` and more) whenever it runs in GitHub Actions, and BuildKit copies that into `internalParameters` in both modes, after the mode switch (moby/buildkit solver/llbsolver/provenance.go: `pr.BuildDefinition.InternalParameters.ProvenanceCustomEnv = customEnv`). The driver option `provenance-add-gha=false` (buildx v0.30.0 on, commit 7652057da; docs.docker.com, docker-container driver) stops buildx writing it. An older buildx refuses an unknown driver option ("invalid driver option", driver/docker-container/factory.go:126), so the job fails instead of publishing the payload. mode=min also leaves the build arguments and labels out of the record (scrubMinRequest), and keeps `vcs:source` and `vcs:revision`, the repository and the commit (docker/buildx build/git.go:104, 113). Read from the sources on 04.11.

The signed provenance names no person either. actions/attest-build-provenance v4.2.2 has no predicate of its own: it calls actions/attest v4.2.1, which builds the predicate with `buildSLSAProvenancePredicate` of @actions/attest (actions/attest src/provenance.ts; dist/index.js at 508db95d) from the job's OIDC token: `buildDefinition.buildType`; `externalParameters.workflow` (ref, repository URL, workflow path); `internalParameters.github` (event_name, repository_id, repository_owner_id, runner_environment); `resolvedDependencies` (the repository at the ref, with its commit); `runDetails.builder.id` (the workflow file at its ref) and `runDetails.metadata.invocationId` (the run URL). No email, no account name, no push event. The bundle is signed keyless: its certificate from Sigstore's Fulcio carries the workflow identity (repository, workflow and ref, commit, trigger event, run URL, owner and repository ids, visibility; sigstore/fulcio config/identity/config.yaml, github-workflow), not the account that pushed. For a public repository the signature is also written to the public Rekor log, with the same certificate.

S23.3.3 Cases.
- Every image built from the first push of this change on: release tags (`X.Y.Z`, `X.Y`, `latest`), `main` and `sha-<commit>` (S3.26), for linux/amd64 and linux/arm64.
- The release assets: only on a `v*` tag; `main` and `sha-` builds get no release job.
- No GitHub release made within 15 minutes of the tag: the upload fails and the job shows red; the image is already pushed and unaffected. Running the job again after the release exists uploads the three files (`--clobber`).
- Images already published (0.1.0 to 0.1.11 and earlier `main` and `sha-` images) keep their mode=max record with the push event. Changing them would need a rebuild, which changes the digests that the Umbrel PR 6243 and the ZimaOS PR 1116 pin (S3.21). Not done in 0.1.12. The SBOM and the edited provenance of 0.1.11 prepared on 04.11 (the push event taken out) may be uploaded to the v0.1.11 release by hand; that is a release step outside the repository.
- The cache line `cache-to: type=gha,mode=max` (build.yml:76) is a different setting and stays.
- Checking the signed provenance: `gh attestation verify oci://ghcr.io/pinned-cc/pinned:<version> -R pinned-cc/pinned`, as the comment in the job says. SECURITY.md:49-53 stays true.

S23.3.4 Test. After the push to main that carries the change, and again for the 0.1.12 tag: `docker buildx imagetools inspect ghcr.io/pinned-cc/pinned:main --format '{{ json .Provenance }}'` shows a record for both platforms that holds no `github_event_payload`, no `github_actor` and no `@` email address, and still names the repository and the commit (`vcs:source`, `vcs:revision`); `docker buildx imagetools inspect ghcr.io/pinned-cc/pinned:main --format '{{ json .SBOM }}'` shows an SBOM for both platforms. For the tag: the release carries the three files; `jq -e .spdxVersion` passes on both SBOMs; the predicate inside the `.sigstore.json` bundle (base64 payload of its DSSE envelope) holds no `@` and no `pusher`; `gh attestation verify` passes. The workflow file is read line by line before the push (no test can run it locally).

S23.3.5 Wording: none in the app. CHANGELOG: see S23.20.

### 23.4 One bookmark for an address with a space before its #fragment (fuzz)

S23.4.1 What changes. internal/urlkey/urlkey.go:47-49: after the cut at `#`, the rest is trimmed again with `strings.TrimSpace`, and an ASCII control character (below 0x20, or 0x7f) among the characters that trim takes off makes the address invalid (ErrInvalid), as url.Parse made it in 0.1.11 (urlkey.go:78). So spaces and other Unicode white space (a no break space) before `#` are trimmed, and a tab, CR or LF before `#` stays refused. A fuzz test is added as internal/urlkey/fuzz_test.go, FuzzKey, with its seeds and the failing input kept as internal/urlkey/testdata/fuzz/FuzzKey/c8b34848d449a7e4 (`string("http://0/0 #")`), as in fuzz 04.11. TestKeyEquality (internal/urlkey/urlkey_test.go:9) gets the pairs `http://h/a #top` and `http://h/a`, `http://h/?q=a #x` and `http://h/?q=a`, and `http://h/a\u00a0#x` and `http://h/a`; a new table refuses `http://h/a\t#x`, `http://h/a\n#x`, `http://h/a\r#x` and `http://h/a \t #x`, and, after release audit 5 (V-1), `http://h #x`, `http://h:8080 #x`, `http://h\u00a0#x` and `http://user@h #x`. When white space was trimmed before `#`, the part before it must have a path or a query after the host (a `/` or `?` after `://`), or the address is invalid (ErrInvalid): so white space after a path or query is trimmed from the key, and white space right after the host or port is refused, since it would sit in the host, where url.Parse refuses a space and browsers refuse any white space (a no break space passes url.Parse but not a browser's host parser).

S23.4.2 Why. Key trims spaces from the whole address and then cuts the fragment (urlkey.go:46-49), so the space before `#` stays: `http://h/a #top` gives the key `http://h/a ` and `http://h/a` gives `http://h/a`, two bookmarks for one page. The key of a key is then not the same key (`Key("http://h/a ")` is `http://h/a`). Found by fuzz 04.11; checked again on 74e3037 with the urlkey package alone.

S23.4.3 Cases.
- A space or spaces before `#`: trimmed. The same for a query, `http://h/?q=a #x` gives `http://h/?q=a`, the same key as without the space.
- A tab, CR or LF before `#` (alone or among spaces): refused, as in 0.1.11, where url.Parse refused it (urlkey.go:78). Review 04.11 found that a plain TrimSpace would accept it: the stored `url` would keep the character (bookmarks.go:248 trims only the ends). Refusing keeps 0.1.11's answer (400 with the invalid address message) and keeps FuzzKey green; trimming only ASCII spaces would not, since a no break space then breaks the key of a key.
- A no break space or other Unicode white space before `#`: trimmed. In 0.1.11 it stayed in the key, so the key of the key differed.
- `http://h #x` and `http://h:8080 #x`, white space between host or port and `#`: refused (400 with the invalid address message), as in 0.1.11, where the space was in the host. The first build accepted them with the key `http://h/` and stored the address with the space, which url.Parse and every browser refuse, so no icon was fetched and the card opened nothing (release audit 5, V-1). Every way in uses Key: the API and so the extension and the bookmarklet's save page (the Add sheet also refuses it in the browser, web/js/util.js:75), an edit, and an import, which skips such a link and counts it in "skipped", as 0.1.11 did (transfer.go:233-243).
- A control character elsewhere in the address: unchanged, url.Parse refuses it.
- The stored `url` column keeps the address as saved (S4.13); only the key changes.
- Every place that takes a key: saves, edits, restores, imports, /api/check, icon reuse by origin (S4.19 to S4.30, S9.1, S10.4).
- Bookmarks saved before 0.1.12 whose stored key ends in white space: their key is set again at the first start of 0.1.12 (S23.4.7). Without that, a new save of the same address with the space before `#` would not find them, and a Force save (`force: true`) would make a second bookmark instead of updating the old one (liveByKey with the new key, internal/store/bookmarks.go:117-136, 267-269; code review 04.11, medium). Such addresses come only from typing a space before `#` by hand, or from an import file that has one; browsers write a space in an address as `%20`.
- Going back to 0.1.11: it computes the old key for new saves; keys 0.1.12 stored or set again stay valid addresses for it (S23.4.7).

S23.4.4 Test. `go test ./internal/urlkey` runs FuzzKey over its seeds and the kept input and runs the new TestKeyEquality pairs and the refusal table; FuzzKey's kept input and the space pairs fail without the fix. `go test -run '^$' -fuzz FuzzKey -fuzztime 60s ./internal/urlkey` finds nothing.

S23.4.5 Wording: none in the app. CHANGELOG: see S23.20.

S23.4.7 Keys saved before 0.1.12 (code review 04.11, medium). What changes: internal/store/store.go Open, after the migrations, runs a key pass: it reads `id, url, url_key` of every bookmark, live and in Trash, and where `urlkey.Key(url)` gives a key other than the stored one, sets `url_key` to it. A row whose address Key refuses keeps its key (none can exist: 0.1.11 refused them too). Before it writes, the pass makes a copy of the database the way an upgrade does (backupBeforeMigrate, `bookmarks-schema12-<time>.db`, 0600, the newest KeepBackups kept); when a migration ran in the same start, its copy is already the state before, and no second copy is made. All rows change in one transaction, with `icon_failures.url_key` of the same bookmark moved along when it held the old key, so a link whose icon was given up stays given up. One log line names the count, the copy, and how many of the rows now share their key with another bookmark.

Why this fix and not the others. The schema (S4.13; store.go migrations) has no unique index on `url_key` since migration 12 dropped `bookmarks_live_key`: live bookmarks are unique by key only among those one caller can see, checked in code (liveByKey, oldest row first), because a bookmark in a locked folder may share its key with one outside. So two rows that end up with one key break no constraint, and every reader already handles it: a save, /api/check, a Force save, the extension's check (it calls /api/check) and an import find the oldest live row the caller can see; a restore of a Trash row whose key a live row has stays in Trash with "Already saved"; an edit that keeps the address compares with the row's own key and passes. The pass therefore never deletes, trashes, moves or merges a bookmark: two bookmarks the user had in 0.1.11 for one page (`http://h/b` and `http://h/b #x`) stay two, the older one answers for the address, and the user can trash the other. Keeping the old key on a clash instead would leave that row with a key no address gives, so an edit that resends its own address would answer "Already saved" with the other bookmark. The other fix the review named, liveByKey also trying the old key, would have to keep the 0.1.11 rule in the code for good, at every lookup. No schema bump is needed: the pass writes only values, which 0.1.11 reads as any key (S23.4.3, going back), and a bump would make 0.1.11 refuse a database it reads correctly; 0.1.1 to 0.1.10 refuse schema 12 already (S4.10).

Cases.
- A database with no such keys (every fresh one, and every 0.1.11 database without a space before a `#`): the pass reads, writes nothing, makes no copy and logs nothing.
- One row with a stale key and no other row with the new key: re-keyed; a new save of either spelling is "Already saved".
- A clash, a live row already holding the new key, or two stale rows giving the same key (`http://h/a #x` and `http://h/a\u00a0#x`): all are re-keyed and kept; the oldest answers for the address.
- A row in a locked folder: re-keyed like any other; who sees it is decided by the lock at each lookup, as before.
- A row in Trash: re-keyed; a restore while a live row has the key stays in Trash with "Already saved", as for any Trash row (bookmarks.go:451).
- The copy cannot be written (full disk, read only folder), or the pass fails anywhere else, in its read or in its write after the copy (re-review 04.11, low: a failed write stopped the start): the transaction is rolled back, one log line names the failure, the keys stay as they were, and the app starts; the pass runs again at the next start. An upgrade that cannot copy still refuses to start (S4.11); a key pass is not worth a refusal.
- Idempotent: after the pass every key equals Key(url), so the next start finds nothing; a crash midway leaves the transaction unwritten.
- Going back: 0.1.11 opens the database (still schema 12) and reads the new keys as keys. A save it makes of `http://h/a #top` gets its old key again; the next start of 0.1.12 re-keys that row too, with a new copy.
- Cost: one read of three columns over every bookmark per start; 100000 bookmarks take about 90 ms (measured 04.11 on the development Mac).

Test. internal/store: the 0.1.11 database of S23.22 (real rows written by 0.1.11 with a space and a no break space before `#`, a pair of one page, a Trash row and a row in the locked folder) opens with every key equal to Key(url), one schema 12 copy that holds the old keys, the icon failure count kept, the pair both live with the older one found by FindLive and Create, the Trash row restorable; a second Open writes nothing and no second copy. A store test with rows written straight to a schema 12 database: two stale rows and one current row for one page are all kept with one key; with the copy failing (backupPath into a missing folder) the keys stay as they were and Open succeeds; with the write failing after the copy (a trigger that aborts every change of `url_key`) Open succeeds, every key and row is as before, and the next start without the trigger sets the keys. All of these fail before the pass. By hand once: 0.1.11 started on the database 0.1.12 re-keyed starts, logs in and lists every bookmark.

S23.4.6 Open: the same fuzz diff also holds a second fuzz test, internal/netscape/fuzz_test.go (FuzzParse: what Parse accepts and Write writes, Parse accepts again). It is not named in the agreed scope. It goes in only on the maintainer's word.

### 23.5 How to save: "Show the Save code" gets a 44 px target

S23.5.1 What changes. web/app.css:934, `.hs-code summary{cursor:pointer;width:max-content}`, gets a hit area through `::after`, the way the device tabs on the same page get theirs (widths 04.11, Layout numbers 3): `position:relative` on the summary, and, written from tokens as review 04.11 settled, `.hs-code summary::after{content:"";position:absolute;left:0;right:0;bottom:calc(var(--s-4) * -1);height:var(--tap)}` on the same line. The area ends at the code block's top edge (`--s-4` is the code's own top margin, app.css:935) and reaches 44 px, the value of `--tap` (app.css:157), up from there, whatever the text height (browser minimum font size, zoom). With today's 19 px text box (widths 04.11, Problem 1) that is 17 px above and 8 px below it. The summary's look, its marker and the space around it do not change.

S23.5.2 Why. widths 04.11 Problem 1: on 360 to 440 px the summary "Show the Save code" is a 136 by 19 px target (app.css:934 has no min-height, while `.hs-fix summary` at app.css:959 has `min-height:var(--tap)`). The CHANGELOG of 0.1.11 says the touch targets on How to save are at least 44 px (CHANGELOG.md:32).

S23.5.3 Cases.
- The 8 px below is the gap to the code block when the summary is open (`.hs-code code{margin-top:var(--s-4)}`, app.css:935, 8 px), so the hit area never covers the code; a tap on the code does not close it.
- The 17 px above sit in the summary's own top margin (`.hs-code{margin-top:var(--s-14)}`, 28 px, app.css:933), so nothing above is covered.
- Every width and pointer: the area is invisible, so the desktop look does not change; the target grows on the desktop too.
- Light and dark: nothing drawn.
- Chromium and WebKit: `::after` on a summary works in both (the device tabs on the same page use the same way).

S23.5.4 Test. The ten width scan: at 360, 390, 430 and 440 the summary's target, counted with its `::after`, is at least 44 px high in Chromium and WebKit, light and dark; with the summary open, the point 1 px below the summary's hit area is inside the code block (document.elementFromPoint); with it closed, the point 1 px below the hit area lands on nothing clickable (below the closed details sits the Log out button with `margin-top: var(--s-12)`, app.css:986, web/bookmarklet.html:151-152). The screenshots of How to save match 0.1.11 at every width.

S23.5.5 Wording: none.

### 23.6 Phone: the Add sheet shows the Folder row on a small screen

S23.6.1 What changes. On the phone (below 720 px) every sheet is bound to 60 percent of the visible height (`.sheet{max-height:calc(var(--vvh,100dvh) * .6)}`, app.css:632). The save sheet keeps that bound and may grow past it only as far as the end of the Folder row, and never past the visible height less the top safe area and 12 px. In app.css, in the phone query at app.css:636, on the same line: `.layer:not(.page-sheet) .sheet:has(form[data-save]){max-height:min(max(calc(var(--vvh,100dvh) * .6),var(--sv-need,0px)),calc(var(--vvh,100dvh) - env(safe-area-inset-top) - 12px))}`. `--sv-need` is set on the sheet by web/js/sheets.js fitSave: the sheet's height with its body shown down to the bottom of `.sv-folder`, measured after each draw and again by a ResizeObserver on the form when it changes size (the Already saved line, the picker, the address field). The sheet still takes only the height of its content.

S23.6.2 Why. widths 04.11 Problem 2: at 360 by 780 with an already saved address the Folder row is cut to a sliver of about 7 px. A bound of the visible height for the whole sheet (the first form of this item) also made the sheet taller at 390 to 440 wherever its content was taller than 60 percent, which changes the approved look.

S23.6.3 Cases (measured, 0.1.11 against 0.1.12, Chromium and WebKit the same within 1 px; already saved address, seed of 7 folders):
- Folder row whole at 60 percent: height unchanged (430x932 553 px, 440x956 553 px; the plain Add sheet at 390x844 506 px as in 0.1.11).
- Folder row cut at 60 percent: the sheet grows to the end of the row, no further: 360x780 468 to 550, 360x640 384 to 550, 375x667 400 to 550, 390x844 506 to 550, 390x700 420 to 550.
- Keyboard up (`--vvh` and `--kb` from web/js/phone.js:7): the bound is the visible height; the sheet's top stays on screen (12 px or more) and Save stays in view at every size; where the visible height is too short for the Folder row, the body scrolls as before.
- The /save page (`page-sheet`), the desktop dialog (720 px and up) and every other sheet: not affected.
- Light and dark: no colour change. Chromium and WebKit: both support `:has` and `min()`/`max()`.
LOOK: needs his OK for the sizes where the sheet now grows.

S23.6.4 Test. tools/ui-test.mjs, check S23.6: at 360x780, 390x844 and 440x956 with an already saved address, the Folder row is whole inside the body and the sheet is no taller than the larger of 60 percent and `--sv-need`; with the keyboard stand-in (`--vvh` and `--kb` set to a 336 px keyboard) the sheet's top, Close and Save are in view. The ten width scan: add-sheet heights match 0.1.11 wherever the Folder row was whole.

S23.6.5 Wording: none.

### 23.7 Phone: the head with the Settings gear shows when the server cannot be reached at the first load

S23.7.1 What changes. web/js/render.js phoneRecents (render.js:338-348): the head (`.phead` with "Pinned", the bulb and the Settings gear) is drawn on the tab views whether or not data has loaded. Only the pinned row below it waits for data. Today the function returns nothing until data has loaded (`if (!data.has) return '';`, render.js:339).

S23.7.2 Why. widths 04.11 Problem 7: on the phone, when the server cannot be reached at the first load, only the tabs and the notice are drawn, so there is no way to Settings (Log out, How to save) and no bulb.

S23.7.3 Cases.
- First load unreachable: head, tabs, the notice "Cannot reach your Pinned server." with Retry (S5.20).
- First load while loading: the head now shows above the skeleton cards too, instead of appearing when the data comes. This is the same head in the same place.
- After data has loaded: unchanged.
- Settings opened while nothing has loaded: the Settings screen draws as it does today (render.js:325) and its summary reads "0 bookmarks in 0 folders" (render.js:312), because nothing has loaded. Open: whether that line should wait for data (not in the agreed scope; see the report of this spec).
- Views that are not tabs (a folder, All bookmarks, Trash): they have no head today (render.js:340), unchanged.
- Desktop: the desktop head is drawn by its own code, unchanged.
- Light and dark: the bulb shows its label for the current theme (render.js:340).

S23.7.4 Test. ui-test: at 390x844 and at 320 wide, with the API answering with a network error at the first load (route stub), `#pmain .phead .gear` is visible and opens Settings; the notice shows. widths 04.11 screen error-unreachable at 360 to 440 shows the head in Chromium and WebKit, light and dark.

S23.7.5 Wording: none.

S23.7.6 Implementation note (review 04.11): build `head` first and return it while `!data.has`, before `pinned()` is read; renderPhoneMain keeps `.phead` by signature (render.js:357-365), so the earlier head is reused when the data comes.

### 23.8 A styled page for an address that does not exist

S23.8.1 What changes. A new page, web/404.html, built like web/share.html: the same head (viewport, `theme-color`, `color-scheme`, `robots` noindex, `referrer` no-referrer, favicon, the Geist preload, /static/app.css, /static/js/theme.js) and a body that reuses the share page's broken link state (`<main class="lone"><div class="lone-box"><h2>...</h2></div></main>`, web/share.js:93) with one line of text and a link to `/` in the look of the primary button of the small pages (`<a class="save" href="/">`, `.lone .save`, app.css:896). No new class, colour, size or rule: the page uses app.css as it is. The server registers the method less pattern `"/"` as the last route (review 04.11: `GET /` next to the method less `"/api/"`, server.go:227, makes ServeMux panic at start, "pattern GET / conflicts with pattern /api/"). Its handler answers a GET or HEAD that 0.1.11 answered 404 with web/404.html, status 404, `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-cache`, setting the status itself (page(), pages.go:33-55, writes 200), with no body for HEAD. Everything else answers exactly as 0.1.11 did (code review 04.11, low): the server keeps a second mux with the same routes and no catch all, which is 0.1.11's route table, and the handler hands the request to what that mux gives (ServeMux.Handler with the request as it came, method and path unchanged): on a path another route takes with some method, Go's own 405, `Method Not Allowed` as plain text with an `Allow` header naming those methods; on a path no route takes, Go's own plain text 404, `404 page not found`, since a missing resource is a 404 whatever the method. A GET of a path only POST takes (`GET /s/-/unlock`) keeps its 405 with `Allow: POST`. So only GET and HEAD of a path no route takes change. The first build asked the main mux for each method instead; it lost the 405 of a POST only path, answered 405 where 0.1.11 answered 404, and named other methods for a CONNECT on a path that is not clean. The app's security headers come from ServeHTTP as on every answer (server.go:147-148). It needs no login and shows nothing from the data. If web/404.html cannot be read, the answer is Go's plain "404 page not found", as before.

S23.8.2 Why. widths 04.11 Problem 8 and FT 04.11 Found on the way 3: an unknown page gets Go's plain text "404 page not found" in browser colours in both themes (S5.11, S20.10). For 0.1.12 a styled page is wanted (agreed scope).

S23.8.3 Cases.
- Any GET or HEAD of a path no other route takes, outside `/api/` and `/static/`: the styled page, 404. This includes `/icons` and `/extras` without a file name and `/s/` paths that do not match a share route, such as `/s/x/y`.
- `/api/` paths: unchanged, JSON "no such endpoint" or 401 (S7.15, S8.55); a wrong method on an `/api/` path still reaches the more specific `"/api/"` and answers JSON.
- `/static/` misses: unchanged, the file server's plain 404 (pages.go:271-286); these are assets, not pages.
- `/extras/{file}`, `/icons/{file}` and the share icon routes: unchanged (S21.19, S7.14).
- A wrong method on a known page path (`PUT /login`, `POST /health`): it now reaches the catch all, not Go's own 405. Review 04.11 noted the `Allow` header would be lost; the handler sends it and the body as Go did (`GET, HEAD, POST` for /login, `Method Not Allowed`), so the answer is the same as in 0.1.11. A wrong method on a path no route takes (`POST /nope`, `POST /logout`, `DELETE /s/x/y`): Go's plain 404, as in 0.1.11, not the styled page and not a 405; the first build answered 405 with `Allow: GET, HEAD` there (code review 04.11: 123 of 510 probes). server_test.go:263 (POST /logout, 404 or 405) still passes.
- OPTIONS, CONNECT, TRACE and any other method: `/api/` preflights are answered before the mux (server.go:152-155), unchanged; elsewhere as any wrong method above, 405 on a known path and 404 on an unknown one, as in 0.1.11.
- Theme: theme.js picks light or dark before the first paint, as on every page (S5.4); no bulb, like the login and share pages (S5.5). The default CSP (guard.go:205) allows /static/js/theme.js.
- Phone and desktop: `.lone` centres the box at every width (app.css:890-891).
- Umbrel: an unknown path sits behind the Umbrel login, which comes first (S3.17), except under the whitelisted `/s/*` and `/static/*` (umbrel/docker-compose.yml:10): `/s/x/y` shows the page without the Umbrel login. It holds nothing from the data and nothing the public /login page does not already show.
- Older versions keep the plain text answer.

S23.8.4 Test. internal/server: GET `/nope` answers 404 with `text/html; charset=utf-8`, `Cache-Control: no-cache`, the page's text and the security headers; HEAD `/nope` answers 404 with text/html (no body to check); GET `/s/x/y` answers the page; POST and PUT `/nope` answer Go's plain 404, PUT `/login` 405 `Method Not Allowed` with `Allow: GET, HEAD, POST`, POST `/health` and `/static/app.css` 405 with `Allow: GET, HEAD`; TestRoutesAnswerAsBefore sends ten methods (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, CONNECT, TRACE, PROPFIND) to every route's path and to paths no route takes, with and without a session, through this server and through a mux with the route table of 0.1.11 (the same routes without the catch all, which is the only route 0.1.12 adds: `git show v0.1.11:internal/server/server.go`, routes), and wants the same status, body and headers wherever 0.1.11 answered from its mux (404, 405 or a redirect), except GET and HEAD where 0.1.11 answered 404, which get the styled page; it fails on the first build; GET `/api/nope` with a session answers 404 JSON "no such endpoint" and PUT `/api/nope` with a session answers JSON too; GET `/static/nope` answers 404 plain text; GET `/` and GET `/login` still answer their pages. A test in the root package reads the embedded web/404.html: it links /static/app.css and /static/js/theme.js, holds the h2 text and the link to `/`, and uses only classes app.css defines. The ten width scan's screen error-404 shows the new page: no horizontal scroll, text inside the window, in Chromium and WebKit, light and dark; P-WEB-2 axe run clean on it.

S23.8.5 Wording. WORDING: needs his OK. Current: "404 page not found" (Go's text). Proposed: title "Not found", the line "This page does not exist." in the h2, and a link "Open Pinned" to `/`. The words follow the share page's "This link does not work." (share.js:93). The 405 body is "Method Not Allowed" and the 404 body for other methods "404 page not found", Go's own, as in 0.1.11.

### 23.9 Readable text at 12 px at least

S23.9.1 What changes. The two type tokens below 12 px become 12 px: `--t-micro` 11 px and `--t-small` 11.5 px (app.css:86-87) both become 12 px, in web/app.css and in design/tokens/type.json. They are used by exactly 15 rules, all readable text (app.css:241, 263, 330, 334, 672, 800, 821, 853, 1196, 1210, 1297, 1300, 1317, 1318, 1321): sidebar counts `.si-c`, the dock labels `.dk-l`, card hosts `.t-host`, card strips `.t-strip` (time and folder path), sheet hosts `.host`, the phone pinned labels `.prc-l`, the phone selection bar labels `.pbulk .bb`, phone card strips `.pt-strip`, the version line `.app-ver`, "This version" `.rel-now`, the gallery hosts and times `.gk-host`, `.gk-time`, `.gc-host`, `.gc-time` and the gallery folder chips `.gc-chip`. Code in What's new, `.rel code{font:400 .92em/1 var(--mono)}` (app.css:1217), 11.96 px, becomes `var(--t-label)`, 12 px, in web/app.css and in its token entries: the line listed in design/tokens/type.json (about :510) and the two `.rel code` font entries of design/tokens/parts.json (`"css": "400 .92em/1 var(--mono)"`, about :220 and :5790), or check 2 of check-tokens.mjs fails at app.css:1217 (review 04.11). The comment at app.css:85 that names 11.5 is updated.

S23.9.2 Why. widths 04.11 result 7 and Problem 5: text below 12 px in 15 places, set so in app.css. Rule from the agreed scope: raise to 12 px only where it is readable text, and keep the hierarchy.

S23.9.3 Not changed, as they are not text to read (and not scanned: the extension's popup and options, extras/extension/ui.css, were outside widths 04.11; nothing changes there): the letters of the small faces on folder tiles (`.ft-faces .fav`, 9 px, app.css:484) and of the 20 px favicons in gallery rows (`.gc-row .fav`, 10 px, app.css:1314), which are letter marks inside a tile; and the drawing of the iOS share menu on How to save (`.ios-apps > span` 10 px, `.ios-cap` 11 px, app.css:1507, 1532), which is a picture of another system's screen.

S23.9.4 The hierarchy. Every changed text stays below its neighbour: names in the sidebar and titles on cards are 13.5 to 15 px (`.t-title`, `.pt-title` 14 px, app.css:323, 851; `.gc-t` 13.5 px, :1316; `.gk-title` 15 px, :1296); weights and colours stay. Micro and small become equal; where they sat side by side (gallery host and time, both small already) nothing changes between them.

S23.9.5 Cases.
- Fixed heights that hold this text: `.si-c` 20 px (app.css:241), `.t-strip` 24 px (:334), `.pt-strip` 20 px (:853), `.gc-chip` 22 px (:1318): 12 px with line height 1 fits each.
- Widths that clip with an ellipsis (`.dk-l` 72 px, `.prc-l` 56 px, `.gk-time`, `.path`): a few more characters are cut; the ellipsis stays.
- The phone selection bar buttons are 52 px wide (app.css:821) and 44 px below 360 px (app.css:829): "Restore", "Delete", "Move", "Copy", "Share", "Trash", "More" must stay on one line at 320 px. Review 04.11: measure "Restore" at 12 px weight 500 in a 44 px button before the build and decide. If it fits, no exception. If it does not, those buttons keep 11.5 px below 360 px only, written in the existing rule at app.css:829, and that one exception is written into S23.9.6 and into the CHANGELOG line of S23.20.
- Phone and desktop, light and dark, Chromium and WebKit: sizes only.
- The share page uses the same rules (`.t-strip`, `.pt-strip`, hosts): it changes the same way.

S23.9.6 Test. The ten width scan finds no text below 12 px except the three kinds of S23.9.3, and no new text cut by a clipping parent; ui-test passes at 320 (its phone checks, tools/ui-test.mjs:1). `npm run check:tokens` passes.

S23.9.7 Wording: none.

### 23.10 Lock dialog: the note sits below the Repeat password field

S23.10.1 What changes. The note under the Repeat password field gets the gap the share sheet's rule line already has under its field (`.sh-text.share-pw-rule{margin:var(--s-3) var(--s-1) 0}`, app.css:564): a rule `.fld + .sh-text{margin-top:var(--s-3)}` (6 px), written beside `.sh-text` at app.css:662. Today `.sh-text` starts with `margin-top:calc(var(--s-3) * -1)` (app.css:662), which pulls it 6 px into the field above.

S23.10.2 Why. FT 04.11 step 05.8 (friction) and widths 04.11 Problem 6 and Layout numbers 2: the note's box overlaps the Repeat password field by 6 px, on the phone and on the desktop.

S23.10.3 Cases.
- `.fld + .sh-text` matches only the lock dialog's note (web/js/sheets.js:87); the other notes sit under a head or a text (sheets.js:60, 90, 116, 185) and keep their negative margin.
- The second note "Locking ends the share link." follows the first note, not a field, so its place is unchanged.
- Phone (a centred dialog, sheets.js:70) and desktop, light and dark, Chromium and WebKit.

S23.10.4 Test. widths 04.11 screen lock: the top of the note's box is 6 px below the bottom of the Repeat password field at every width, in both engines and themes; the unlock and remove lock dialogs and the confirms match 0.1.11.

S23.10.5 Wording: none.

### 23.11 Sidebar folders: the spoken name holds the visible name (axe label-content-name-mismatch)

S23.11.1 What changes. web/js/render.js:65, the folder rows of the desktop sidebar: `aria-label="${name}, ${count}"` becomes `aria-label="${name} ${count}"`, without the comma, so the visible text "Homelab 9" is the start of the name. A folder that is still locked, which shows a lock and no count (render.js:66), is named "<name> locked".

S23.11.2 Why. FT 04.11 Found on the way 2 and S15.11: axe 4.14 reports label-content-name-mismatch (WCAG 2.5.3) on the desktop sidebar folders, aria-label "Homelab, 9" for the visible "Homelab 9", 11 nodes, in WebKit and Chromium.

S23.11.3 Cases.
- The full sidebar (from 1000 px): name and count are visible; the label matches them.
- The icon rail (720 to 999 px): the name is visually hidden and the count not drawn (app.css:1437-1438); the label still carries both, as today, so the rail keeps the count for screen readers. The rail's tooltip reads `.si-n`, not the label (render.js:584), unchanged.
- Subfolders in the tree: the same row, the same label.
- A locked folder: today "Finance, 0" (count() gives 0 while locked, web/js/state.js:48-59); proposed "Finance locked".
- Not in 0.1.12: the same axe rule on the phone pinned row ("Portainer, pinned", render.js:342) and on the phone share page cards ("title, host", render.js:46) (FT 04.11 Found on the way 2), which the agreed scope does not name. Review 04.11 Missing 3: P-WEB-2 then keeps failing on those two screens in the 0.1.12 audit; the fix is the same one character change. Open: the maintainer confirms whether they stay out.
- Visible look: unchanged.

S23.11.4 Test. axe 4.14, WCAG 2.0 and 2.1 A and AA, on the Dashboard and desktop Settings at 1280 and 900 wide, Chromium and WebKit, light and dark: no label-content-name-mismatch on `#side .sf`. ui-test checks that read the sidebar labels are updated, if any.

S23.11.5 Wording. WORDING: needs his OK. Current spoken names "Homelab, 9" and "Finance, 0" (locked); proposed "Homelab 9" and "Finance locked".

### 23.12 Extension: the message for an ftp:// address and the CHANGELOG agree

S23.12.1 What changes. The CHANGELOG, not the code. CHANGELOG.md:25 (0.1.11, Fixes) ends "It is now refused with the message to enter an address starting with http or https." The code says "Enter an address, such as 10.0.0.5:9095 or https://bookmarks.example.com." (extras/extension/options.js:17), for every address it cannot use, ftp:// among them (shared.js:11, 23).

S23.12.2 Why the code is right. The options take an address without a scheme and try https, then http (shared.js:20-26; extras/extension/README.md:20). A message that said to start with http or https would call `10.0.0.5:9095`, the example the options page itself shows (options.html:26), wrong. FT 04.11 Found on the way 1.

S23.12.3 Cases. What's new shows the CHANGELOG built into the binary (S5.30), so 0.1.12 shows the corrected line under 0.1.11; servers of 0.1.11 keep the old line.

S23.12.4 Test. Read CHANGELOG.md:25 against options.js:17; tools/extension.test.mjs:87 and :103 (`ftp://example.com` gives no address) pass unchanged.

S23.12.5 Wording. WORDING: needs his OK. Proposed end of CHANGELOG.md:25: "It is now refused with the message to enter an address, such as `10.0.0.5:9095` or `https://bookmarks.example.com`."

S23.12.6 The other copies of the 0.1.11 notes (review 04.11): the GitHub release text of v0.1.11 and the pinned.cc releases page keep the old line unless edited by hand. They are corrected by hand on the release day of 0.1.12, together with the corrections of S23.14.9 and S23.14.10; both are outside this repository.

### 23.13 What's new marks "This version"

S23.13.1 What changes. web/js/sheets.js:182 compares the running version without a leading "v": `(ui.version ?? '').replace(/^v/, '') === r.v`. `ui.version` is null until /health answers (web/js/state.js:77, app.js:46) and stays null when /health fails or answers without a session; without the `?? ''` the sheet would throw while drawing (review 04.11). The version shown elsewhere stays as the server gives it ("Pinned v0.1.12", render.js:193, 312, 318).

S23.13.2 Why. S19.18: the release binary carries the tag name with its "v" (build.yml:62-66; Dockerfile:14, 18), the app takes it from `/health` (web/js/app.js:46), and What's new compares it with the CHANGELOG heading, which has no "v" (sheets.js:172, 182). So "This version" never shows on a released image.

S23.13.3 Cases.
- Release images: `v0.1.12` matches the heading `0.1.12`.
- Images of main and sha builds: the version is the short commit (build.yml:65), and local builds say `dev` (cmd/pinned/main.go:35): no heading matches, nothing is marked, as today.
- Without a session `/health` sends no version (pages.go:185-199); What's new needs a login anyway.
- The marked release is the newest one, open at the top (S5.30); an older binary with a newer CHANGELOG cannot happen, since the CHANGELOG is built in.
- The server side (`main.version`, the icon failure reset, main.go:339) does not change.
- Phone Settings and desktop More open the same sheet; light and dark use `.rel-now`, accent colour (app.css:1210), 12 px after S23.9.

S23.13.4 Test. ui-test: with `window.Pinned.ui.version` set to `v` plus the first heading's version, What's new shows "This version" beside that heading only; with `dev`, nowhere; with `null`, nowhere, and the sheet draws. Release check: a binary built with `-X main.version=v0.1.12` shows it.

S23.13.5 Wording: none new. "This version" is the existing text (sheets.js:182).

### 23.14 The doc disagreements of S19.1 to S19.17

Each is settled below: which side is right, and what changes. None of them changes code.

S23.14.1 S19.1, going back: README.md:269. The README changes (S23.16).

S23.14.2 S19.2, header cap. The code is right (`maxHeaderBytes = 64 << 10`, cmd/pinned/main.go:404, 412). docs/security.md:14, in the limits table, row "Request headers", value "1 MB, Go's default", becomes row "Request line and headers", value "64 KB".

S23.14.3 S19.3, SVG storage. The code is right (internal/favicon/image.go:86-107). docs/data-format.md:155, current: "an SVG is kept as it is, only when it passes the check in `docs/security.md`." Proposed: "an SVG that passes the check in `docs/security.md` is stored as a new SVG written from what the check kept, never as the site sent it."

S23.14.4 S19.4, embedded pictures in an SVG. The code is right: the check accepts PNG, JPEG, GIF and WebP data (internal/favicon/svg.go:254-262), the rewrite stores PNG, JPEG and GIF as a new PNG and drops an `image` element whose picture is WebP (svg.go:621-695, 544-546). docs/security.md:107, current: "and an embedded PNG or JPEG is stored as a new PNG." Proposed, as review 04.11 settled (pictures in a style `url()` are only checked, never decoded or rewritten, re-check 04.11 point 1): "and an embedded PNG, JPEG or GIF picture in an `image` element is stored as a new PNG, and one in WebP or not written in base64 is left out of the stored SVG; a picture in a style `url()` is kept as written."

S23.14.5 S19.5, folders table. The code is right (`hide_recent INTEGER NOT NULL DEFAULT 0`, internal/store/store.go:166-167). docs/data-format.md, folders table (:24-34), gets a row after `lock_stamp`: column `hide_recent`, type INTEGER NOT NULL, meaning "1 when the folder is left out of Recent; its subfolders are too. 0 by default."

S23.14.6 S19.6, settings values. The code is right (JSON for `last_folder` and `recent_folders`, internal/store/folders.go:389-395; plain text for `password_hash` and `icon_failures_version`, internal/store/sessions.go:139-140, icons.go:77). docs/data-format.md:64, the `value` row, current meaning "JSON." Proposed: "JSON for `last_folder`, `recent_folders` and `icons_reencoded`; plain text for `password_hash` and `icon_failures_version`."

S23.14.7 S19.7, the flows text. The flows doc changes (S23.17).

S23.14.8 S19.8, the extension message. The CHANGELOG changes (S23.12).

S23.14.9 S19.9, touch targets. The code is the decided design: card buttons are 28 px for a mouse and 44 px for touch from 720 px (app.css:342, 1458); on How to save the snippet Copy buttons are 36 px (app.css:976). CHANGELOG.md:32, current: "Touch targets on How to save, the folder share button and the card buttons are at least 44 px." Proposed, with review 04.11's change (the line describes 0.1.11, where Show the Save code was 19 px high, widths 04.11 Problem 1): "On touch screens, the touch targets on How to save, the folder share button and the card buttons are at least 44 px, apart from Show the Save code (44 px from 0.1.12) and the Copy buttons in the help on How to save, which are 36 px." WORDING: needs his OK.

S23.14.10 S19.10, Refetch icon. The code has no Refetch icon control, only the route (server.go:206), at every tag from 0.1.0 to 0.1.11 (`git grep -i refetch vX.Y.Z -- web` finds only comments). CHANGELOG.md:24, current: "Saving it again, changing its address, Refetch icon or the next version try again." Proposed, as review 04.11 settled: "Saving it again, changing its address or the next version try again." The review's reason, that no user doc names the route, does not hold (README.md:269 names it for going back, S19.10); the shorter line is kept because the changelog speaks of what a user does in the app. WORDING: needs his OK; the alternative is the first draft's "Saving it again, changing its address, a refetch through the API (`POST /api/bookmarks/{id}/refetch-icon`) or the next version try again."

S23.14.11 S19.11, token answers. The code is right (api.go:294-296). README.md:176 gets, after its sentence: "A `PATCH /api/bookmarks/{id}` with a token that sends any field other than `title` and `folder_id` answers 400." WORDING: needs his OK.

S23.14.12 S19.12, home screen on the iPhone. The README is right that the app can be added on the iPhone (Safari's share menu, with the Apple web app tags, S11.3), but How to save shows the steps only on Android (web/bookmarklet.html:118) while README.md:133 says it has every option with the steps for each device. README.md:138, current: "Add the app to the home screen on the iPhone or Android." Proposed: "Add the app to the home screen on Android, with the steps in How to save, or on the iPhone, with Share and then Add to Home Screen in Safari." No change to How to save (no new step in 0.1.12). WORDING: needs his OK.

S23.14.13 S19.13, the bookmarklet window. Not a defect: the window opens at 392 by 544 (web/js/app.js:93) and the save page then fits it to the panel's height (app.js:64-72), so "392 by about 530" in CHANGELOG.md:171 (0.1.2) describes the fitted window. No change.

S23.14.14 S19.14, the Umbrel README. The package files are right (umbrel/docker-compose.yml, umbrel-app.yml at 74e3037). umbrel/README.md changes:
- :1 "# Umbrel package, draft" becomes "# Umbrel package".
- :3, current "These two files are the draft for a pull request to the Umbrel App Store, https://github.com/getumbrel/umbrel-apps. They are not used by anything in this repository." Proposed: "These two files are the package in the pull request to the Umbrel App Store, https://github.com/getumbrel/umbrel-apps/pull/6243. Nothing else in this repository uses them."
- :7, current "## What has to be filled in before the pull request" (review 04.11: the PR exists). Proposed: "## What to fill in for each release".
- :9, current "... and put the index digest in place of `sha256:PLACEHOLDER`." Proposed: "... and put the index digest after the tag, as in `ghcr.io/pinned-cc/pinned:0.1.11@sha256:...`."
- :21, current "`BASE_URL` points at the device address and the store port, so the Save button code and the search entry use it." Proposed: "No `BASE_URL` is set: the app takes its address from each request, so the Save button code and the search entry use the address the browser used."
- :24, "Not tested on an Umbrel yet." Open: whether it has been run on an Umbrel; the line stays until the maintainer says.
WORDING: needs his OK.

S23.14.15 S19.15, examples. The folder is right: five example files, since 0.1.0 (`git ls-tree v0.1.0 extras/examples/`). extras/examples/README.md:3, "Six small ways" becomes "Five small ways".

S23.14.16 S19.16, the testing log. The rule is right ("newest first", docs/testing.md:30). The two rows of 2026-11-03 (docs/testing.md:46-47) move to the top of the table, and the rows of the 0.1.12 runs go above them.

S23.14.17 S19.17, the tag named in FT 04.11. The flow test of 04.11 is not in the repository; nothing in the repository changes. Its line 3 is corrected where it is kept, to name 44007be.

S23.14.18 Test for all of S23.14: each changed line is read against the code it names, by the review of this spec and again after the build.

### 23.15 Remove the dead "locked" duplicate answer

S23.15.1 What changes.
- internal/server/locks.go:187-192: writeLockedDuplicate and the answer `{"error": "Already saved", "duplicate": null, "locked": true}` go.
- internal/server/locks.go:197-208, handleDuplicate: when the existing bookmark is one the caller cannot see, which the lookups never produce (S20.1), it logs one `error:` line without the bookmark and answers 500 "something went wrong" (server.go:666). handleDuplicate has no Server receiver, so the line is a plain `log.Printf`, like writeStoreError's (server.go:665). A hidden bookmark still never reaches an answer.
- web/js/sheets.js: the `hid` state and its branches go: :308 (`hid: false`), :321 and :343 (the dupe line), :331 and :347 (Save disabled), :334 (the "Already saved" status), :352 and :354 (from /api/check, which never sends `locked`), :365 (the 409 branch).
- extras/extension/popup.js: the same: :59, :61, :98, :108, :117, :158 and :163; and :153, the filter of locked folders from /api/folders, which never sends them (tokens.go:226-237).

S23.15.2 Why. S19.19 and S20.1, S20.2: since 0.1.11 every duplicate lookup uses the caller's lock view (internal/store/bookmarks.go:117-137, 265, 359, 452), so the locked answer cannot happen and the clients' handling of it is dead.

S23.15.3 Cases.
- Saving, checking or importing an address that sits only in a locked folder: a new bookmark outside it, as in 0.1.11 (README.md:163, 285; internal/server/access_test.go:116-121, TestLockedDuplicateIsNotTold).
- A real duplicate: 409 with the bookmark, "Already saved in <path>. Save anyway moves it here.", as now.
- The 0.1.12 web app always talks to its own server.
- A 0.1.12 extension against a server of 0.1.0 to 0.1.10, after going back while keeping the newer extension loaded: those servers can answer the locked 409 (`git show v0.1.10:internal/server/locks.go`, line 176). The popup then shows the server's text as an error, "Already saved.", instead of the disabled Already saved state of 0.1.11. Accepted: the text says the same.
- No visible change on the 0.1.12 server.

S23.15.4 Test. A Go test calls handleDuplicate with a DuplicateError whose bookmark sits in a hidden folder: 500, and the body holds neither its title nor its address. The existing tests that save and check an address held only in a locked folder pass (internal/server/access_test.go:121). tools/extension.test.mjs: a 409 with `duplicate` still leads to Save anyway. `grep -n "locked" web/js/sheets.js extras/extension/popup.js` finds nothing that reads a 409 or /api/check or /api/folders answer.

S23.15.5 Wording: none in normal use. The 500 answer is the existing "something went wrong".

S23.15.5a Done after re-review 04.11, which found the sheets.js part still in the build (sheets.js:323, 336, 346, 349, 358, 362, 367, 369, 380 at 4ae9cdb): every `hid` read and write and both `locked` reads go; the save sheet keeps the two states the server sends, "Not saved yet" and "Already saved in <path>. Save anyway moves it here.". A ui-test check sends a 409 with `locked: true` and an /api/check answer with `locked: true` (route stubs) and wants the sheet to behave as for an answer without it: Save stays enabled and the status reads "Not saved yet" for the check, and the error line shows the server's text for the 409; it fails before the removal.

S23.15.5b The popup part, done after release audit 5 (F-173: popup.js was not in the diff): the `hid` state, the 409 `locked` branch, the `locked` flag read from /api/check and the filter of locked folders on /api/folders go, as S23.15.1 lists. tools/extension.test.mjs: with /api/check answering `locked: true` and /api/folders listing a folder with `locked: true`, the popup shows "Not saved yet" with Save enabled and lists that folder (the server sends neither); a 409 with `locked: true` and no `duplicate` shows the server's text as an error. `grep -n "locked\|hid" extras/extension/popup.js` finds nothing. It fails before the removal.

S23.15.6 Who builds what: the server side (locks.go) and its Go test go with the server work; the sheets.js and popup.js removals and the extension test go with the web and extension work.

### 23.16 README: going back to an older version

S23.16.1 What changes. README.md:269, first sentence, current: "An older version does not start on a database a newer one has upgraded." Proposed: "Versions from 0.1.1 on do not start on a database a newer version has upgraded. 0.1.0 has no such check and opens it, but folder and share passwords set or used since 0.1.11 do not open there, so never start 0.1.0 on an upgraded database: go back with the copy, as below." The rest of the paragraph stays. WORDING: needs his OK.

S23.16.1a Added after that paragraph, as a line of its own (re-review 04.11, low: after the key pass of S23.4.7, 0.1.11 makes a second bookmark for such an address): "After 0.1.12 has set new keys for addresses with a space before their `#`, 0.1.11 may not recognise those few addresses as already saved, so saving one of them again there makes a second bookmark." WORDING: needs his OK.

S23.16.2 Why. The upgrade run of 04.11 found that 0.1.0 opens a database 0.1.11 upgraded. S4.10, S12.7, S19.1: 0.1.0's migrate loop does nothing when the stored version is higher (`git show v0.1.0:internal/store/store.go`, line 146); 0.1.1 to 0.1.10 refuse it (`git show v0.1.1:internal/store/store.go`, line 161). S20.4: lock and share hashes in the `k1:` form fail 0.1.0's plain bcrypt compare (`git show v0.1.0:internal/server/locks.go`, line 300).

S23.16.3 Cases. 0.1.0 (opens it), 0.1.1 to 0.1.10 (refuse with "database was written by a newer Pinned (schema N); this version knows 6. ..."), 0.1.11 (refuses a newer schema and names the copy, S4.11), 0.1.12 (no new schema, so 0.1.11 opens a 0.1.12 database, S23.0.4). Each read with `git show vX.Y.Z:internal/store/store.go`.

S23.16.4 Test. Read against the tags as above. By hand, once: 0.1.0 built from its tag on a copy of a 0.1.11 data folder starts, and a folder locked under 0.1.11 does not unlock.

### 23.17 The flows doc describes the current app

S23.17.1 What changes. design/wireframes/flows/flows.md and the twelve `.mmd` diagrams next to it are generated by design/wireframes/build.py from design/wireframes/flows_data.py (build.py:2-9; flows_data.py:355-382). In flows_data.py:
- the header line (flows_data.py:359), "Main at ad2cb8e (0.1.11 candidate).", and the same words in the index page (flows_data.py:295) and the file's own description (flows_data.py:4) name 0.1.12 and the commit it is built from;
- the step texts that differ at v0.1.11 (S19.7: 01.2, 01.5, 02.2, 02.3, 02.11, 02.13, 03.11, 04.4, 04.7, 04.13, 05.1, 05.2, 05.6, 06.4, 07.2, 07.7, 08.3, 08.4, 08.5, 09.4, 11.3, 12.1, 12.2, 12.3) are written from what FT 04.11 saw at each step;
- the steps 0.1.12 changes are written from 0.1.12: 02.13 (the http warning, S23.1), 05.1 and 05.8 (the lock note, S23.10), 10.4 (This version, S23.13), 12.3 (the phone head, S23.7);
- each step's status (works, friction, broken) is the 0.1.12 state: FT 04.11's 11 friction steps (S17.1) less 05.8, fixed by S23.10;
- build.py's own description (build.py:2-3), "0.1.11 candidate, ad2cb8e", says 0.1.12.
design/wireframes/flow-test.md, the record of the flow test of 31.10.2026, is generated by the same script (flows_data.py:383 on). It stays as it is: the script stops writing it, so the record of 31.10 is not rewritten with new step texts. The lines that point readers to it for "the findings" and "the results" (flows_data.py:296, 359) then say "the flow test of 31.10 is in flow-test.md; the 04.11 results are in the step texts" (review 04.11).

S23.17.2 Why. FT 04.11 Counts 7 and S6.3, S19.7: the flows text still describes ad2cb8e.

S23.17.3 Cases. The Storybook reads flows.md and the `.mmd` files directly (design/storybook/stories/flows.stories.js:3-5), so it shows the new text after a rebuild. The screens in design/wireframes/screens stay as drawn; a screen is redrawn only where it shows a part 0.1.12 changes: the lock dialog note, the extension options status, whats-new.html (This version, S23.13) and the phone unreachable screen if it shows the phone frame (S23.7) (review 04.11).

S23.17.4 Test. After `python3 design/wireframes/build.py`: `git diff` shows flows.md, the `.mmd` files, index.html, flows.js and walk.html changed (they carry the same step texts and the header, review 04.11) and the redrawn screens, and flow-test.md unchanged; every step text read against FT 04.11 and the 0.1.12 build; the Storybook flows story renders all twelve diagrams.

S23.17.5 Wording: the step texts are descriptions for the repository, not app text.

### 23.18 Repo additions already on the branch

S23.18.1 What is in. Merged into release-0.1.12 at 22fc1d5:
- 9911272, design/: W3C design tokens taken from web/app.css with the line of each value (design/tokens/*.json), a token check (design/scripts/check-tokens.mjs: every custom property in both modes, every other token at its line, every written out value a token), a Style Dictionary build and a Storybook of the app's screens and parts (design/package.json).
- 5454d4f, internal/store/upgrade_test.go with internal/store/testdata/upgrade: one real database of each release from 0.1.0 to 0.1.10, written by that release's own binary through its API, each with the JSON it answered, opened by this version with nothing lost (TestReleasedDatabasesUpgrade, TestReleasedDatabasesKeepThePassword, upgrade_test.go:151, 385).
- 74e3037, umbrel/umbrel-app.yml: an empty `releaseNotes`, as the store lint asks for a new app (S3.19).

S23.18.2 Cases. design/ is not in the image: the image's last stage holds only the binary and its data (Dockerfile:20-29), and the binary embeds web/ only (assets.go:6-9). The upgrade tests run in CI with every `go test -race ./...` (build.yml:29). The token check does not run in CI; it runs with `npm run check:tokens` in design/ and is part of the release check (S23.0.2).

S23.18.3 Test. `go test -count=1 ./internal/store` passes on 74e3037 (run on 04.11 for this spec). `npm run check:tokens` passes before and after the 0.1.12 CSS edits.

S23.18.4 Prepared changes of 04.11 outside the repository (review 04.11 Missing 4): build-sbom.diff is taken into S23.3. The others stay out of 0.1.12 unless an item is added for them: security.diff, readme.diff, readme-badges.diff, the REUSE files, and the scorecard fixes (CodeQL, OSV scanner, the main branch ruleset, the security policy link, and the netscape fuzz test of S23.4.6).

### 23.19 gitleaks: allow the upgrade fixtures

S23.19.1 What changes. A `.gitleaks.toml` at the repository root extends the default rules and allows one path, with its reason:
- `[extend]` with `useDefault = true`;
- one `[[allowlists]]` entry with the description "Upgrade test fixtures: passwords and tokens of throwaway runs of released binaries, hashed under a fixture secret.key (internal/store/upgrade_test.go:18-29); they open nothing anywhere else", `targetRules = ['generic-api-key']`, so a real secret of another kind dropped into testdata later is still found, and `paths = ['''internal/store/testdata/''']`, without a `^` anchor, so it matches when gitleaks is run on the repository from another folder and the paths are not relative (review 04.11).

S23.19.2 Why. gitleaks reports 32 hits in internal/store/testdata/upgrade, all of rule generic-api-key, both in `gitleaks git` over v0.1.11..74e3037 (32) and in `gitleaks dir .` (32 of 35), run with gitleaks 8.30.1 for this spec. They are the test passwords and tokens the upgrade fixtures were made with (upgrade_test.go:18-29).

S23.19.3 Cases. `gitleaks dir .` also reports 3 hits of rule curl-auth-header in extras/examples/README.md (lines 29, 42, 55: `Authorization: Bearer tk_your_token`, a placeholder), present since before 0.1.12. Not in the agreed scope; they stay reported. CI does not run gitleaks; the release audit does.

S23.19.4 Test. `gitleaks git .` and `gitleaks dir .` report no hit in internal/store/testdata; a planted real looking token in another path is still found; a planted secret of another rule (a private key block) in internal/store/testdata is still found.

### 23.20 CHANGELOG 0.1.12, and release steps

S23.20.1 What changes. CHANGELOG.md gets a section "## 0.1.12" above 0.1.11, with ", <release date>" added to the heading on the day the maintainer sets (the heading form parseChangelog reads, sheets.js:172; the date is optional there, so the heading parses before it has one). WORDING: needs his OK. Proposed, under "### Fixes":
- "In the browser extension's options, an address typed with `http://` for a server outside your own network now says, on Test and on Save, that your token may cross the internet unencrypted, and goes ahead only when you click again. Before, it said Connected."
- "An address with a space before its `#`, such as `http://nas/a #top`, is now the same bookmark as `http://nas/a`."
- "How to save: Show the Save code is easier to tap."
- "On a small phone the Add sheet shows the folder the link goes to."
- "On the phone, the Settings gear shows when the server cannot be reached at the first load."
- "A page that does not exist says so in the app's look, instead of a plain line of text."
- "Small text, such as counts, times, hosts and the version line, is at least 12 px." (Depends on the S23.9.5 decision for 320 px: if the selection bar keeps 11.5 px below 360 px, the line names that exception.)
- "In the lock dialog the note no longer overlaps the Repeat password field."
- "Screen readers read each folder in the sidebar by the name and count it shows."
- "What's new marks the version you run."
- "An SVG icon with more than eight pictures in its style is now refused when it is fetched. Before, it was stored, removed at the next start and fetched again at every start." (S23.21)
- "The image's build record no longer names the account that pushed the release. The software bill of materials stays. Each release on GitHub now carries the software bill of materials of both platforms and a signed build provenance, which `gh attestation verify` checks." (S23.3)
The doc corrections of S23.12, S23.14 and S23.16 are not listed.

S23.20.2 Release steps, no behaviour change. With the build (review 04.11 changes 1 to 3):
- README.md:24 names `v0.1.12` in the install command.
- extras/vps/setup.sh:5 and :9 (the commands in its head) name `v0.1.12`, and setup.sh:19 defaults to the image `ghcr.io/pinned-cc/pinned:0.1.12`; tools/setup.test.sh:68 checks `ghcr.io/pinned-cc/pinned:0.1.12`, in the same commit, or `sh tools/setup.test.sh` fails in CI (build.yml:32).
- README.md:27 keeps "Tested for 0.1.11 on a fresh Ubuntu 26.04 server": the fresh server run is not repeated in this build. If it is run for 0.1.12 before the tag, the line names 0.1.12.
- docs/testing.md: the two rows of 2026-11-03 move to the top (S23.14.16); the rows of the 0.1.12 runs go above them when those runs are made.
- Not version pins, and they stay: the lines of README.md:269, 271, docs/ and the code that name 0.1.11 as the version a behaviour came in, and the design/ files that say they were taken from the app at 0.1.11 (design/scripts, design/storybook, design/tokens).
On the release day, after the image is built and checked (S3.21, S23.3.4), and not before, the store packages move as one, so that no package says 0.1.12 while it installs the 0.1.11 image:
- umbrel/umbrel-app.yml:7 `version` and umbrel/docker-compose.yml:13 the image, `ghcr.io/pinned-cc/pinned:0.1.12@sha256:<index digest>`; `releaseNotes` stays empty while PR 6243 is open (S3.19) and is filled once the app is in the store.
- casaos/docker-compose.yml:4 the image by digest, :74 `version`, :75 `update_at` and :77 `release_notes`.
- Then the ZimaOS PR 1116 and the Umbrel PR 6243, outside this repository.

S23.20.3 Test. What's new on the 0.1.12 build opens on 0.1.12 with "This version" (S23.13), and the last three releases open. `git grep -n "0\.1\.11"` after the build lists only the lines S23.20.2 says stay and the store package lines of the release day.

### 23.21 SVG icons with pictures in a style url() are not fetched again at every start (F-137 leftover)

S23.21.1 What changes. internal/favicon/svg.go, rewriteSVG: after the rewrite, the written SVG is refused (errUnsafeSVG) when it holds more than eight `data:image` (`maxEmbedded`), counted the way a browser reads them (code review 04.11, low): the written SVG is read again, and each attribute value and each run of text between tags is counted with its character references decoded, white space and control characters left out and case ignored (squash, svg.go:449, the same reading safeCSS uses). A count of the raw bytes alone, as the first draft had it, misses `data: image`, `data&#9;:image` or `data&#x20;:image`: squash lets them through safeCSS, a browser's URL parser drops the tab and the data URL its leading space, and the rewrite writes a tab back as `&#x9;`, which the raw count does not see either. The raw count at the start of rewriteSVG stays, as the quick first refusal of F-150, and so does the per picture count of the `image` elements (svg.go:541-542, 653).

S23.21.2 Why. Re-check 04.11 point 1 (review 04.11 Missing 1): the raw count reads the bytes as sent, so nine pictures written `data&#58;image` in style `url()` pass it; the rewrite counts only `image` elements, and writes the decoded `:` back as a plain character (escape(), svg.go:699), so the stored file holds nine plain `data:image`. At the next start rewriteStoredSVG (internal/favicon/fetch.go:300-322) runs the check again, the raw count refuses the stored file, the icon is dropped and the start fetch stores it again: one fetch per such icon at every start, against the comment at fetch.go:307-309 that a rewrite of a rewrite gives the same bytes. With the count on the output, what is stored always passes the first count again.

S23.21.3 Cases.
- Pictures in style `url()` (attribute or style element) written with character references: more than eight, refused at the first fetch; the fetch counts it as a failure (Run, fetch.go:482-486), so the start fetch gives up on the link after three, as for any bad icon (S9). Eight or fewer: stored as today.
- The same text in a kept text element (`text`, `title`) written with character references: counted the same way, since it is in the stored bytes the first count reads.
- `image` elements: unchanged; already counted as decoded.
- Icons stored by 0.1.11 with more than eight such pictures: already dropped at each start by 0.1.11's own check; in 0.1.12 the start check drops them the same way, and the refetch now refuses them, so they show the letter and are not fetched again after three failures.
- Pictures in a style `url()` spelled with white space or a control character inside `data:image`, plain or as a character reference (`data: image`, `DATA :IMAGE`, `data&#9;:image`, `data&#10;:image`, `data:&#x20;image`): counted like `data:image`; more than eight are refused.
- An icon that 0.1.11 stored and keeps across starts: no change when its pictures are spelled `data:image`, since its stored bytes pass the raw count. One with more than eight pictures spelled with white space inside `data:image`, which 0.1.11 kept, is dropped at the first start of 0.1.12 by the start check (rewriteStoredSVG runs this rewrite), refused when fetched again, and after three failures no longer fetched; it shows the letter.
- Decode work: none added; the count is one pass over at most 1 MB (maxSVGOut).

S23.21.4 Test. internal/favicon: nine pictures in style `url()` written `data&#58;image` (attribute and style element) are refused by processSVG; eight are stored, and processSVG of the stored bytes gives the same bytes. Without the fix the first case is stored and the second processSVG refuses it. The same for the spellings `data: image`, `DATA :IMAGE`, `data&#9;:image`, `data&#10;:image` and `data:&#x20;image`, in the attribute and the style element: nine refused, eight stored with the same bytes again; nine of them pass the raw count alone.

S23.21.5 Wording: none in the app. CHANGELOG: see S23.20.

### 23.22 A real 0.1.11 database in the upgrade tests (code review 04.11, low)

S23.22.1 What changes. internal/store/testdata/upgrade gets v0.1.11.db.gz and v0.1.11.json, made the way the eleven others were (S23.18.1): the v0.1.11 binary built from its tag in a scratch folder (`go build -trimpath -ldflags "-X main.version=v0.1.11" ./cmd/pinned`), started on an empty data folder in /tmp with the fixture secret.key (upgrade_test.go:34) and the fixture app password, bound to 127.0.0.1, filled through its own HTTP API by the same run as before, then stopped; the database is gzipped (`gzip -9 -n`) and the JSON holds what it answered. Where 0.1.11 asks for more, the run follows it: a folder password of 8 characters or more (`rose-garden-path`), the app password again to make a token, and an address of 8000 bytes, since 0.1.11 refuses one over 8192. The run adds the rows of S23.4.7 that 0.1.11 can write: `http://127.0.0.1:13/a #top`, `http://127.0.0.1:13/n` with a no break space before `#x`, the pair `http://127.0.0.1:14/b` and `http://127.0.0.1:14/b #x`, one such row in Trash and one in the locked folder. upgrade_test.go reads twelve databases and checks for each what its version wrote: no upgrade and no migration copy for 0.1.11 (schema 12), its lock and share passwords in the keyed form with their stamps (checked with auth.CheckKeyedPassword, which checks the older form too), the extension token bound to its origin, and the app password kept as its hash when it is the same.

S23.22.2 Why. Code review 04.11, low: there was no fixture of schema 12 with keyed hashes, stamps and sessions, the database almost every user upgrades from next. TOTP_SECRET stores nothing in the database (the code check is in memory), so the run does not set it.

S23.22.3 Test. `go test ./internal/store` runs TestReleasedDatabasesUpgrade and TestReleasedDatabasesKeepThePassword over twelve databases; TestReleasedKeysSetAgain (S23.4.7) uses the 0.1.11 one. gitleaks keeps to the allowlist of S23.19, which covers the folder.

### 23.23 The extension carries the app's version (code review 04.11, low)

S23.23.1 What changes. extras/extension/manifest.json:5, `"version": "1.0.0"` becomes `"version": "0.1.12"`, the version of the release it ships in, and from now on it moves with each release. tools/extension.test.mjs checks that it equals the newest heading of CHANGELOG.md, so a release cannot ship with an old one. S11.5 and S20.7 describe 0.1.11 and stay as they are.

S23.23.2 Why. Code review 04.11, low: the version was 1.0.0 in every release (S20.7), while options.js and ui.css change in 0.1.12, so neither a user nor a later store could tell whether a loaded extension has the http warning of S23.1.

S23.23.3 Going down from 1.0.0. The extension is only loaded unpacked (Chromium browsers, from the folder) or as a temporary add-on (Firefox, about:debugging); there is no store listing and no update URL (S20.8), so no update check compares versions. Checked on 04.11: in Chromium (Playwright 1.61.0, a persistent profile), the folder loaded with 1.0.0 and then again with 0.1.12 at the same path runs 0.1.12 with the same extension id and keeps what was stored (server address and token). Firefox replaces a temporary add-on of the same id whatever its version (XPIInstall.sys.mjs, installTemporaryAddon and _activateAddon, read on 04.11: no version comparison), and a file install of a lower version is not refused either (only a version an update asked for is checked). So 0.1.12 is used, not 1.1.0. The other reason a version may not go down does not apply either (re-review 04.11 asked): 1.0.0 was never signed or listed in any store (the maintainer, 04.11): Firefox signing on addons.mozilla.org is parked, so no signed 1.0.0 exists that would make AMO refuse a lower version, and there is no Chrome Web Store listing. A browser that still has 1.0.0 loaded sees 0.1.12 as a lower version, which matters only for store updates, which do not exist. A store listing later starts from the version of that release.

S23.23.4 Where the version shows. Chromium browsers: the extension's card on chrome://extensions (brave://extensions, edge://extensions), under the name. Firefox: the extension's entry on about:debugging (This Firefox), and Manage on about:addons. The extension's own pages do not show it, and nothing in the extension or the server reads it.

S23.23.5 Cases. Packed into the zip at build (tools/pack-extension.sh, Dockerfile:16), so the zip a 0.1.12 server serves at `/extras/pinned-extension.zip` says 0.1.12. An extension loaded earlier keeps saying 1.0.0 until it is loaded again. Wording: none in the app.

S23.23.6 Test. `node --test tools/extension.test.mjs`: the new check fails at 1.0.0 and passes at 0.1.12.

### 23.24 design/: the dev tools move past their npm advisories (release audit 5, F-174, low)

S23.24.1 What changes. design/package.json: `storybook` and `@storybook/html-vite` 9.1.21 become 10.6.5, and an `overrides` entry sets `glob` to 14.0.3; design/package-lock.json is resolved again from these ranges. Storybook 10 no longer pulls in `@vitest/mocker` (3.2.4 had GHSA-82fw-gwwq-j7x9 and GHSA-qxg6-89mg-rqv8, fixed in 4.1.12, which no Storybook 9 accepts); glob 14.0.3 fixes GHSA-3g3m-2fjr-6pw4 and brings minimatch 11.0.4, which fixes GHSA-g3hv-75wg-m249. style-dictionary 5.7.1 reaches glob through `@bundled-es-modules/glob`, whose Node entry re-exports `glob/raw`, which glob 14 still exports, so the override is the glob style-dictionary runs.

S23.24.2 What stays: deepmerge 4.3.1, GHSA-gcqx-w48m-w2h4 (low, prototype poisoning of the merged object). The advisory names no fixed version (last affected 4.3.1, the newest release, checked on osv.dev and npm on 04.11). style-dictionary 5.7.1 and the newest, 5.8.0, take it through `@bundled-es-modules/deepmerge`, which carries its own copy. It merges the token files of design/tokens, which are this repository's own, so no outside input reaches it. Recorded as accepted until a fixed deepmerge or a style-dictionary without it exists.

S23.24.3 Why it is low and touches no user. design/ runs only by hand on the maintainer's machine (Storybook, Style Dictionary, the token check, S23.18.2); it is not in CI, not embedded in the binary (assets.go) and not in the image (Dockerfile:20-31).

S23.24.4 Test. Run on 04.11 in a scratch copy, then the files taken over: `npm install`, `npm run check:tokens` passes ("every token matches web/app.css, and every value in app.css is a token"); `npm run build-storybook` builds, and its index.json holds the same 109 stories with the same ids as the 9.1.21 build. An OSV query over every package of the new design/package-lock.json (402 packages) finds only deepmerge 4.3.1; over the old lock it found the four packages of F-174. `npm run shoot` (screens against the real app) is not run here: it needs the capture of the real app first (S23.18).
