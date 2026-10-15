#!/bin/sh
# Save one link to Pinned from a terminal or another script.
#
#   save.sh <url> [folder name]
#
# Without a folder name the link goes to the Inbox. The folder name is matched
# without regard to upper and lower case, and the first folder with that name
# wins. The title is left empty, so the server uses the host as the title.
#
# The address and the token come from the environment, PINNED_URL and
# PINNED_TOKEN, or from the file ~/.config/pinned/env with these two lines:
#
#   PINNED_URL=https://bookmarks.example.com
#   PINNED_TOKEN=tk_your_token
#
# It prints "Saved to <folder>", "Already saved in <folder>" or the error.
# Exit codes: 0 saved, 2 already saved, 1 anything else.
#
# Needs only sh, curl, sed and awk. There is no JSON parser on a stock Mac,
# so the small answers are read with sed and awk. That has one limit: folder
# names with a double quote or a backslash in them are not supported.

ENV_FILE="${PINNED_ENV_FILE:-$HOME/.config/pinned/env}"

# Read one KEY=value line from the env file, without running the file.
from_env_file() {
  [ -r "$ENV_FILE" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | head -n 1 |
    sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

[ -n "$PINNED_URL" ] || PINNED_URL=$(from_env_file PINNED_URL)
[ -n "$PINNED_TOKEN" ] || PINNED_TOKEN=$(from_env_file PINNED_TOKEN)
PINNED_URL=${PINNED_URL%/}

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "Usage: save.sh <url> [folder name]" >&2
  exit 1
fi
if [ -z "$PINNED_URL" ] || [ -z "$PINNED_TOKEN" ]; then
  echo "Set PINNED_URL and PINNED_TOKEN, or put them in $ENV_FILE" >&2
  exit 1
fi

link=$1
want=$2

# Call the API. Prints the body, then the status code on its own last line.
api() {
  curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $PINNED_TOKEN" "$@"
}
status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }

# Print the "error" text of an answer, or the status code when there is none.
fail() {
  msg=$(printf '%s' "$2" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')
  echo "Error: ${msg:-HTTP $1}" >&2
  exit 1
}

# One folder per line as: id <tab> name. Go writes & < > as & <
# > inside JSON strings, so those are turned back first.
folder_lines() {
  printf '%s' "$1" | sed -e 's/\\u0026/\&/g' -e 's/\\u003c/</g' -e 's/\\u003e/>/g' |
    tr '}' '\n' | awk '
      /"name":"/ {
        id = $0;   sub(/.*"id":/, "", id);     sub(/,.*/, "", id)
        name = $0; sub(/.*"name":"/, "", name); sub(/".*/, "", name)
        print id "\t" name
      }'
}

folders=""
get_folders() {
  [ -n "$folders" ] && return 0
  r=$(api "$PINNED_URL/api/folders") || exit 1
  [ "$(status_of "$r")" = 200 ] || fail "$(status_of "$r")" "$(body_of "$r")"
  folders=$(folder_lines "$(body_of "$r")")
}

# The name of a folder id, or Inbox for null.
folder_name() {
  [ "$1" = null ] && { echo Inbox; return; }
  get_folders
  printf '%s\n' "$folders" | awk -F '\t' -v id="$1" '$1 == id { print $2; exit }'
}

folder_id=null
where=Inbox
if [ -n "$want" ]; then
  get_folders
  match=$(printf '%s\n' "$folders" | awk -F '\t' -v want="$want" \
    'tolower($2) == tolower(want) { print; exit }')
  if [ -z "$match" ]; then
    echo "Error: no folder named \"$want\"" >&2
    exit 1
  fi
  folder_id=$(printf '%s' "$match" | cut -f 1)
  where=$(printf '%s' "$match" | cut -f 2-)
fi

# The link goes into a JSON string, so backslashes and quotes are escaped.
json_link=$(printf '%s' "$link" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
r=$(api -H 'Content-Type: application/json' \
  -d "{\"url\":\"$json_link\",\"title\":\"\",\"folder_id\":$folder_id}" \
  "$PINNED_URL/api/bookmarks") || exit 1
code=$(status_of "$r")
body=$(body_of "$r")

case $code in
  201)
    echo "Saved to $where"
    ;;
  409)
    # A link in a locked folder answers with "duplicate":null.
    existing=$(printf '%s' "$body" | sed -n 's/.*"duplicate":{"id":[0-9]*,"folder_id":\([0-9a-z]*\).*/\1/p')
    if [ -z "$existing" ]; then
      echo "Already saved in a locked folder"
    else
      [ "$existing" = null ] || get_folders
      echo "Already saved in $(folder_name "$existing")"
    fi
    exit 2
    ;;
  *)
    fail "$code" "$body"
    ;;
esac
