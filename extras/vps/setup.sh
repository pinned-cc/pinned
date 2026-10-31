#!/bin/sh
# Pinned on a fresh server: installs Docker if it is missing, writes the compose file, asks for the
# password once and starts the container. Debian, Ubuntu and most Docker-capable distributions.
#
#   curl -fsSL https://raw.githubusercontent.com/pinned-cc/pinned/v0.1.11/extras/vps/setup.sh | sh
#
# It asks for the password on the terminal. Without one (cloud-init, CI), set APP_PASSWORD:
#
#   curl -fsSL https://raw.githubusercontent.com/pinned-cc/pinned/v0.1.11/extras/vps/setup.sh | APP_PASSWORD='...' sh
#
# Afterwards Pinned answers on port 9095 of this server only (127.0.0.1), for a proxy on the same server that
# does HTTPS: Caddy, Traefik or a Cloudflare tunnel. See the README. To reach it on plain http from other
# machines instead, set PINNED_BIND=0.0.0.0 (or one address of the server); the script then warns you.
set -eu

DIR="${PINNED_DIR:-$HOME/pinned}"
PORT="${PINNED_PORT:-9095}"
# the release this script belongs to; a re-run of a newer release's script updates
IMAGE="${PINNED_IMAGE:-ghcr.io/pinned-cc/pinned:0.1.11}"
# the address the port is published on: this server only by default. A firewall such as ufw does not block
# Docker's ports, so any other address is reachable from every network that reaches it.
BIND="${PINNED_BIND:-127.0.0.1}"
case "$BIND" in
  \[*) PUBLISH="$BIND:" ;;
  *:*) PUBLISH="[$BIND]:" ;;
  *) PUBLISH="$BIND:" ;;
esac
case "$BIND" in 127.*|::1|'[::1]') LOOPBACK=1 ;; *) LOOPBACK="" ;; esac
# Docker's installer, pinned to one commit of github.com/docker/docker-install and checked by its sha256.
# It installs the current Docker Engine from Docker's own package repository.
DOCKER_INSTALL_URL=https://raw.githubusercontent.com/docker/docker-install/ada7a567e59b3935bd601bb21e422da50e80e376/install.sh
DOCKER_INSTALL_SHA256=2b102d809152ea157a59f171319f489d971273b2d26dd7e9a6d1d737ce89289d

say() { printf '%s\n' "$*"; }
die() { printf 'setup: %s\n' "$*" >&2; exit 1; }
# every download gives up instead of hanging, and tries again on a passing network fault
fetch() { curl -fsSL --proto '=https' --connect-timeout 10 --max-time 120 --retry 3 --retry-delay 2 "$@"; }

command -v curl >/dev/null 2>&1 || die "curl is needed"

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  command -v sha256sum >/dev/null 2>&1 || die "sha256sum is needed to check Docker's installer; install Docker yourself, then run this again"
  INSTALLER="$(mktemp)"
  fetch -o "$INSTALLER" "$DOCKER_INSTALL_URL" || die "could not download Docker's installer; check the network, or install Docker yourself, then run this again"
  printf '%s  %s\n' "$DOCKER_INSTALL_SHA256" "$INSTALLER" | sha256sum -c - >/dev/null 2>&1 \
    || { rm -f "$INSTALLER"; die "Docker's installer did not match its checksum; nothing was installed. Install Docker yourself, then run this again"; }
  sh "$INSTALLER"
  rm -f "$INSTALLER"
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
      - "$PUBLISH$PORT:8080"
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
# recreate, so a new password or address from a re-run applies now and not at the next restart
$DOCKER compose up -d --force-recreate

# say it runs only once it answers: a refused password makes the container restart instead
# ask on the address the port is published on; all addresses answer on 127.0.0.1, an IPv6 one needs brackets
case "$BIND" in
  0.0.0.0|::|'[::]') CHECK=127.0.0.1 ;;
  \[*) CHECK="$BIND" ;;
  *:*) CHECK="[$BIND]" ;;
  *) CHECK="$BIND" ;;
esac
up=""
for _ in $(seq 1 30); do
  if curl -fsS --connect-timeout 2 --max-time 5 -o /dev/null "http://$CHECK:$PORT/health" 2>/dev/null; then up=1; break; fi
  sleep 2
done
if [ -z "$up" ]; then
  $DOCKER compose logs --tail 20 pinned >&2 || true
  die "Pinned did not start; the log above says why. Fix it, then: cd $DIR && $DOCKER compose up -d"
fi

say ""
say "Pinned is running."
if [ -n "$LOOPBACK" ]; then
  say "  address   http://$PUBLISH$PORT, on this server only"
else
  case "$BIND" in
    0.0.0.0|::|'[::]')
      # the address this server reaches the internet from; ifconfig.me only when the server cannot tell
      IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
      [ -n "$IP" ] || IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
      [ -n "$IP" ] || IP="$(curl -fsS -4 --connect-timeout 5 --max-time 10 https://ifconfig.me 2>/dev/null || true)"
      say "  address   http://${IP:-this-server}:$PORT" ;;
    *) say "  address   http://$PUBLISH$PORT" ;;
  esac
fi
say "  files     $DIR/compose.yml, $DIR/app_password, $DIR/data/bookmarks.db"
say "  update    run the setup command of the newer release again; it keeps your data"
say "  stop      cd $DIR && $DOCKER compose down"
say ""
if [ -n "$LOOPBACK" ]; then
  say "Next: put HTTPS in front (Caddy, Traefik or a Cloudflare tunnel) and point it at 127.0.0.1:$PORT."
  say "Set BASE_URL to the https address you give it. How: https://github.com/pinned-cc/pinned#behind-a-reverse-proxy"
else
  say "WARNING: Pinned answers on plain http on $BIND, which other machines can reach."
  say "Your password would cross the network unencrypted. Do not log in from outside your own network."
  say "Put HTTPS in front first (Caddy, Traefik or a Cloudflare tunnel), then run this again without"
  say "PINNED_BIND, so port $PORT answers on this server only. A firewall such as ufw does not block it."
  say "  https://github.com/pinned-cc/pinned#behind-a-reverse-proxy"
fi
