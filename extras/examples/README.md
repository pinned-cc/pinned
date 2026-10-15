# Examples

Six small ways to save links to Pinned without opening the app. Each one is a single file. None needs anything that a Mac or a Linux box does not already have, apart from the tool it is written for (Raycast, Home Assistant, n8n).

## Before you start

Every example uses an API token. Create one in the app under API tokens, in the menu next to Import and Export. The token is shown once. Copy it then.

The scripts read the address and the token from the environment, `PINNED_URL` and `PINNED_TOKEN`, or from the file `~/.config/pinned/env`. Make that file once:

```sh
mkdir -p ~/.config/pinned
cat > ~/.config/pinned/env <<'END'
PINNED_URL=https://bookmarks.example.com
PINNED_TOKEN=tk_your_token
END
chmod 600 ~/.config/pinned/env
```

Two lines, no spaces around `=`. Quotes around a value are allowed. The environment wins over the file.

## The API in three calls

Every call sends the token in the `Authorization` header. These are the real answers from a running server, shortened where it says so.

The folders, to pick one:

```sh
curl -H 'Authorization: Bearer tk_your_token' https://bookmarks.example.com/api/folders
```

```json
[{"id":1,"parent_id":null,"name":"Bookmarks bar","position":0},
 {"id":4,"parent_id":null,"name":"Examples R&D","position":3}]
```

Go writes `&`, `<` and `>` inside JSON strings as `&`, `<` and `>`. Any JSON reader turns them back. Folders that are locked are left out, because nothing can be saved into them.

Is this link saved already?

```sh
curl -H 'Authorization: Bearer tk_your_token' \
  'https://bookmarks.example.com/api/check?url=https%3A%2F%2Fexample.com%2Fnot-saved'
```

```json
{"duplicate":null,"icon":null}
```

When it is saved, `duplicate` holds the bookmark instead of `null`, with the same fields as below.

Save it. `folder_id` set to `null` puts it in the Inbox. An empty `title` makes the server use the host, like `example.com`.

```sh
curl -H 'Authorization: Bearer tk_your_token' -H 'Content-Type: application/json' \
  -d '{"title":"Example five","url":"https://example.com/pinned-examples/save-5","folder_id":4}' \
  https://bookmarks.example.com/api/bookmarks
```

Saved, status 201:

```json
{"id":35,"folder_id":4,"title":"Example five","url":"https://example.com/pinned-examples/save-5",
 "host":"example.com","position":1,"pinned":false,"pinned_position":0,"icon":null,
 "tile":null,"letter":"E","created_at":1791926158,"updated_at":1791926158,
 "opened_at":null,"deleted_at":null}
```

Already saved, status 409, with the bookmark that holds the link:

```json
{"duplicate":{"id":35,"folder_id":4,"title":"Example five", "...": "the rest as above"},
 "error":"Already saved"}
```

If the link sits in a locked folder, the 409 says `"duplicate":null,"locked":true` and nothing more.

A wrong token, status 401:

```json
{"error":"invalid token"}
```

Five wrong tokens from one address make the next try wait 30 seconds (status 429).

## save.sh

Saves one link from a terminal or from another script.

Setup: the env file above. Needs `curl`, `sed` and `awk`, which every Mac and Linux box has.

Run it:

```sh
extras/examples/save.sh https://example.com/              # to the Inbox
extras/examples/save.sh https://example.com/ reading      # to the folder Reading
```

What you will see:

```text
Saved to Reading
Already saved in Reading
Error: no folder named "Readng"
Error: invalid token
```

The exit code is 0 when it saved, 2 when the link was already saved, and 1 for anything else, so other scripts can tell them apart.

The folder name is matched without regard to upper and lower case, and the first folder with that name wins. A folder in a subfolder is found by its own name. The title is left empty, so the server uses the host.

One limit: there is no JSON parser on a stock Mac, so the script reads the answers with `sed` and `awk`. Folder names with a double quote or a backslash in them are not supported.

## raycast-save-link.sh

A Raycast script command. Type its name in Raycast, paste a link or leave the field empty, press Enter. Without a link it saves the link on the clipboard. Links go to the Inbox.

Setup:

1. The env file above. Raycast does not read your shell profile, so the file is the only way in.
2. In Raycast, open Settings, Extensions, Script Commands, and add the folder that holds `raycast-save-link.sh`. The file has to be executable (`chmod +x`).

What you will see, in the small toast at the bottom (compact mode shows the last line the script prints):

```text
Saved to Inbox
Already saved in Reading
No link given and none on the clipboard
Error: invalid token
```

The metadata block at the top follows the Raycast script commands documentation: `schemaVersion`, `title` and `mode` are required, `mode compact` shows the last line of output in a toast, and `argument1` takes `type`, `placeholder` and `optional`. Sources: [README](https://github.com/raycast/script-commands), [arguments](https://github.com/raycast/script-commands/blob/master/documentation/ARGUMENTS.md), [output modes](https://github.com/raycast/script-commands/blob/master/documentation/OUTPUTMODES.md).

## homeassistant.yaml

A `rest_command` named `save_bookmark`, and one automation that saves a link when a button is pressed.

Setup:

1. Add two lines to `secrets.yaml`:

   ```yaml
   pinned_bookmarks_url: "https://bookmarks.example.com/api/bookmarks"
   pinned_authorization: "Bearer tk_your_token"
   ```

2. Paste `homeassistant.yaml` into `configuration.yaml`. The automation sits under `automation pinned:`, so it does not clash with the usual `automation: !include automations.yaml`.
3. Change `input_button.save_link` to your own button and the example link to yours. Restart Home Assistant.

Run it from Developer tools, Actions:

```yaml
action: rest_command.save_bookmark
data:
  url: "https://example.com/"
  folder_id: 4
```

Leave out `folder_id` to save to the Inbox. The answer shows `status` 201 for saved and 409 for already saved. The automation puts that into a notification: Saved, Already saved, or the error.

The keys (`url`, `method`, `headers`, `payload`, `content_type`, `timeout`) and the `response_variable` with `status` and `content` come from the [RESTful Command documentation](https://www.home-assistant.io/integrations/rest_command/).

What was tested: the file parses as YAML (Ruby's built in YAML parser, Psych 3.1, since Python on this Mac has no YAML module), and the request body it renders was sent to a real server with and without `folder_id` (201, 201, then 409 for the repeat). Home Assistant itself was not run, so the automation has not been run inside it.

## n8n-save-bookmark.json

An n8n workflow: a Webhook that takes a POST at `/webhook/save`, sends the link to Pinned, and answers with the server's status and body.

Setup:

1. In n8n, create a credential of the type Header Auth. Name: `Authorization`. Value: `Bearer tk_your_token`.
2. In a new workflow, open the menu at the top right, choose Import from File and pick the file.
3. Open the node Save to Pinned. Change the address to your server and pick the credential.
4. Activate the workflow.

Run it:

```sh
curl -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","title":"","folder_id":null}' \
  https://your-n8n.example.com/webhook/save
```

`title` and `folder_id` can be left out. What you will see is the server's answer passed through: 201 with the bookmark, or 409 with `"error":"Already saved"`.

The file follows the structure of real n8n exports: the [TinyURL Shortener via Webhook template](https://n8n.io/workflows/4595) (Webhook version 2 with `responseMode` `responseNode`, HTTP Request version 4.2 with a JSON body), the [Creating a Secure Webhook template](https://n8n.io/workflows/5174) (`authentication` `genericCredentialType` with `genericAuthType` `httpHeaderAuth`), and the [multi level approval template](https://n8n.io/workflows/20586) (the `neverError` and `fullResponse` options, and Respond to Webhook with the status code). The files were read from `api.n8n.io/api/templates/workflows/<id>`.

What was tested: the file is valid JSON, and the same request body was sent to a real server with curl. n8n itself was not run, so the import has not been tried in n8n.

## feed-to-folder.py

Reads an RSS 2.0 or Atom feed and saves every entry's link, with its title, to one folder. Links that are already saved are counted and left alone, so it can run again and again and only adds what is new.

Setup: the env file above, and a folder in the app to save into. Needs Python 3. On a Mac, the first `python3` asks to install the command line tools.

Run it:

```sh
python3 extras/examples/feed-to-folder.py https://go.dev/blog/feed.atom Reading
```

What you will see, one line:

```text
Reading: 10 saved, 0 already saved, 0 failed
```

The second run of the same feed says `0 saved, 10 already saved`. A link that fails is named on its own line before the summary. The exit code is 1 when anything failed.

To run it every hour with cron (`crontab -e`). Cron does not read your shell profile, so the env file is how it finds the token:

```text
0 * * * * /usr/bin/python3 /path/to/feed-to-folder.py https://go.dev/blog/feed.atom Reading >> /tmp/feed-to-folder.log 2>&1
```
