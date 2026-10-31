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
# Afterwards Pinned answers on plain http on port 9095 of the server, on its public address. Put it behind HTTPS before you use it from
# outside your network: a Caddy or Traefik in front, or a Cloudflare tunnel. See the README. With the proxy on
# this server, run it again with PINNED_BIND=127.0.0.1: a firewall such as ufw does not block Docker's ports.
set -eu

DIR="${PINNED_DIR:-$HOME/pinned}"
PORT="${PINNED_PORT:-9095}"
IMAGE="${PINNED_IMAGE:-ghcr.io/pinned-cc/pinned:latest}"
# PINNED_BIND=127.0.0.1 publishes the port on this server only, for a proxy on the same server that does HTTPS
BIND="${PINNED_BIND:-}"

say() { printf '%s\n' "$*"; }
die() { printf 'setup: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is needed"

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
# right after Docker is installed, a user who is not root is not yet in the docker group: use sudo for this run
DOCKER=docker
if ! docker info >/dev/null 2>&1 && [ "$(id -u)" != 0 ]; then
  DOCKER="sudo docker"
fi
$DOCKER compose version >/dev/null 2>&1 || die "Docker is installed but the compose plugin is missing; install docker-compose-plugin and run this again"

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
  IFS= read -r APP_PASSWORD <"$TTY" || true
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
      - "${BIND:+$BIND:}$PORT:8080"
    environment:
      APP_PASSWORD_FILE: /run/secrets/app_password
      TZ: \${TZ:-UTC}
    volumes:
      - ./data:/data
      - ./app_password:/run/secrets/app_password:ro
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
YAML

# the password goes into a file as it was typed, not into .env, where compose would read $ and " #" in it.
# Only the user the container runs as (1000) can read it.
umask 077
rm -f app_password .env  # a file from an earlier run, and the .env older versions of this script wrote
printf '%s' "$APP_PASSWORD" > app_password
# the container runs as uid 1000: it needs to write the data folder and read the password file
chown 1000:1000 data app_password 2>/dev/null || sudo chown 1000:1000 data app_password

$DOCKER compose pull
$DOCKER compose up -d

# say it runs only once it answers: a refused password makes the container restart instead
up=""
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/health" 2>/dev/null; then up=1; break; fi
  sleep 2
done
if [ -z "$up" ]; then
  $DOCKER compose logs --tail 20 pinned >&2 || true
  die "Pinned did not start; the log above says why. Fix it, then: cd $DIR && $DOCKER compose up -d"
fi

IP="$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
say ""
say "Pinned is running."
if [ -n "$BIND" ]; then
  say "  address   http://$BIND:$PORT, for your HTTPS proxy on this server"
else
  say "  address   http://${IP:-this-server}:$PORT"
fi
say "  files     $DIR/compose.yml, $DIR/app_password, $DIR/data/bookmarks.db"
say "  update    cd $DIR && $DOCKER compose pull && $DOCKER compose up -d"
say "  stop      cd $DIR && $DOCKER compose down"
if [ -z "$BIND" ]; then
  say ""
  say "WARNING: Pinned answers on plain http, on the server's public address."
  say "Your password would cross the internet unencrypted. Do not log in from outside yet."
  say "Put HTTPS in front first (Caddy, Traefik or a Cloudflare tunnel). A firewall such as ufw does"
  say "not block a port Docker publishes, so once the proxy runs on this server, run this again with"
  say "PINNED_BIND=127.0.0.1 to keep port $PORT off the internet:"
  say "  https://github.com/pinned-cc/pinned#behind-a-reverse-proxy"
fi
