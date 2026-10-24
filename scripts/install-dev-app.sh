#!/bin/sh
# This worktree's own Mac app, beside the real one, for what the browser can't show for sure
# (AGENTS.md, "How a change gets built"). Its name and its data carry a hash of the branch.
set -eu
cd "$(dirname "$0")/.."
HASH=$(git branch --show-current | shasum | cut -c1-6)
APP="LeadingLight Dev $HASH"
ID="com.leadinglight.dev.$HASH"
CONF="${TMPDIR:-/tmp}/leadinglight-dev-$HASH.json"

if pgrep -f "/Applications/$APP.app/" >/dev/null; then
  echo "$APP is running: quit it, then run this again. Nothing was changed."
  exit 1
fi
# --remove takes the app and everything it stored away, once the change is merged.
if [ "${1:-}" = "--remove" ]; then
  # Its project runtime outlives the app (runtime.rs): stopped first, agents and all.
  RT="$HOME/Library/Application Support/$ID/runtime"
  [ -f "$RT/berthd.pid" ] && kill "$(cat "$RT/berthd.pid")" 2>/dev/null || true
  [ -f "$RT/instance" ] && tmux -L "$(sed -n 's/^tmux=//p' "$RT/instance")" kill-server 2>/dev/null || true
  rm -rf "/Applications/$APP.app" "$HOME/Library/Application Support/$ID" "$HOME/Library/WebKit/$ID" "$HOME/Library/Caches/$ID"
  echo "removed $APP and its data"
  exit 0
fi
printf '{"productName":"%s","identifier":"%s"}' "$APP" "$ID" >"$CONF"
scripts/project-runtime/build.sh
scripts/project-runtime/build-tmux.sh
pnpm --filter @leadinglight/desktop tauri build --debug --bundles app --config "$CONF"
rm -rf "/Applications/$APP.app"
ditto "target/debug/bundle/macos/$APP.app" "/Applications/$APP.app"
echo "installed /Applications/$APP.app from $(git branch --show-current) at $(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo +dirty)"
