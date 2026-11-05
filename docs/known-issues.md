# Known issues

Known in 0.1.12, to be fixed in a later version:

- After five wrong passwords, the wait shown does not count down; it keeps the time it started with.
- The app needs a full address starting with http or https; `example.com` alone is refused.
- The extension popup and its options are always dark.
- With More open, the folder list scrolls without a visible scroll bar.
- On the phone, nothing says that holding a card selects it.
- A wrong second factor code empties both fields.
- In Signed in browsers, two browsers of the same kind look alike; only the day tells them apart.
- A browser signed out from another one keeps showing your links until its window gets focus or it asks the server for something.
- After creating an API token the form closes; open the sheet again for a second one.
- When 0.1.10 refuses a database a newer version upgraded, it does not name the backup copy. The copy is in the data folder, named with the schema number and the date, see Going back to an older version in the README.

Found something else? Open an issue: https://github.com/pinned-cc/pinned/issues
