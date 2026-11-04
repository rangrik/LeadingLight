#!/bin/bash
# Run the opt-in scope integration test against a real Linux systemd user
# manager in a disposable, isolated OrbStack machine. The source argument must
# be an already patched Shipyard checkout. GO may name the pinned Go binary.
set -euo pipefail

if [[ $# != 1 ]]; then
  echo "usage: GO=/path/to/go $0 /path/to/patched-shipyard-source" >&2
  exit 2
fi
source_dir=$(cd "$1" && pwd)
go_bin=${GO:-go}
orb=${ORBCTL:-orbctl}
tmp=$(mktemp -d /tmp/ll-systemd-test.XXXXXXXX)
# The random suffix prevents colliding with another run or an existing VM.
machine="ll-systemd-$(basename "$tmp" | cut -d. -f2 | tr '[:upper:]' '[:lower:]')"
created=0
cleanup() {
  status=$?
  trap - EXIT
  if [[ $created == 1 ]]; then
    echo "Deleting fixture machine $machine" >&2
    if ! "$orb" delete --force "$machine"; then
      echo "Could not delete fixture machine $machine; delete it manually." >&2
      status=1
    fi
  fi
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT

(cd "$source_dir" && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 "$go_bin" test -c -o "$tmp/box.test" ./internal/box)
"$orb" create --isolated --isolate-network --user fixture --memory 2G --cpus 2 --disk 8G --arch arm64 ubuntu:24.04 "$machine"
created=1
"$orb" push -m "$machine" "$tmp/box.test" box.test
"$orb" run -m "$machine" -u root sh -c '
  set -eu
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y tmux dbus-user-session
  loginctl enable-linger fixture
'
# The quoted script expands variables in Linux, not on the host.
# shellcheck disable=SC2016
"$orb" run -m "$machine" -u fixture sh -c '
  set -eu
  export HOME=/home/fixture XDG_RUNTIME_DIR=/run/user/$(id -u)
  export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus BERTH_TEST_SYSTEMD=1
  # loginctl starts the user manager asynchronously. Wait only for this VM.
  i=0
  until systemctl --user show-environment >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -lt 60 ] || { echo "systemd user manager did not start" >&2; exit 1; }
    sleep 1
  done
  systemd-run --user --scope --quiet --collect -- true
  echo "Real systemd user scope probe passed"
  exec /home/fixture/box.test -test.count=1 -test.v -test.run "^TestASessionsScopeWithRealSystemd$"
' | tee "$tmp/test.log"
# A skipped test is not evidence that systemd was exercised.
grep -q '^--- PASS: TestASessionsScopeWithRealSystemd ' "$tmp/test.log"
