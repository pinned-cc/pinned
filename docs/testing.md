# Testing

## What runs where

- `go test -race ./...`, `go vet`, `gofmt` and `staticcheck`: the server. In CI on every push.
- `node --test tools/extension.test.mjs`: the browser extension (`extras/extension`), with node's own test runner and no dependencies. In CI on every push.
- `tools/ui-test.mjs`: the web front end in real browsers with Playwright, in Chromium, WebKit and Firefox. Not in CI. Run it by hand before a release and record the result below.

## Run the browser test

Build and start a Pinned with a data folder you can throw away:

```sh
go build -o /tmp/pinned-ui ./cmd/pinned
DATA_DIR=$(mktemp -d) APP_PASSWORD=ui-test-password PORT=9098 /tmp/pinned-ui
```

Then, in a second terminal:

```sh
node tools/ui-test.mjs http://127.0.0.1:9098 ui-test-password
node tools/ui-test.mjs http://127.0.0.1:9098 ui-test-password --only firefox
```

Playwright is not a dependency of the repo; the head of `tools/ui-test.mjs` says where it looks for it. Install the browsers for the same Playwright version with `npx playwright install chromium webkit firefox`. A browser that does not start counts as a failure and the other engines still run. On macOS there is no `timeout`; to cap a run, use `perl -e 'alarm 900; exec @ARGV' -- node tools/ui-test.mjs ...`.

## Results

One line per run, newest first: date, commit, Playwright version, result per engine.

| Date | Commit | Playwright | Chromium | WebKit | Firefox |
|---|---|---|---|---|---|
| 2026-10-31 | bcc7c63 (0.1.11, not released) | 1.61.0 | 123 passed, 0 failed | 122 passed, 0 failed | not run here: to be run on a plain terminal. |
| 2026-10-31 | 7f8b635 (0.1.11, not released) | 1.61.0 | 123 passed, 0 failed | 122 passed, 0 failed | not run here: to be run on a plain terminal. |
| 2026-10-30 | d6bf925 (0.1.11, not released) | 1.61.0 | 111 passed, 0 failed | 110 passed, 0 failed | not run: Firefox 151 (build 1532) did not start in the sandboxed shell the run used, launch timed out after 60 seconds. To run on a plain terminal. |

Chromium runs one check more than WebKit: a real touch drag on the home gallery, which the script runs in Chromium only.
