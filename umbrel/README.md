# Umbrel package, draft

These two files are the draft for a pull request to the Umbrel App Store, https://github.com/getumbrel/umbrel-apps. They are not used by anything in this repository. In the store they go into a folder named after the app id.

They follow the packaging rules in `.agents/skills/umbrel-package-app/SKILL.md` of that repository, read on 2026-10-13.

## What has to be filled in before the pull request

- The image digest. After the release image is built, run `docker buildx imagetools inspect ghcr.io/pinned-cc/pinned:<version>`, check that `linux/amd64` and `linux/arm64` are both listed, and put the index digest in place of `sha256:PLACEHOLDER`.
- The version, in `umbrel-app.yml` and in the image tag, to the release being packaged.
- The image must be public. GitHub makes a new package private; set it to public in the package settings and test `docker pull` while logged out.
- The icon, 256 by 256, and the gallery images. The store keeps them in a separate repository; `gallery` stays `[]` in the pull request, and the screenshots go in the pull request text.
- The store id, the folder name and `APP_HOST`. All three are `pinned`. If the id ever changes, change `id`, `name`, the folder and `APP_HOST: <id>_web_1` together.
- `submitter` and `submission`: the name to show in the store and the pull request link.
- The port, 9097. It did not appear in the store repository when searched on 2026-10-13. Check again before opening the pull request.

## Choices made here

- `deterministicPassword: true`, because the app's login password is `APP_PASSWORD`, which Umbrel sets per install and shows to the user.
- Umbrel's own login stays on. `PROXY_AUTH_WHITELIST` lets these paths through without it: `/api/*` for the extension and scripts, which send an API token; `/s/*` for share links; `/extras/*` for the extension download; `/health`; `/static/*` and `/favicon.svg`, which a share link page loads. Nothing on those paths answers with your bookmarks without the app password, a token, or a share link.
- `BASE_URL` points at the device address and the store port, so the Save button code and the search entry use it.
- Data lives in `${APP_DATA_DIR}/data`, mounted at `/data`.

Not tested on an Umbrel yet.
