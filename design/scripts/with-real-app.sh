#!/bin/sh
# Runs a node script against a throwaway Pinned: a new data folder under /tmp, a password made here and passed on only in
# the environment (never written to a file), the server bound to 127.0.0.1, favicons off so nothing leaves the machine.
# The server is stopped and the folder removed when the script ends, also on an error.
#
# Usage: scripts/with-real-app.sh <pinned binary> <port> <node script> [args...]
# The binary must listen on 127.0.0.1 only. The app listens on ":"+PORT (every interface), so build a copy of the tag
# with that one address changed, outside the repo, for example:
#   git archive v0.1.11 | tar -x -C /tmp/pinned-src
#   (in cmd/pinned/main.go: newHTTPServer(":"+port, ...) becomes newHTTPServer("127.0.0.1:"+port, ...))
#   go -C /tmp/pinned-src build -trimpath -ldflags "-s -w -X main.version=0.1.11" -o /tmp/pinned-0111 ./cmd/pinned
set -eu
BIN=$1
PORT=$2
shift 2
DATA=$(mktemp -d /tmp/pinned-design.XXXXXX)
LOG="$DATA.log"
APP_PASSWORD=$(openssl rand -base64 24)
export APP_PASSWORD
DATA_DIR="$DATA" PORT="$PORT" ICONS=off "$BIN" >"$LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$DATA" "$LOG"
}
trap cleanup EXIT INT TERM
if ! curl -fs --retry 40 --retry-delay 1 --retry-connrefused --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "Pinned did not start:" >&2
  cat "$LOG" >&2
  exit 1
fi
PINNED_URL="http://127.0.0.1:$PORT" node "$@"
