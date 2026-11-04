window.FLOWS = [
 {
  "id": "01",
  "name": "First start and login",
  "steps": [
   {
    "n": "1",
    "text": "The owner starts the container with a password: APP_PASSWORD=... docker compose up -d.",
    "screens": [
     "term-start"
    ],
    "do": "Read the log line, then open the address.",
    "now": "works",
    "ev": "README.md, Install in five minutes; log \"pinned listening on :8080, data in /data\".",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "Without a password, with fewer than 8 characters, or with a common one, the server does not start and says why.",
    "screens": [
     "term-start-error"
    ],
    "do": "Set another password.",
    "now": "works",
    "ev": "Binary output: \"APP_PASSWORD is not set. Set it, or APP_PASSWORD_FILE ...\", \"APP_PASSWORD is shorter than 8 characters ...\" and, for Pinned2026! or password123, \"APP_PASSWORD is too easy to guess ...\" (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Opening the app without a login goes to the login page.",
    "screens": [
     "login"
    ],
    "do": "Type the password.",
    "now": "works",
    "ev": "GET / answers with /login?next=%2F (Chromium, all four sizes and themes).",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "A wrong password comes back with \"Wrong password.\" and the caret in the field.",
    "screens": [
     "login-error"
    ],
    "do": "Type it again.",
    "now": "works",
    "ev": "shot a01; /login?error=1; web/js/app.js:79.",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "The fifth wrong try says \"Wrong password. Wait 30 seconds before the next try.\", the next one \"Too many tries. Wait 30 seconds, then try again.\", and the right password during the wait names the time left, such as \"Wait 26 seconds\". The line does not count down.",
    "screens": [
     "login-wait"
    ],
    "do": "Wait, then log in.",
    "now": "friction",
    "ev": "shot f01-05-login-wait (FT 04.11); web/js/app.js:79-84.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "The right password lands on the empty Dashboard with Add bookmark, Import and How to save.",
    "screens": [
     "dash-empty"
    ],
    "do": "Pick a way to fill it.",
    "now": "works",
    "ev": "shot home-empty-desk-light.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "On the phone the same login, then Dashboard, Inbox and Folders tabs, the Settings gear, the search pill and the plus.",
    "screens": [
     "p-login",
     "p-dash-empty"
    ],
    "do": "Log in on the phone.",
    "now": "works",
    "ev": "shot home-empty-phone-dark; axe clean on login and Dashboard (phone).",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "Light and dark follow the system; the bulb switches and the choice is kept per browser.",
    "screens": [
     "dash"
    ],
    "do": "Click the bulb.",
    "now": "works",
    "ev": "web/js/theme.js:3-20; shots b18 (dark desktop), b21 (dark phone); WebKit dark: no overflow, axe clean.",
    "walk": "click"
   },
   {
    "n": "9",
    "text": "Password managers fill the login: the form carries a fixed user name.",
    "screens": [
     "login"
    ],
    "do": "Let the password manager fill it.",
    "now": "works",
    "ev": "web/login.html, hidden username field with autocomplete=\"username\".",
    "walk": "click"
   }
  ]
 },
 {
  "id": "02",
  "name": "Save a link, in the app, with the bookmarklet and with the extension",
  "steps": [
   {
    "n": "1",
    "text": "Add (desktop) or the plus (phone) opens the save sheet, the folder preset to the last one used.",
    "screens": [
     "add-sheet",
     "p-add"
    ],
    "do": "Paste an address.",
    "now": "works",
    "ev": "shots a10, b08; web/js/sheets.js:304-327.",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "An address typed without http, such as example.com, is refused on Save with \"Enter a full address starting with http or https.\", the caret at the end of the address. The extension options try https, then http.",
    "screens": [
     "add-noscheme"
    ],
    "do": "Type http:// in front.",
    "now": "friction",
    "ev": "shot f02-02-add-noscheme (FT 04.11); compare extras/extension/shared.js addressCandidates.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Typing the address again removes the old error at once; the live check alone says the link is new or already saved.",
    "screens": [
     "add-stale"
    ],
    "do": "Save.",
    "now": "works",
    "ev": "shot f02-03-04-add-dupe (FT 04.11); web/js/actions.js:291-295.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "An address already saved shows \"Already saved in Homelab. Save anyway moves it here.\" and the button turns into Save anyway.",
    "screens": [
     "add-dupe"
    ],
    "do": "Save anyway, or close.",
    "now": "works",
    "ev": "shot a12; GET /api/check.",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "The same host on another port is a new bookmark: Not saved yet.",
    "screens": [
     "add-newport"
    ],
    "do": "Give it a title.",
    "now": "works",
    "ev": "log-a: Jellyfin on :8096 next to :8080 saved as new.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "Choose another folder lists every folder and New folder.",
    "screens": [
     "add-picker"
    ],
    "do": "Pick a folder.",
    "now": "works",
    "ev": "shot a13.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "Save closes the sheet and the card appears in its folder. No toast; screen readers hear \"Saved in Homelab\".",
    "screens": [
     "folder-saved"
    ],
    "do": "Find the new card.",
    "now": "works",
    "ev": "shot a14; web/js/sheets.js:368-373.",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "Bookmarklet: How to save, Computer, drag Save to Pinned into the bookmarks bar.",
    "screens": [
     "howto-computer"
    ],
    "do": "Drag the button.",
    "now": "works",
    "ev": "shot a62; /bookmarklet; axe clean desktop and phone.",
    "walk": "click"
   },
   {
    "n": "9",
    "text": "On any page Save to Pinned opens /save in a small window with title, address, recent folders and Log out.",
    "screens": [
     "browser-page",
     "save-page"
    ],
    "do": "Check the folder, Save.",
    "now": "works",
    "ev": "shot a64; WebKit desktop and phone: no overflow, no console errors.",
    "walk": "click"
   },
   {
    "n": "10",
    "text": "Saving draws a tick and closes the window; where the browser keeps it open, a Saved state with Done.",
    "screens": [
     "save-done"
    ],
    "do": "Done.",
    "now": "works",
    "ev": "shot a65; web/js/sheets.js:371-383.",
    "walk": "click"
   },
   {
    "n": "11",
    "text": "Extension: How to save, Extension: download, unzip, load unpacked; \"a token\" opens API tokens. Firefox removes it when it quits, so after a restart it is loaded again with a new token.",
    "screens": [
     "howto-extension"
    ],
    "do": "Download, load, then follow a token.",
    "now": "works",
    "ev": "shot f02-11-howto-extension (FT 04.11); web/bookmarklet.html.",
    "walk": "click"
   },
   {
    "n": "12",
    "text": "With a token made (flow 09), the extension options take the address and the token.",
    "screens": [
     "ext-options"
    ],
    "do": "Type the address.",
    "now": "works",
    "ev": "shot e02.",
    "walk": "click"
   },
   {
    "n": "13",
    "text": "A home address typed as most people write it, 10.0.0.5:9095, tries https, then http, and Test says \"Connected to http://10.0.0.5:9095, 5 folders.\" An address typed with http:// for a host outside the own network first says \"On plain http your token may cross the internet unencrypted. Use https, or click Test again to connect anyway.\" (Save: \"click Save again to save anyway\") and goes ahead on a second click of the same button.",
    "screens": [
     "ext-options-ok",
     "ext-options-plain"
    ],
    "do": "Click again, or type https.",
    "now": "works",
    "ev": "shot f02-13-ext-options-noscheme (FT 04.11); the warning from 0.1.12: extras/extension/options.js holdForPlain, tools/extension.test.mjs.",
    "walk": "click"
   },
   {
    "n": "14",
    "text": "With http:// Test says \"Connected, 5 folders\"; Save stores both and asks the browser for access to that host.",
    "screens": [
     "ext-options-ok"
    ],
    "do": "Allow access.",
    "now": "works",
    "ev": "shots e04, e06. The permission prompt itself cannot show in headless Chromium; the status waits for it.",
    "walk": "click"
   },
   {
    "n": "15",
    "text": "The toolbar button or Option Shift S opens the popup: title selected, address, three recent folders, Save to Inbox.",
    "screens": [
     "ext-popup",
     "ext-popup-picker"
    ],
    "do": "Pick a folder, Save.",
    "now": "works",
    "ev": "shots e07, e08; saved bookmark checked in GET /api/state.",
    "walk": "click"
   },
   {
    "n": "16",
    "text": "Saved: the tick draws and the popup closes.",
    "screens": [
     "ext-saved"
    ],
    "do": "Nothing.",
    "now": "works",
    "ev": "log-e \"popup closed itself\".",
    "walk": "click"
   },
   {
    "n": "17",
    "text": "The same page again: \"Already saved in Homelab / Network.\" with Save anyway.",
    "screens": [
     "ext-popup-dupe"
    ],
    "do": "Close.",
    "now": "works",
    "ev": "shot e10.",
    "walk": "click"
   },
   {
    "n": "18",
    "text": "On a browser page: \"This page cannot be saved\".",
    "screens": [
     "ext-popup-cannot"
    ],
    "do": "Close.",
    "now": "works",
    "ev": "shot e11.",
    "walk": "click"
   },
   {
    "n": "19",
    "text": "The popup and options are always dark, while the app and its pages follow light and dark since 0.1.11.",
    "screens": [
     "ext-popup"
    ],
    "do": "Notice the mismatch.",
    "now": "friction",
    "ev": "shot e07 with the system in light; extras/extension/ui.css:17 color-scheme:dark.",
    "walk": "click"
   },
   {
    "n": "20",
    "text": "Right click a page or link, Save to Pinned: it goes to the Inbox and the button shows a tick, = when already saved, ! on failure.",
    "screens": [
     "ext-context"
    ],
    "do": "Right click.",
    "now": "works",
    "ev": "extras/extension/background.js:25-52. Read from the code; context menus cannot be driven headless.",
    "walk": "click"
   },
   {
    "n": "21",
    "text": "iPhone and Android: How to save shows the Safari bookmark and the home screen share target.",
    "screens": [
     "howto-iphone"
    ],
    "do": "Follow the steps on the phone.",
    "now": "works",
    "ev": "shot b16; log-b howto iPhone and Android.",
    "walk": "click"
   }
  ]
 },
 {
  "id": "03",
  "name": "Find and open",
  "steps": [
   {
    "n": "1",
    "text": "/ or Command K or a click on the search field opens the search over the blurred app, with recent opens.",
    "screens": [
     "palette"
    ],
    "do": "Type.",
    "now": "works",
    "ev": "shot a15; web/js/keys.js:45 and :54.",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "Typing filters by title, address and host, grouped by folder, the first hit marked.",
    "screens": [
     "palette-results"
    ],
    "do": "Arrow to a hit.",
    "now": "works",
    "ev": "shot a16.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Enter opens the marked link in a new tab and records it for Recently opened.",
    "screens": [
     "palette-results",
     "open-tab"
    ],
    "do": "Press Enter.",
    "now": "works",
    "ev": "dbg run: new page event after Enter; web/js/palette.js:87.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "No match: \"No matches.\"",
    "screens": [
     "palette-none"
    ],
    "do": "Change the query.",
    "now": "works",
    "ev": "shot a17.",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "Escape clears the query first, a second Escape closes the search.",
    "screens": [
     "palette"
    ],
    "do": "Press Escape twice.",
    "now": "works",
    "ev": "web/js/palette.js:166.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "From the browser address bar: /search?q=portainer opens the app with that search.",
    "screens": [
     "palette-bar"
    ],
    "do": "Pick the hit.",
    "now": "works",
    "ev": "shot a18; internal/server/pages.go:137-139.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "A click on a card opens the link in a new tab; Command click opens it behind.",
    "screens": [
     "folder",
     "open-tab"
    ],
    "do": "Click a card.",
    "now": "works",
    "ev": "web/js/actions.js:171-178.",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "The Dashboard keeps the pinned row and Recently opened, else Recently saved.",
    "screens": [
     "dash"
    ],
    "do": "Read the Dashboard.",
    "now": "works",
    "ev": "shots a06, a45.",
    "walk": "click"
   },
   {
    "n": "9",
    "text": "On the phone the search pill opens the same search as a sheet.",
    "screens": [
     "p-search"
    ],
    "do": "Type.",
    "now": "works",
    "ev": "shot b09.",
    "walk": "click"
   },
   {
    "n": "10",
    "text": "Links in a locked folder never show in search.",
    "screens": [
     "palette-locked"
    ],
    "do": "Search for one.",
    "now": "works",
    "ev": "shot a51 (\"bank\" in locked Finance: No matches).",
    "walk": "click"
   },
   {
    "n": "11",
    "text": "After a very large import, All bookmarks draws the first 240 cards with \"Show all 100000\" in under a second; Show all and scrolling keep every frame short, and the search finds any link.",
    "screens": [
     "all-big"
    ],
    "do": "Show all, or search.",
    "now": "works",
    "ev": "shots f03-11-all-big, f03-11-all-big-showall (FT 04.11): 100000 links drawn in 919 ms, longest frame 83 ms, after Show all 142 ms.",
    "walk": "click"
   }
  ]
 },
 {
  "id": "04",
  "name": "Organise folders",
  "steps": [
   {
    "n": "1",
    "text": "The plus next to Folders, or N, opens New folder; Create opens the new empty folder.",
    "screens": [
     "new-folder",
     "folder-empty"
    ],
    "do": "Name it, Enter.",
    "now": "works",
    "ev": "shots a26, a27; web/js/actions.js:68-72.",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "The empty folder offers Add bookmarks, a picker of links saved elsewhere.",
    "screens": [
     "folder-empty",
     "add-to"
    ],
    "do": "Tick two, Move 2 to Media.",
    "now": "works",
    "ev": "shot a29.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Moving them shows \"Moved 2 to Media\" with Undo.",
    "screens": [
     "folder-filled"
    ],
    "do": "Read the toast.",
    "now": "works",
    "ev": "shot a30.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "The folder three dots: Share first, then Add bookmarks, New folder inside, Rename, Move to, Hide from Recent, Lock with a password, Delete.",
    "screens": [
     "folder-menu"
    ],
    "do": "Pick Share.",
    "now": "works",
    "ev": "shot f04-04-folder-menu (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "Move to moves a folder under another or to the top level.",
    "screens": [
     "fmove"
    ],
    "do": "Pick Top level.",
    "now": "works",
    "ev": "shot a31.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "A card shows Share, Open, Trash and More on hover; More holds Move, Copy, Share, Trash, Open, Rename, Pin.",
    "screens": [
     "folder-hover",
     "tile-menu"
    ],
    "do": "Open More.",
    "now": "works",
    "ev": "shots a19, a20.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "Move from the card's More or the selection bar says \"Moved to Work\" with Undo, as a drag onto a folder does; Undo puts it back.",
    "screens": [
     "move-sheet",
     "folder-moved"
    ],
    "do": "Pick a folder.",
    "now": "works",
    "ev": "shot f04-07-moved (FT 04.11); web/js/actions.js moveWithUndo.",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "Dragging a card onto a folder in the sidebar moves it with Undo.",
    "screens": [
     "folder-drag",
     "folder-dragged"
    ],
    "do": "Drag.",
    "now": "works",
    "ev": "web/js/drag.js and web/js/actions.js:98-102. Read from the code, not dragged in this run.",
    "walk": "click"
   },
   {
    "n": "9",
    "text": "Rename in place: F2 or the menu, Enter saves, Escape cancels.",
    "screens": [
     "rename"
    ],
    "do": "Type, Enter.",
    "now": "works",
    "ev": "web/js/actions.js:55-66.",
    "walk": "click"
   },
   {
    "n": "10",
    "text": "Trash on a card: \"Moved to Trash\" with Undo.",
    "screens": [
     "trash-toast"
    ],
    "do": "Undo or go on.",
    "now": "works",
    "ev": "shot a22.",
    "walk": "click"
   },
   {
    "n": "11",
    "text": "Trash keeps links 30 days; a card offers Restore and Delete now, which asks first; Empty trash asks first.",
    "screens": [
     "trash",
     "trash-menu",
     "purge-confirm",
     "empty-confirm"
    ],
    "do": "Empty trash.",
    "now": "works",
    "ev": "shots a23, a24, a25.",
    "walk": "click"
   },
   {
    "n": "12",
    "text": "Delete folder asks first and says where its links go: \"Delete Media? 2 bookmarks go to Trash.\"",
    "screens": [
     "delete-folder"
    ],
    "do": "Cancel or Delete folder.",
    "now": "works",
    "ev": "shot a32.",
    "walk": "click"
   },
   {
    "n": "13",
    "text": "With More open at 1280 by 800 the folder list keeps 4 of 5 folders in view and the actions scroll in their own space. The folder list's scroll bar is hidden, so the fifth folder gives no sign, and More stays open after a reload.",
    "screens": [
     "dash-more"
    ],
    "do": "Look for Work.",
    "now": "friction",
    "ev": "shot f04-13-dash-more (FT 04.11); web/app.css scrollbar-width:none.",
    "walk": "click"
   },
   {
    "n": "14",
    "text": "Phone: Folders tab, a folder, the three dots as a sheet.",
    "screens": [
     "p-folders",
     "p-folder",
     "p-folder-sheet"
    ],
    "do": "Open a folder.",
    "now": "works",
    "ev": "shots b03, b04, b05.",
    "walk": "click"
   },
   {
    "n": "15",
    "text": "Phone: a tap opens the link; Move, Rename and Trash come only after a long press starts selecting, and nothing on screen says so.",
    "screens": [
     "p-folder",
     "p-select"
    ],
    "do": "Hold a card.",
    "now": "friction",
    "ev": "web/js/render.js:258-261 (the card is a plain link), web/js/drag.js:134-142 (hold selects).",
    "walk": "click"
   }
  ]
 },
 {
  "id": "05",
  "name": "Locked folders",
  "steps": [
   {
    "n": "1",
    "text": "Folder actions, Lock with a password: Password, Repeat password, a Close button, and 6 px below the second field the note \"Use at least 8 characters. Links in this folder stay out of sight everywhere until you unlock it. The password cannot be recovered.\"",
    "screens": [
     "lock-sheet"
    ],
    "do": "Type it twice.",
    "now": "works",
    "ev": "shot f05-01-lock-sheet (FT 04.11); the gap from 0.1.12: web/app.css .fld + .sh-text, tools/ui-test.mjs S23.10.",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "Fewer than 8 characters, two that differ, or one too easy to guess are named under the fields: \"Use at least 8 characters.\", \"The passwords do not match.\", \"This password is too easy to guess. Choose another one.\"",
    "screens": [
     "lock-error"
    ],
    "do": "Fix it.",
    "now": "works",
    "ev": "shot f05-02-lock-error (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Lock goes back to the Dashboard with \"Folder locked\"; the sidebar shows the name with a lock and no count.",
    "screens": [
     "locked"
    ],
    "do": "Read the sidebar.",
    "now": "works",
    "ev": "shot a45.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "A locked folder is gone from search, Recent and the counts.",
    "screens": [
     "palette-locked"
    ],
    "do": "Search.",
    "now": "works",
    "ev": "shot a51.",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "A click on it opens Unlock; a wrong password says \"Wrong password\"; the right one opens it for 10 minutes.",
    "screens": [
     "unlock",
     "unlock-wrong",
     "unlocked"
    ],
    "do": "Type the folder password.",
    "now": "works",
    "ev": "shots a46, a47, a48.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "The lock, unlock and remove lock dialogs have a Close button in the head, 44 by 44; Escape and a tap outside close them too.",
    "screens": [
     "unlock"
    ],
    "do": "Close.",
    "now": "works",
    "ev": "shot f05-07-remove-lock (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "Unlocked, the folder actions offer Relock now and Remove lock, which asks the app password.",
    "screens": [
     "unlocked-menu",
     "remove-lock"
    ],
    "do": "Relock now.",
    "now": "works",
    "ev": "shots a49, a50.",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "On the phone the lock dialog note sits 6 px below the Repeat password field, as on the desktop.",
    "screens": [
     "p-lock"
    ],
    "do": "Read the note.",
    "now": "works",
    "ev": "shot f05-08-phone-lock (FT 04.11, the 6 px overlap of 0.1.11); fixed in 0.1.12: web/app.css .fld + .sh-text, tools/ui-test.mjs S23.10.",
    "walk": "click"
   }
  ]
 },
 {
  "id": "06",
  "name": "Share links",
  "steps": [
   {
    "n": "1",
    "text": "In a folder the link glyph by the title opens Share.",
    "screens": [
     "reading",
     "share-off"
    ],
    "do": "Turn on Share with a link.",
    "now": "works",
    "ev": "shot a33 (see 04.4 for finding it).",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "On: the link with Copy, and Share where the system has a share sheet.",
    "screens": [
     "share-on"
    ],
    "do": "Copy.",
    "now": "works",
    "ev": "shot a34; link of the form /s/#token.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Copy says \"Copied\".",
    "screens": [
     "share-copied"
    ],
    "do": "Paste it to someone.",
    "now": "works",
    "ev": "log-a \"Copied\".",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "Share with a password: \"Use at least 8 characters.\" sits under the field before Set; a shorter one then says \"A share password needs at least 8 characters.\"",
    "screens": [
     "share-pw",
     "share-pw-error"
    ],
    "do": "Type 8 or more.",
    "now": "works",
    "ev": "shots f06-04-share-pw, f06-04-share-pw-error (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "Set: Locked with Change and Remove; Expires Never, 1, 7 or 30 days with the end date; \"Not opened yet\".",
    "screens": [
     "share-set"
    ],
    "do": "Pick 7 days.",
    "now": "works",
    "ev": "shot a36.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "The visitor gets the folder name and Password; a wrong one says \"Wrong password.\"; the right one shows the cards with a search.",
    "screens": [
     "visitor-pw",
     "visitor-wrong",
     "visitor-open"
    ],
    "do": "Open the link in another browser.",
    "now": "works",
    "ev": "shots a38, a39, a40.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "On a phone the visitor page is the same.",
    "screens": [
     "p-visitor"
    ],
    "do": "Open it on a phone.",
    "now": "works",
    "ev": "shot a41.",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "Share with a link off asks \"Stop sharing?\"; afterwards the visitor sees \"This link does not work.\"",
    "screens": [
     "stop-share",
     "visitor-revoked"
    ],
    "do": "Stop sharing.",
    "now": "works",
    "ev": "shots a42, a43.",
    "walk": "click"
   },
   {
    "n": "9",
    "text": "Locking a shared folder ends its link, and the lock sheet says so.",
    "screens": [
     "lock-sheet"
    ],
    "do": "Read the lock sheet.",
    "now": "works",
    "ev": "web/js/sheets.js:87.",
    "walk": "click"
   }
  ]
 },
 {
  "id": "07",
  "name": "Import and export",
  "steps": [
   {
    "n": "1",
    "text": "More in the sidebar (desktop) or Settings (phone), Import, pick a browser bookmarks file.",
    "screens": [
     "dash-more",
     "p-settings"
    ],
    "do": "Pick the file.",
    "now": "works",
    "ev": "shot a02; accept=\".html,.htm,text/html\".",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "While it runs a toast says \"Importing. This can take a moment for a big file.\" and every Import is disabled and busy. 100000 links (17.4 MB) take about 9 seconds.",
    "screens": [
     "import-running"
    ],
    "do": "Wait.",
    "now": "works",
    "ev": "log-big 07.2 (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Done: \"Imported 15, skipped 0\", folders kept.",
    "screens": [
     "imported"
    ],
    "do": "Look through the folders.",
    "now": "works",
    "ev": "shot a03.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "The same file again: \"Imported 0, skipped 15\".",
    "screens": [
     "imported"
    ],
    "do": "Nothing.",
    "now": "works",
    "ev": "log-a import2.",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "A file that is not a bookmarks file: \"Not a bookmark file.\"; folders more than 256 deep: \"The folders in this file nest more than 256 deep. Pinned cannot import it.\"",
    "screens": [
     "import-bad"
    ],
    "do": "Export again from the browser.",
    "now": "works",
    "ev": "shots a04, a05; POST /api/import answers 400.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "Export downloads bookmarks.html.",
    "screens": [
     "export"
    ],
    "do": "Open the file.",
    "now": "works",
    "ev": "log-a export name bookmarks.html.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "With a folder locked in this browser the export leaves it out and says so: \"Exported without Finance: it is locked. Unlock it first to include it.\"",
    "screens": [
     "export"
    ],
    "do": "Unlock it first, or keep the file.",
    "now": "works",
    "ev": "shot f07-07-export (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "The nightly export/bookmarks.html in the data folder holds everything, locked folders too.",
    "screens": [
     "term-backup"
    ],
    "do": "Copy it with the backup.",
    "now": "works",
    "ev": "README.md, Your data and backups.",
    "walk": "click"
   }
  ]
 },
 {
  "id": "08",
  "name": "Second factor and Signed in",
  "steps": [
   {
    "n": "1",
    "text": "The owner makes a secret, sets TOTP_SECRET, restarts and adds it to the authenticator by hand; a bad secret stops the start with a message.",
    "screens": [
     "term-totp"
    ],
    "do": "Open the login.",
    "now": "works",
    "ev": "README.md, Second factor; binary output for TOTP_SECRET=ABC.",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "The login shows Password and Code; Enter in the password moves to the code.",
    "screens": [
     "login-code"
    ],
    "do": "Type the code.",
    "now": "works",
    "ev": "shot c01; web/js/app.js:82.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "A wrong code says \"Wrong password or code. A code works once: wait for the next one.\" and both fields are empty again.",
    "screens": [
     "login-code-error"
    ],
    "do": "Type both again.",
    "now": "friction",
    "ev": "shot f08-03-login-code-error (FT 04.11); internal/server/pages.go:89-109 (redirect, the form is lost).",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "The same code used in a second browser inside its 30 seconds is refused with \"A code works once: wait for the next one.\"",
    "screens": [
     "login-code-error"
    ],
    "do": "Wait for the next code.",
    "now": "works",
    "ev": "shot f08-04-same-code (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "After 5 wrong codes in a row: \"Wrong password or code. Wait 60 seconds before the next try.\", then \"Too many tries. Wait 59 seconds, then try again.\"; the right code during the hold names the time left, and after the wait it logs in.",
    "screens": [
     "login-wait"
    ],
    "do": "Wait the time it names.",
    "now": "works",
    "ev": "shots f08-05-hold-5, f08-05-right-during-hold (FT 04.11); log security event=totp.wait.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "Browsers logged in before stay logged in; API tokens need no code.",
    "screens": [
     "dash"
    ],
    "do": "Nothing.",
    "now": "works",
    "ev": "README.md, Second factor.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "More, Signed in: each browser with its sign in day and last use, this one marked.",
    "screens": [
     "sessions"
    ],
    "do": "Find the other one.",
    "now": "works",
    "ev": "shot a57.",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "Two browsers of one kind read the same, \"Chrome on macOS\", with no address or place to tell them apart.",
    "screens": [
     "sessions"
    ],
    "do": "Guess which one.",
    "now": "friction",
    "ev": "shot a57; web/js/sheets.js:231.",
    "walk": "click"
   },
   {
    "n": "9",
    "text": "Sign out, or Sign out all others, asks for the app password; a wrong one says \"Wrong password\".",
    "screens": [
     "sessions-confirm",
     "sessions-wrong"
    ],
    "do": "Type the app password.",
    "now": "works",
    "ev": "shot a58.",
    "walk": "click"
   },
   {
    "n": "10",
    "text": "Done: \"Other browsers signed out\".",
    "screens": [
     "sessions-done"
    ],
    "do": "Close.",
    "now": "works",
    "ev": "shot a59.",
    "walk": "click"
   },
   {
    "n": "11",
    "text": "The signed out browser keeps showing every bookmark until it next asks the server for something.",
    "screens": [
     "signed-out-other"
    ],
    "do": "Look at the other screen.",
    "now": "friction",
    "ev": "shot a60.",
    "walk": "click"
   },
   {
    "n": "12",
    "text": "Lost the authenticator: remove TOTP_SECRET and restart.",
    "screens": [
     "term-totp"
    ],
    "do": "Restart.",
    "now": "works",
    "ev": "README.md, Second factor.",
    "walk": "click"
   }
  ]
 },
 {
  "id": "09",
  "name": "API tokens",
  "steps": [
   {
    "n": "1",
    "text": "More, API tokens (or \"a token\" on How to save): the empty state says what a token can and cannot do.",
    "screens": [
     "tokens-empty"
    ],
    "do": "Name it.",
    "now": "works",
    "ev": "shot a52.",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "Name and app password, Create; a wrong password says \"Wrong password\" and keeps the name.",
    "screens": [
     "tokens-wrong"
    ],
    "do": "Type the right one.",
    "now": "works",
    "ev": "shot a53.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "The token shows once with Copy and \"Copy it now. It is not shown again.\"",
    "screens": [
     "token-created"
    ],
    "do": "Copy.",
    "now": "works",
    "ev": "shot a54.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "After Create the sheet says \"Next, paste it into the extension's options with the address\" of this server \"or into your script.\" The form is gone: a second token needs the sheet closed and opened again.",
    "screens": [
     "token-created"
    ],
    "do": "Close, reopen.",
    "now": "friction",
    "ev": "shot f09-03-token-created (FT 04.11).",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "The token reads folders (200) and cannot export (403).",
    "screens": [
     "term-curl"
    ],
    "do": "Run the script.",
    "now": "works",
    "ev": "log-a \"token GET folders 200\", \"token export 403\".",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "The list shows when each token was made and last used.",
    "screens": [
     "tokens-list"
    ],
    "do": "Read it.",
    "now": "works",
    "ev": "shot a55.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "Revoke asks in the row, then \"Token revoked\"; the token now answers 401.",
    "screens": [
     "token-revoke"
    ],
    "do": "Revoke.",
    "now": "works",
    "ev": "shot a56; log-a \"revoked token GET 401\".",
    "walk": "click"
   }
  ]
 },
 {
  "id": "10",
  "name": "Settings",
  "steps": [
   {
    "n": "1",
    "text": "Every setting is an environment variable in the compose file.",
    "screens": [
     "term-env"
    ],
    "do": "Edit, docker compose up -d.",
    "now": "works",
    "ev": "README.md, Settings table.",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "Phone: the gear opens Settings with How to save, API tokens and their count, Import, Export, What's new, Source, Signed in, Log out.",
    "screens": [
     "p-settings"
    ],
    "do": "Open a row.",
    "now": "works",
    "ev": "shot b10b; axe clean.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Desktop: the same under More in the sidebar.",
    "screens": [
     "dash-more"
    ],
    "do": "Open More.",
    "now": "works",
    "ev": "shot a02.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "What's new shows the changelog, the last three releases open and older ones folded; the release you run is marked \"This version\", also on a release image whose version starts with v.",
    "screens": [
     "whats-new"
    ],
    "do": "Read.",
    "now": "works",
    "ev": "shot f10-04-whats-new (FT 04.11, no mark on v0.1.11); the mark from 0.1.12: web/js/sheets.js releaseHTML, tools/ui-test.mjs S23.13.",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "A new APP_PASSWORD ends every login, token and device cookie after the restart.",
    "screens": [
     "term-env"
    ],
    "do": "Make new tokens.",
    "now": "works",
    "ev": "README.md, Changing the password.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "Log out goes back to the login page.",
    "screens": [
     "login"
    ],
    "do": "Log in again.",
    "now": "works",
    "ev": "log-a \"after logout: /login\".",
    "walk": "click"
   }
  ]
 },
 {
  "id": "11",
  "name": "Backup and going back a version",
  "steps": [
   {
    "n": "1",
    "text": "Backing up: sqlite3 .backup, or stop, copy the data folder, start.",
    "screens": [
     "term-backup"
    ],
    "do": "Copy.",
    "now": "works",
    "ev": "README.md, Backing up. Not run.",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "Upgrading names the copy in the log: \"database: upgrading from schema 6 to 12; the database as it was is saved at .../bookmarks-schema6-....db\".",
    "screens": [
     "term-upgrade"
    ],
    "do": "Note the file.",
    "now": "works",
    "ev": "Run: 0.1.10 data folder started with ad2cb8e.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "Going back, 0.1.10 refuses: \"database was written by a newer Pinned (schema 12); this version knows 6. Update the image or restore a backup.\" It names no file. From 0.1.11 on, a version that refuses a newer database names the copy to restore and the README section.",
    "screens": [
     "term-downgrade"
    ],
    "do": "Find the README section.",
    "now": "friction",
    "ev": "log-upgrade 11.3 (FT 04.11); internal/store/store.go:214-220.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "Restoring as the README says (move bookmarks.db aside, copy the schema 6 file in, no -wal or -shm) brings 0.1.10 back with all 15 bookmarks and 5 folders.",
    "screens": [
     "term-restore"
    ],
    "do": "Start the older image.",
    "now": "works",
    "ev": "Run: GET /api/state on 0.1.10 after the restore.",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "Links saved after the upgrade are not in that copy; the README says to export them first.",
    "screens": [
     "term-restore"
    ],
    "do": "Export before going back.",
    "now": "works",
    "ev": "README.md, Going back to an older version.",
    "walk": "click"
   }
  ]
 },
 {
  "id": "12",
  "name": "Errors",
  "steps": [
   {
    "n": "1",
    "text": "Wrong password, and the wait after 5 tries with the time left (01.4, 01.5).",
    "screens": [
     "login-error",
     "login-wait"
    ],
    "do": "See flow 01.",
    "now": "works",
    "ev": "shots f01-04-login-wrong, f01-05-login-wait (FT 04.11).",
    "walk": "start"
   },
   {
    "n": "2",
    "text": "The server stops while the app is open: Save says \"Cannot reach your Pinned server. Check your connection, then try again.\"",
    "screens": [
     "save-down"
    ],
    "do": "Try again when it is back.",
    "now": "works",
    "ev": "shot f12-02-save-down (FT 04.11); web/js/api.js.",
    "walk": "click"
   },
   {
    "n": "3",
    "text": "The cards stay on screen, dimmed, under \"Cannot reach your Pinned server.\" with Retry. On the phone, when the server cannot be reached at the first load, the head with the bulb and the Settings gear shows above the tabs and the notice.",
    "screens": [
     "notice-down",
     "p-notice-down"
    ],
    "do": "Retry, or open Settings.",
    "now": "works",
    "ev": "shot f12-03-notice-down (FT 04.11); the phone head from 0.1.12: web/js/render.js phoneRecents, tools/ui-test.mjs S23.7.",
    "walk": "click"
   },
   {
    "n": "4",
    "text": "Retry while still down shows the same notice.",
    "screens": [
     "notice-down"
    ],
    "do": "Wait.",
    "now": "works",
    "ev": "shot c13.",
    "walk": "click"
   },
   {
    "n": "5",
    "text": "A reload while down shows the browser's own error page.",
    "screens": [
     "browser-down"
    ],
    "do": "Start the server.",
    "now": "works",
    "ev": "ERR_CONNECTION_REFUSED.",
    "walk": "click"
   },
   {
    "n": "6",
    "text": "A bad import file is refused with a message (07.5).",
    "screens": [
     "import-bad"
    ],
    "do": "See flow 07.",
    "now": "works",
    "ev": "shots a04, a05.",
    "walk": "click"
   },
   {
    "n": "7",
    "text": "A login that ended elsewhere sends the next request to /login?next=..., back to the same place after logging in.",
    "screens": [
     "login"
    ],
    "do": "Log in.",
    "now": "works",
    "ev": "web/js/api.js, 401 handling.",
    "walk": "click"
   },
   {
    "n": "8",
    "text": "A revoked or expired share link says \"This link does not work.\"",
    "screens": [
     "visitor-revoked"
    ],
    "do": "Ask the owner.",
    "now": "works",
    "ev": "shot a43.",
    "walk": "click"
   }
  ]
 }
];
window.TITLES = {
 "term-start": "Terminal, first start with docker compose",
 "term-start-error": "Terminal, start refused: no password, a short one, a data folder it cannot write",
 "login": "Login",
 "login-error": "Login, wrong password",
 "login-wait": "Login, wait after wrong tries, with the time the server sent",
 "login-code": "Login with the second factor",
 "login-code-error": "Login, wrong code, both fields emptied",
 "p-login": "Phone, login",
 "dash-empty": "Dashboard, first visit, nothing saved",
 "p-dash-empty": "Phone, Dashboard, nothing saved",
 "dash": "Dashboard",
 "dash-more": "Dashboard, sidebar More open, four folders in view, the actions scroll",
 "all": "All bookmarks",
 "inbox": "Inbox",
 "open-tab": "The link opened in a new tab",
 "p-dash": "Phone, Dashboard",
 "palette": "Search, empty, recent opens",
 "palette-results": "Search, matches grouped by folder",
 "palette-none": "Search, no matches",
 "palette-bar": "Search opened from the browser address bar",
 "palette-locked": "Search, a locked folder stays hidden",
 "p-search": "Phone, search",
 "all-big": "All bookmarks after a 100000 link import, page frozen",
 "add-sheet": "Add, the save sheet",
 "add-noscheme": "Add, address without http refused",
 "add-stale": "Add, address fixed, the old error is gone",
 "add-dupe": "Add, already saved",
 "add-newport": "Add, same host on another port is new",
 "add-picker": "Add, every folder",
 "folder-saved": "Saved, the card is in the folder",
 "p-add": "Phone, Add sheet",
 "howto-computer": "How to save, Computer",
 "howto-extension": "How to save, Extension",
 "howto-iphone": "How to save, iPhone and Android",
 "save-page": "Save page from the bookmarklet (/save)",
 "save-done": "Save page, saved, window closes or shows Done",
 "browser-page": "Any web page with the Save to Pinned button",
 "ext-options": "Extension options, empty",
 "ext-options-fail": "Extension options, nothing answers, Test names both addresses it tried",
 "ext-options-ok": "Extension options, the address as typed, Test found it on http",
 "ext-options-plain": "Extension options, an http:// address outside the own network: Test warns first, a second click connects",
 "ext-popup-nosetup": "Extension popup before setup",
 "ext-popup": "Extension popup",
 "ext-popup-picker": "Extension popup, every folder",
 "ext-saved": "Extension popup, saved, tick, popup closes",
 "ext-popup-dupe": "Extension popup, already saved",
 "ext-popup-cannot": "Extension popup on a browser page",
 "ext-context": "Extension, right click Save to Pinned, badge",
 "folder": "Folder, Homelab",
 "folder-hover": "Folder, card actions on hover",
 "tile-menu": "Card, More menu",
 "move-sheet": "Move, folder picker",
 "folder-moved": "Moved from the sheet: toast with Undo",
 "folder-drag": "Drag a card onto a sidebar folder",
 "folder-dragged": "Dropped on a folder: toast with Undo",
 "rename": "Rename in place",
 "trash-toast": "Moved to Trash, toast with Undo",
 "trash": "Trash",
 "trash-menu": "Trash, card menu",
 "purge-confirm": "Delete now, asks first",
 "empty-confirm": "Empty trash, asks first",
 "new-folder": "New folder sheet",
 "folder-empty": "New folder, empty",
 "add-to": "Add bookmarks to Media, pick existing ones",
 "folder-filled": "Media with the two links, toast with Undo",
 "folder-menu": "Folder actions, Share first",
 "folder-menu-media": "Folder actions for Media",
 "fmove": "Move a folder",
 "delete-folder": "Delete a folder, asks first",
 "p-folders": "Phone, Folders",
 "p-folder": "Phone, a folder",
 "p-folder-sheet": "Phone, folder actions sheet",
 "p-select": "Phone, selecting after a long press",
 "lock-sheet": "Lock with a password",
 "lock-error": "Lock, passwords too short or not matching",
 "locked": "Locked, back on the Dashboard",
 "unlock": "Unlock dialog, with a close button",
 "unlock-wrong": "Unlock, wrong password",
 "unlocked": "Finance unlocked for 10 minutes",
 "unlocked-menu": "Unlocked folder actions: Relock now, Remove lock",
 "remove-lock": "Remove lock, asks the app password",
 "p-lock": "Phone, lock dialog, the note below the field",
 "reading": "Folder, Reading",
 "share-off": "Share, off",
 "share-on": "Share, link on",
 "share-copied": "Share, link copied",
 "share-pw": "Share, password field",
 "share-pw-error": "Share, password too short",
 "share-set": "Share, locked, expires in 7 days",
 "stop-share": "Stop sharing, asks first",
 "visitor-pw": "Share link, visitor, password",
 "visitor-wrong": "Share link, visitor, wrong password",
 "visitor-open": "Share link, visitor, the folder",
 "visitor-revoked": "Share link, revoked or expired",
 "p-visitor": "Phone, share link, visitor",
 "p-share": "Phone, share sheet",
 "import-running": "Import running: a toast says so, Import is disabled",
 "imported": "Imported, toast with the counts",
 "import-bad": "Import refused, not a bookmarks file",
 "export": "Export, bookmarks.html downloaded, locked folders left out",
 "whats-new": "What's new",
 "term-totp": "Terminal, turning on the second factor",
 "sessions": "Signed in, two browsers",
 "sessions-confirm": "Signed in, sign out others asks the password",
 "sessions-wrong": "Signed in, wrong password",
 "sessions-done": "Signed in, others signed out",
 "signed-out-other": "The other browser after sign out, still showing bookmarks",
 "tokens-empty": "API tokens, none yet",
 "tokens-wrong": "API tokens, wrong app password",
 "token-created": "API token shown once",
 "tokens-list": "API tokens, list",
 "token-revoke": "API token, revoke asks first",
 "term-curl": "Terminal, a script with the token",
 "term-env": "Compose file, the settings",
 "p-settings": "Phone, Settings",
 "term-backup": "Terminal, backing up",
 "term-upgrade": "Terminal, upgrade names the saved copy",
 "term-downgrade": "Terminal, the older version refuses",
 "term-restore": "Terminal, restoring the saved copy",
 "save-down": "Server down, Save fails",
 "notice-down": "Server down, could not load, Retry",
 "p-notice-down": "Phone, server down at the first load: the head with the gear, the tabs, the notice",
 "browser-down": "Server down, reload shows the browser error"
};
