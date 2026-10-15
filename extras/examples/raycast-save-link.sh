#!/bin/sh

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Save link to Pinned
# @raycast.mode compact

# Optional parameters:
# @raycast.packageName Pinned
# @raycast.argument1 { "type": "text", "placeholder": "URL", "optional": true }

# Documentation:
# @raycast.description Save a link to the Inbox of Pinned. Without a URL it saves the link on the clipboard.

# Raycast does not read your shell profile, so the address and the token
# come from ~/.config/pinned/env, a file with these two lines:
#
#   PINNED_URL=https://bookmarks.example.com
#   PINNED_TOKEN=tk_your_token
#
# In compact mode Raycast shows the last line this script prints.

ENV_FILE="$HOME/.config/pinned/env"

from_env_file() {
  [ -r "$ENV_FILE" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | head -n 1 |
    sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

[ -n "$PINNED_URL" ] || PINNED_URL=$(from_env_file PINNED_URL)
[ -n "$PINNED_TOKEN" ] || PINNED_TOKEN=$(from_env_file PINNED_TOKEN)
PINNED_URL=${PINNED_URL%/}

if [ -z "$PINNED_URL" ] || [ -z "$PINNED_TOKEN" ]; then
  echo "Put PINNED_URL and PINNED_TOKEN in $ENV_FILE"
  exit 1
fi

# The argument, or the clipboard, with surrounding spaces and line breaks cut.
link=$1
[ -n "$link" ] || link=$(pbpaste 2>/dev/null)
link=$(printf '%s' "$link" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

case $link in
  http://*|https://*) ;;
  *) echo "No link given and none on the clipboard"; exit 1 ;;
esac

json_link=$(printf '%s' "$link" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
r=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $PINNED_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"$json_link\",\"title\":\"\",\"folder_id\":null}" \
  "$PINNED_URL/api/bookmarks" 2>&1)
code=$(printf '%s\n' "$r" | tail -n 1)
body=$(printf '%s\n' "$r" | sed '$d')

case $code in
  201)
    echo "Saved to Inbox"
    ;;
  409)
    # Look up the name of the folder that already holds the link.
    id=$(printf '%s' "$body" | sed -n 's/.*"duplicate":{"id":[0-9]*,"folder_id":\([0-9a-z]*\).*/\1/p')
    case $id in
      "") echo "Already saved in a locked folder" ;;
      null) echo "Already saved in Inbox" ;;
      *)
        name=$(curl -sS -H "Authorization: Bearer $PINNED_TOKEN" "$PINNED_URL/api/folders" |
          sed -e 's/\\u0026/\&/g' -e 's/\\u003c/</g' -e 's/\\u003e/>/g' |
          tr '}' '\n' | sed -n "s/.*\"id\":$id,.*\"name\":\"\([^\"]*\)\".*/\1/p" | head -n 1)
        echo "Already saved in ${name:-a folder}"
        ;;
    esac
    ;;
  *)
    msg=$(printf '%s' "$body" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')
    # When curl itself failed, its message is the last line of the body.
    [ -n "$msg" ] || msg=$(printf '%s\n' "$body" | tail -n 1)
    echo "Error: ${msg:-HTTP $code}"
    exit 1
    ;;
esac
