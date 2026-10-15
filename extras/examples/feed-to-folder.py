#!/usr/bin/env python3
"""Save every entry of an RSS or Atom feed into one folder of Pinned.

    feed-to-folder.py <feed url> <folder name>

Links that are already saved are counted and left alone, so running it again
only adds what is new. That makes it safe to run from cron. It prints one
line, for example: "Reading: 3 saved, 17 already saved, 0 failed".
Exit code 0 when nothing failed, 1 otherwise.

The address and the token come from the environment, PINNED_URL and
PINNED_TOKEN, or from ~/.config/pinned/env with these two lines:

    PINNED_URL=https://bookmarks.example.com
    PINNED_TOKEN=tk_your_token

Python 3 standard library only. Reads RSS 2.0 and Atom feeds.
"""

import json
import os
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

ATOM = "{http://www.w3.org/2005/Atom}"
ENV_FILE = os.path.expanduser("~/.config/pinned/env")


def settings():
    """PINNED_URL and PINNED_TOKEN, from the environment or the env file."""
    values = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                key, sep, value = line.strip().partition("=")
                if sep and key.strip() in ("PINNED_URL", "PINNED_TOKEN"):
                    values.setdefault(key.strip(), value.strip().strip("\"'"))
    url = os.environ.get("PINNED_URL") or values.get("PINNED_URL", "")
    token = os.environ.get("PINNED_TOKEN") or values.get("PINNED_TOKEN", "")
    if not url or not token:
        sys.exit("Set PINNED_URL and PINNED_TOKEN, or put them in " + ENV_FILE)
    return url.rstrip("/"), token


def call(base, token, method, path, body=None):
    """One API call. Returns the status code and the decoded JSON answer."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as err:
        # 409 and the other errors still carry a JSON body.
        try:
            return err.code, json.load(err)
        except ValueError:
            return err.code, {}


def feed_entries(feed_url):
    """The (link, title) pairs of a feed, in feed order."""
    req = urllib.request.Request(feed_url, headers={"User-Agent": "feed-to-folder/1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        root = ET.fromstring(resp.read())
    entries = []
    # RSS 2.0: <rss><channel><item><link>
    for item in root.iter("item"):
        link = (item.findtext("link") or "").strip()
        if link:
            entries.append((link, (item.findtext("title") or "").strip()))
    # Atom: <feed><entry><link rel="alternate" href>. A link without rel
    # counts as alternate.
    for entry in root.iter(ATOM + "entry"):
        link = ""
        for el in entry.findall(ATOM + "link"):
            if el.get("rel", "alternate") == "alternate" and el.get("href"):
                link = el.get("href").strip()
                break
        if link:
            entries.append((link, (entry.findtext(ATOM + "title") or "").strip()))
    return entries


def main():
    if len(sys.argv) != 3:
        sys.exit("Usage: feed-to-folder.py <feed url> <folder name>")
    feed_url, folder_name = sys.argv[1], sys.argv[2]
    base, token = settings()

    try:
        status, folders = call(base, token, "GET", "/api/folders")
    except urllib.error.URLError as err:
        sys.exit("Error: could not reach %s: %s" % (base, err.reason))
    if status != 200:
        sys.exit("Error: " + str(folders.get("error", "HTTP %d" % status)))
    # The first folder with that name, without regard to case.
    folder = next((f for f in folders if f["name"].casefold() == folder_name.casefold()), None)
    if folder is None:
        sys.exit('Error: no folder named "%s"' % folder_name)

    try:
        entries = feed_entries(feed_url)
    except ET.ParseError:
        sys.exit("Error: %s is not an RSS or Atom feed" % feed_url)
    except (urllib.error.URLError, ValueError) as err:
        sys.exit("Error: could not read the feed: %s" % err)

    saved = already = failed = 0
    for link, title in entries:
        status, answer = call(base, token, "POST", "/api/bookmarks",
                              {"url": link, "title": title, "folder_id": folder["id"]})
        if status == 201:
            saved += 1
        elif status == 409:
            already += 1
        else:
            failed += 1
            print("Failed: %s: %s" % (link, answer.get("error", "HTTP %d" % status)), file=sys.stderr)

    print("%s: %d saved, %d already saved, %d failed" % (folder["name"], saved, already, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
