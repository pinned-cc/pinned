# Save to Pinned, the iPhone shortcut

A shortcut for the share sheet. Share a page or a link to "Save to Pinned" and it lands in Pinned. Run it from the Shortcuts app or the home screen and it saves the link on the clipboard.

## What it does

1. Takes the link from the share sheet, or from the clipboard when there is no shared item.
2. Takes the page title when Safari shares a web page. Otherwise the title stays empty and the app uses the host.
3. Saves the link to Inbox. If it is already saved, it says "Already saved" and stops.
4. Shows one list: Inbox, then your folders by name. Pick one and the bookmark moves there, then it says "Saved to" and the folder. Cancel leaves it in Inbox.
5. Any other problem shows the app's error text, for example a wrong token.

It saves first and asks second because a shortcut stops completely when you cancel a list. Saving first means Cancel still keeps the link.

## Add it to your iPhone

1. On the iPhone, open `https://your.host/bookmarklet` in Safari.
2. Tap Add the Shortcut.
3. Answer the two questions: the address of your Pinned server (like `https://bookmarks.example.com`) and an API token. Create the token in the app under API tokens.

That is all. You never need to edit the actions. To change the address or token later, delete the shortcut and add it again.

On a Mac it is untested. The same signed file should import in the Shortcuts app from the downloaded `save-to-pinned.shortcut`, but nobody has tried it yet.

## Calls it makes

All with `Authorization: Bearer <token>`.

- `POST /api/bookmarks` with `{url, title}`. An `id` in the answer means saved, an `error` of "Already saved" means it was already there.
- `GET /api/folders` for the list.
- `PATCH /api/bookmarks/<id>` with `{folder_id}` to move it into the chosen folder.

If two folders have the same name, the list shows the name once per folder and both pick the last one with that name.

## Rebuild and re-sign

The source is `build.py`. It writes `save-to-pinned.plist`, a readable version of the shortcut. On a Mac:

```sh
python3 extras/shortcut/build.py --sign
```

This also signs it with `shortcuts sign --mode anyone` and writes `web/extras/save-to-pinned.shortcut`, which the app serves at `/extras/save-to-pinned.shortcut`. Signing for "anyone" lets the file be added from a download, from Files or by AirDrop, without an iCloud link. `shortcuts sign` only accepts the binary form with a `.shortcut` name, so the script makes that copy in a temporary folder before signing.

Nothing in the file names a person, an address or a token. Those come from the two questions when the shortcut is added.

## Sources

The action identifiers and parameter keys come from these, not from guesses:

- Cherri, a compiler for Shortcuts: action definitions in `actions/web.cherri`, `actions/basic.cherri`, `actions/text.cherri`, and the plist writer in `shortcutgen.go`, `shortcut.go`, `parser.go`, `variables.go` (import questions, condition codes 4, 99, 100, 101, dictionary item types, no input behaviour, share sheet type `ActionExtension`, icon colour and glyph numbers). https://github.com/electrikmilk/cherri
- shortcuts-js: `src/actions/getContentsOfURL.ts` (`ShowHeaders`, `Advanced`, `WFHTTPBodyType`, `WFJSONValues`), `conditional.ts`, `setVariable.ts`, `addToVariable.ts`, `exitShortcut.ts`, `showNotification.ts`, `src/utils/buildSerialization.ts`. https://github.com/joshfarrant/shortcuts-js
- `shortcuts help sign` on macOS for the signing modes.
