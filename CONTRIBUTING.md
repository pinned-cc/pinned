# Contributing

Thanks for looking. This is a small app for one person, and it stays small on purpose. Read this before you open a pull request.

## Run it

You need Go (the version in `go.mod`).

```sh
tools/dev.sh
```

This runs the app on http://localhost:9095 with the password `dev-password` and keeps its data in `./data`. It is the same as:

```sh
DATA_DIR=./data APP_PASSWORD=dev-password PORT=9095 go run ./cmd/pinned
```

For work on the front end only, there is a stub server written in Python 3. It serves `web/` with neutral demo data and needs no Go:

```sh
python3 tools/stub.py 9095   # any password logs in
tools/dev.sh styleguide      # the style guide at http://localhost:9200/styleguide
```

The stub copies the API by hand. If you change an API answer in Go, change the stub too.

## Before a pull request

```sh
gofmt -l .        # prints nothing
go vet ./...
go test -race ./...
```

The CI also runs `staticcheck`.

Keep pull requests small: one change, with a test when it touches the server. Explain why in the description, not only what.

Copy in the app is plain, sentence case, and has no em dashes, en dashes, middle dots or pipes.

## The identity rule

Host and port are the identity of a link. `http://10.0.0.5:8080` and `http://10.0.0.5:9000` are two bookmarks, and the port is always shown. The rule lives in `internal/urlkey` and is described in `docs/data-format.md`. Do not shorten a host, drop a port, or turn an IP into a name anywhere in the app. Changes that weaken this will not be merged.

## What will not be merged

- Tags.
- Page archiving, screenshots or full text of saved pages.
- User accounts, more than one user, or roles.
- Notes on bookmarks.
- Telemetry, analytics, update checks, or any other request the server makes on its own besides fetching icons.

If you are not sure whether something fits, open an issue first and ask.

## Licence

By sending a contribution you agree that it is licensed under AGPL-3.0-only, the licence of this project.
