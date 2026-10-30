# Security

## Reporting a problem

Please report security problems privately, through GitHub:

1. Open the repository on GitHub.
2. Go to the Security tab.
3. Choose Report a vulnerability.

This uses GitHub's private vulnerability reporting. Only you and the maintainers see the report. There is no email address for reports.

Please do not open a public issue for a security problem.

## What to include

- The version, from `pinned -version`, or from `/health` while you are logged in.
- How you run it: Docker, Umbrel, or your own build, and whether a reverse proxy sits in front.
- What you did, what happened, and what you expected.
- A proof of concept if you have one.

## What is in scope

- The server in this repository: login, sessions, API tokens, locked folders, share links, import and export, the icon fetcher, the HTTP headers it sends.
- The browser extension in `extras/extension`.
- The Docker image and the example `docker-compose.yml`.

Out of scope:

- Problems that need someone who already has your app password or a valid token, unless they get more than that password or token should give.
- Your reverse proxy, your Umbrel or NAS, or your network.
- Missing hardening that is already documented as a limit in the README, for example that a folder lock does not encrypt anything in the data folder.

## What happens next

This is a project run in spare time by one person. You should hear back within a week that the report arrived. A fix comes as soon as it is ready, in a new release, and the release notes say what was fixed. If you want to be credited, say so in the report.

## Dependencies and the Go toolchain

- CI runs `govulncheck` on every push to `main` and on every release tag. The build fails when a known vulnerability sits in code Pinned calls, in a Go module or in the Go standard library.
- A vulnerability that `govulncheck` reports as called is fixed and released within 7 days of it becoming known here: the module or the Go version is updated, or the call is removed.
- A vulnerability in a module that Pinned does not call, or one only in a part of a module Pinned does not use, is updated within 30 days of a fixed version coming out, or with the next release when that comes sooner.
- Everything else is kept current through Dependabot's weekly pull requests for the Go modules, the Go builder image and the GitHub Actions. A new version is proposed once it is 7 days old.

## Supported versions

Only the latest release gets security fixes. Upgrade with `docker compose pull` and `docker compose up -d`.
