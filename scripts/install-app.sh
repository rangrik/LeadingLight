#!/bin/sh
# Builds the Mac app from this checkout and installs it in /Applications, so the
# person can test what was merged. Run it from main after a merge.
#
#   scripts/install-app.sh            build, then install
#   scripts/install-app.sh --no-build install the bundle already built
set -eu
cd "$(dirname "$0")/.."
APP=LeadingLight
# Cargo's target directory is the repository's (/target in .gitignore).
BUNDLE="target/release/bundle/macos/$APP.app"

# By path: the process is named leadinglight-desktop, not after the app.
if pgrep -f "/Applications/$APP.app/" >/dev/null; then
  echo "$APP is running: quit it, then run this again. Nothing was changed."
  exit 1
fi
if [ "${1:-}" != "--no-build" ]; then
  pnpm --filter @leadinglight/desktop tauri build --bundles app
fi
[ -d "$BUNDLE" ] || { echo "no bundle at $BUNDLE"; exit 1; }
rm -rf "/Applications/$APP.app"
ditto "$BUNDLE" "/Applications/$APP.app"
echo "installed /Applications/$APP.app from $(git rev-parse --short HEAD) ($(git branch --show-current))"
