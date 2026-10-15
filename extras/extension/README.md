# Pinned browser extension

Saves the page you are on to your own Pinned server. It works in Brave, Chrome, Edge and Firefox from the same folder.

- The toolbar button opens a small save popup: the page title (you can change it), the address, a note when the link is already saved, your three most recent folders, Choose another folder for the full list, Save to Inbox and Save. Enter saves, Escape closes.
- Right click a page or a link and pick Save to Pinned. The link goes to the Inbox. The toolbar button shows a check for two seconds, or `=` when the link was already saved, or `!` when the save failed.
- `Alt+Shift+S` opens the popup.

## Load it

You need the `extras/extension` folder, or the zip from your server at `/extras/pinned-extension.zip`, unpacked.

- Brave, Chrome, Edge: open `brave://extensions`, `chrome://extensions` or `edge://extensions`, switch on Developer mode, choose Load unpacked and pick the folder.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and pick `manifest.json` in the folder. Firefox removes temporary add-ons when it quits. Firefox 142 or newer.

## Set it up

1. In Pinned, create an API token.
2. Open the extension's options (right click the toolbar button, then Options).
3. Enter the address of your server, for example `https://bookmarks.example.com`, and the token.
4. Test checks the address and the token and shows how many folders it found. Save stores both in this browser.

When you save, the browser asks to allow access to that one server. Say yes.

## Shortcut

`Alt+Shift+S` opens the popup. To change it, open `chrome://extensions/shortcuts` (Brave and Edge have the same page), or in Firefox the gear menu on `about:addons`, then Manage Extension Shortcuts.

## Permissions and why

- `activeTab`: read the title and address of the tab you are on, only when you click the button or use the shortcut.
- `storage`: keep your address, your token and your three recent folders in this browser.
- `contextMenus`: the Save to Pinned item on pages and links.
- Access to your server: asked for when you save the options, for that one host only. The manifest lists `http://*/*` and `https://*/*` as optional, because the extension cannot know your address in advance; it never asks for more than the host you typed.

The extension talks to your server and nothing else. No analytics, no remote code, nothing from third parties. The Geist fonts are inside the folder.

## One manifest for every browser

Chrome runs `background.service_worker`, Firefox runs `background.scripts`. Chrome 121 and later ignore `scripts` in a Manifest V3 extension, and Firefox 121 and later ignore `service_worker` and start `scripts`, so one manifest with both serves both. Source: [MDN, manifest.json background, browser support](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background). Chrome lists the `browser_specific_settings` key as unrecognised and Firefox lint notes that `service_worker` is ignored; both are expected.

## Pack it

```sh
tools/pack-extension.sh
```

This writes `web/extras/pinned-extension.zip`, which the server offers at `/extras/pinned-extension.zip`. It runs from any directory and gives the same bytes for the same files.
