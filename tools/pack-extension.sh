#!/bin/sh
# Packs extras/extension into web/extras/pinned-extension.zip.
# One manifest serves Chromium browsers and Firefox, so one zip serves both.
# Deterministic: sorted file list, fixed timestamps, no extra attributes. Works from any directory.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
src="$root/extras/extension"
out="$root/web/extras"
zipfile="$out/pinned-extension.zip"
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# copy without README and dot files, then pin every timestamp so the zip bytes depend only on the content
(cd "$src" && find . -type f ! -name 'README.md' ! -name '.*' | LC_ALL=C sort) > "$tmp/list"
while IFS= read -r f; do
  mkdir -p "$tmp/x/$(dirname "$f")"
  cp "$src/$f" "$tmp/x/$f"
done < "$tmp/list"
find "$tmp/x" -exec touch -h -t 202001010000 {} +
rm -f "$zipfile"
(cd "$tmp/x" && sed 's|^\./||' "$tmp/list" | zip -X -q -D "$zipfile" -@)
echo "$zipfile $(wc -c < "$zipfile" | tr -d ' ') bytes"
