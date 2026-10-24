#!/bin/sh
# Pulls Shipyard's changes into vendor/shipyard (and the files moved out of
# it). Reads the commit we have from vendor/shipyard/UPSTREAM.json, diffs it
# against upstream, applies the diff with a 3-way merge, then records the
# new commit. Conflicts are left as conflict markers for you to resolve, and
# then the script stops without recording the new commit.
#
#   scripts/sync-shipyard.sh            to upstream's main
#   scripts/sync-shipyard.sh v0.3.31    to a tag or commit
set -eu
cd "$(dirname "$0")/.."
LOCK=vendor/shipyard/UPSTREAM.json
REPO=$(node -p "require('./$LOCK').repo")
HAVE=$(node -p "require('./$LOCK').commit")
WANT=${1:-main}
FAILED=""

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# A partial clone: commits and trees now, blobs only as the diff needs them.
git clone --quiet --filter=blob:none --no-checkout "$REPO" "$TMP/up"
NEW=$(git -C "$TMP/up" rev-parse "$WANT^{commit}" 2>/dev/null || git -C "$TMP/up" rev-parse "origin/$WANT")
if [ "$NEW" = "$HAVE" ]; then
  echo "vendor/shipyard is at $HAVE already"
  exit 0
fi

# The vendored paths, as upstream names them, land under vendor/shipyard.
PATHS=$(node -p "require('./$LOCK').paths.join(' ')")
git -C "$TMP/up" diff --binary "$HAVE" "$NEW" -- $PATHS > "$TMP/vendored.patch"
if [ -s "$TMP/vendored.patch" ]; then
  git apply --3way --directory=vendor/shipyard "$TMP/vendored.patch" || FAILED="$FAILED vendor/shipyard"
fi

# Files kept elsewhere (UPSTREAM.json "moved"): one patch each, re-rooted.
MOVED=$(node -p "Object.entries(require('./$LOCK').moved).map(([a,b])=>a+' '+b).join('\n')" | while read -r FROM TO; do
  [ -n "$FROM" ] || continue
  git -C "$TMP/up" diff --binary "$HAVE" "$NEW" -- "$FROM" > "$TMP/moved.patch"
  [ -s "$TMP/moved.patch" ] || continue
  DEPTH=$(( $(echo "$FROM" | tr -cd '/' | wc -c) + 1 ))
  git apply --3way -p"$DEPTH" --directory="$(dirname "$TO")" "$TMP/moved.patch" >&2 || echo "$TO"
done)
FAILED="$FAILED $MOVED"

if [ -n "$(echo $FAILED)" ]; then
  echo "conflicts in:$FAILED. Resolve them and check the build, then set commit in $LOCK to $NEW (it still says $HAVE)" >&2
  exit 1
fi
node -e "const f='./$LOCK',l=require(f);l.commit='$NEW';require('fs').writeFileSync(f,JSON.stringify(l,null,2)+'\n')"
echo "vendor/shipyard moved from $HAVE to $NEW; check git status, then pnpm install and pnpm typecheck"
