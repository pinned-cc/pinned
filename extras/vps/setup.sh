#!/bin/sh
# Pinned on a fresh server: installs Docker if it is missing, writes the compose file, asks for the
# password once and starts the container. Debian, Ubuntu and most Docker-capable distributions.
#
#   curl -fsSL https://raw.githubusercontent.com/pinned-cc/pinned/main/extras/vps/setup.sh | sh
#
# It asks for the password on the terminal. Without one (cloud-init, CI), set APP_PASSWORD:
#
#   curl -fsSL https://raw.githubusercontent.com/pinned-cc/pinned/main/extras/vps/setup.sh | APP_PASSWORD='...' sh
#
# Afterwards Pinned answers on port 9095 of the server. Put it behind HTTPS before you use it from
# outside your network: a Caddy or Traefik in front, or a Cloudflare tunnel. See the README.
set -eu

DIR="${PINNED_DIR:-$HOME/pinned}"
PORT="${PINNED_PORT:-9095}"
IMAGE="${PINNED_IMAGE:-ghcr.io/pinned-cc/pinned:latest}"

say() { printf '%s\n' "$*"; }
die() { printf 'setup: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is needed"

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker is installed but the compose plugin is missing; install docker-compose-plugin and run this again"

if [ -z "${APP_PASSWORD:-}" ]; then
  # with curl ... | sh the script itself is on stdin, so ask on the terminal
  if [ -t 0 ]; then
    TTY=/dev/stdin
  elif (: </dev/tty) 2>/dev/null; then
    TTY=/dev/tty
  else
    die "no terminal to ask for the password; set APP_PASSWORD in the environment, for example: curl -fsSL <setup.sh address> | APP_PASSWORD='...' sh"
  fi
  printf 'Choose the password for Pinned (8 characters or more): '
  stty -echo <"$TTY" 2>/dev/null || true
  trap 'stty echo <"$TTY" 2>/dev/null' EXIT
  trap 'exit 130' INT TERM
  read -r APP_PASSWORD <"$TTY" || true
  stty echo <"$TTY" 2>/dev/null || true
  trap - EXIT INT TERM
  printf '\n'
fi
[ "${#APP_PASSWORD}" -ge 8 ] || die "the password needs at least 8 characters"

mkdir -p "$DIR/data"
cd "$DIR"

cat > compose.yml <<YAML
services:
  pinned:
    image: $IMAGE
    container_name: pinned
    restart: unless-stopped
    ports:
      - "$PORT:8080"
    environment:
      APP_PASSWORD: \${APP_PASSWORD:?set APP_PASSWORD}
      TZ: \${TZ:-UTC}
    volumes:
      - ./data:/data
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
YAML

# the password lives in a file only this user can read; compose reads it as .env
umask 077
printf 'APP_PASSWORD=%s\n' "$APP_PASSWORD" > .env
# the container runs as uid 1000 and needs to write the data folder
chown 1000:1000 data 2>/dev/null || sudo chown 1000:1000 data

docker compose pull
docker compose up -d

IP="$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
say ""
say "Pinned is running."
say "  address   http://${IP:-this-server}:$PORT"
say "  files     $DIR/compose.yml, $DIR/.env, $DIR/data/bookmarks.db"
say "  update    cd $DIR && docker compose pull && docker compose up -d"
say "  stop      cd $DIR && docker compose down"
say ""
say "Before you use it from outside your network, put HTTPS in front of it. See the README."
