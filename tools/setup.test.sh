#!/bin/sh
# Runs extras/vps/setup.sh against stand-ins for docker, curl, chown and ip, in a throwaway folder,
# and checks what it publishes, what it warns and how it downloads. Nothing is installed or started.
#   sh tools/setup.test.sh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/extras/vps/setup.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail=0
bad() { printf 'FAIL: %s\n' "$*" >&2; fail=1; }

mkdir -p "$T/bin" "$T/nodocker"
cat > "$T/bin/docker" <<'S'
#!/bin/sh
# ps -a answers with the folder of an existing install when OTHER_INSTALL is set
if [ "$1" = ps ] && [ -n "${OTHER_INSTALL:-}" ]; then printf '%s\n' "$OTHER_INSTALL"; fi
exit 0
S
# curl: logs its arguments; -o writes a stand-in installer; the health check answers
cat > "$T/bin/curl" <<'S'
#!/bin/sh
printf '%s\n' "$*" >> "$CURL_LOG"
while [ $# -gt 0 ]; do
  if [ "$1" = -o ] && [ "$2" != /dev/null ]; then printf 'echo INSTALLER-RAN\n' > "$2"; fi
  shift
done
exit 0
S
cat > "$T/bin/chown" <<'S'
#!/bin/sh
exit 0
S
cat > "$T/bin/ip" <<'S'
#!/bin/sh
echo "1.1.1.1 via 203.0.113.1 dev eth0 src 203.0.113.5 uid 0"
S
cat > "$T/bin/sleep" <<'S'
#!/bin/sh
exit 0
S
chmod +x "$T/bin/"*
for f in curl chown ip sleep; do cp "$T/bin/$f" "$T/nodocker/$f"; done

run() { # run <name> [VAR=value ...]: output in $T/<name>.out, compose file in $T/<name>/compose.yml
  name="$1"; shift
  CURL_LOG="$T/$name.curl"; : > "$CURL_LOG"
  env PATH="${STUBPATH:-$T/bin}:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$T" PINNED_DIR="$T/$name" CURL_LOG="$CURL_LOG" \
    APP_PASSWORD='stand-in for the test' "$@" sh "$SCRIPT" > "$T/$name.out" 2>&1
}

# The default publishes on this server only and says to put HTTPS in front, with no warning.
run default
grep -q '"127.0.0.1:9095:8080"' "$T/default/compose.yml" || bad "default does not publish on 127.0.0.1: $(grep 8080 "$T/default/compose.yml")"
grep -q 'on this server only' "$T/default.out" || bad "default does not say this server only"
grep -q 'Next: put HTTPS in front' "$T/default.out" || bad "default does not name the next step"
grep -q WARNING "$T/default.out" && bad "default warns"
grep -q 'ifconfig.me' "$T/default.curl" && bad "default asked ifconfig.me"
grep -q 'ghcr.io/pinned-cc/pinned:0.1.11' "$T/default/compose.yml" || bad "image is not the release tag"

# Every other address warns: all addresses, one public address, IPv6.
for bind in 0.0.0.0 :: 203.0.113.5 2001:db8::5; do
  n="bind-$(printf '%s' "$bind" | tr ':.' '__')"
  run "$n" PINNED_BIND="$bind"
  grep -q 'WARNING: Pinned answers on plain http' "$T/$n.out" || bad "PINNED_BIND=$bind gives no warning"
done
grep -q '"\[2001:db8::5\]:9095:8080"' "$T/bind-2001_db8__5/compose.yml" || bad "IPv6 bind not in brackets"
grep -q 'http://203.0.113.5:9095' "$T/bind-0_0_0_0.out" || bad "public address not taken from the route: $(grep address "$T/bind-0_0_0_0.out")"
grep -q 'ifconfig.me' "$T/bind-0_0_0_0.curl" && bad "asked ifconfig.me although the route named the address"
# :: alone is IPv6 only in Docker, so it publishes 0.0.0.0 and [::] both, and the check on 127.0.0.1 answers
# (found on a real server, 2026-11-03).
grep -q '"0.0.0.0:9095:8080"' "$T/bind-__/compose.yml" && grep -q '"\[::\]:9095:8080"' "$T/bind-__/compose.yml" \
  || bad "PINNED_BIND=:: does not publish both 0.0.0.0 and [::]: $(grep 8080 "$T/bind-__/compose.yml")"
# no fixed container name, so a second install in another folder does not clash with the first
grep -q container_name "$T/default/compose.yml" && bad "compose.yml sets a fixed container_name"
run loop6 PINNED_BIND=::1
grep -q WARNING "$T/loop6.out" && bad "PINNED_BIND=::1 warns"

# A second install in a folder with the same name as an existing one is refused, its own folder is not.
run samename OTHER_INSTALL=/root/samename || true
grep -q 'has the same folder name' "$T/samename.out" || bad "a second install with the same folder name was not refused: $(tail -2 "$T/samename.out")"
run again OTHER_INSTALL="$T/again"
grep -q 'has the same folder name' "$T/again.out" && bad "a re-run in its own folder was refused"

# Every curl call has a time limit.
for f in "$T"/*.curl; do
  while IFS= read -r line; do
    case "$line" in *--max-time*) ;; *) bad "curl without --max-time: $line" ;; esac
  done < "$f"
done

# Without Docker: the installer comes from the pinned commit, with retries, and one that does not
# match the checksum is never run.
STUBPATH="$T/nodocker" run nodocker || true
grep -q 'docker/docker-install/[0-9a-f]\{40\}/install.sh' "$T/nodocker.curl" || bad "installer not pinned to a commit: $(cat "$T/nodocker.curl")"
grep -q -- '--retry' "$T/nodocker.curl" || bad "installer download without retries"
grep -q 'did not match its checksum' "$T/nodocker.out" || bad "a changed installer was not refused: $(cat "$T/nodocker.out")"
grep -q INSTALLER-RAN "$T/nodocker.out" && bad "a changed installer ran"

[ "$fail" = 0 ] && echo "setup.sh: all checks passed"
exit "$fail"
