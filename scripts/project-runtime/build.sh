#!/bin/sh
# Builds the project runtime: Shipyard's berthd at the commit
# runtime/shipyard/UPSTREAM.json pins, with our patches, by a pinned Go.
# Any checksum, notice or patch that doesn't match stops the build.
#
#   scripts/project-runtime/build.sh      writes apps/desktop/src-tauri/binaries/
set -eu
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
PIN=runtime/shipyard/UPSTREAM.json
pin() { node -p "require('./$PIN').$1"; }
REPO=$(pin repo)
COMMIT=$(pin commit)
VERSION=$(pin version)
GO_VERSION=$(pin go.version)
GO_URL=$(pin go.url)
GO_SHA=$(pin go.sha256)
CACHE=${LL_RUNTIME_CACHE:-$HOME/Library/Caches/leadinglight-runtime}
TRIPLE=aarch64-apple-darwin
OUT=apps/desktop/src-tauri/binaries
mkdir -p "$CACHE" "$OUT"

# The toolchain, checked against the pin's checksum.
GO="$CACHE/go$GO_VERSION"
if [ ! -x "$GO/bin/go" ]; then
  curl -fsSL -o "$CACHE/go.tar.gz" "$GO_URL"
  echo "$GO_SHA  $CACHE/go.tar.gz" | shasum -a 256 -c -
  rm -rf "$GO" && mkdir -p "$GO"
  tar -xzf "$CACHE/go.tar.gz" -C "$GO" --strip-components=1
  rm "$CACHE/go.tar.gz"
fi

# The source at exactly the pinned commit (its hash is the tree's).
SRC="$CACHE/shipyard"
[ -d "$SRC" ] || git clone --quiet --filter=blob:none --no-checkout "$REPO" "$SRC"
git -C "$SRC" cat-file -e "$COMMIT^{commit}" 2>/dev/null || git -C "$SRC" fetch --quiet origin "$COMMIT"
BUILD=$(mktemp -d "$CACHE/build.XXXXXX")
trap 'rm -rf "$BUILD"' EXIT
git -C "$SRC" archive "$COMMIT" | tar -x -C "$BUILD"

# Its license and notices ship with the app as vendor/shipyard has them.
node -e "const n=require('./$PIN').notices; for (const [a,b] of Object.entries(n)) console.log(a+' '+b)" | while read -r FROM TO; do
  cmp -s "$BUILD/$FROM" "$TO" || { echo "$FROM at $COMMIT differs from $TO" >&2; exit 1; }
done

for P in $(node -p "require('./$PIN').patches.join(' ')"); do
  (cd "$BUILD" && git apply --whitespace=nowarn "$ROOT/runtime/shipyard/patches/$P") || { echo "patch $P no longer applies to $COMMIT" >&2; exit 1; }
done

(cd "$BUILD" && env -i HOME="$HOME" PATH="$GO/bin:/usr/bin:/bin" GOPATH="$CACHE/gopath" GOCACHE="$CACHE/gocache" \
  GOTOOLCHAIN=local GOFLAGS=-mod=readonly CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -ldflags="-s -w -X github.com/cosscom/shipyard/internal/version.Version=v$VERSION" \
  -o "$BUILD/berthd" ./cmd/berthd)
mv "$BUILD/berthd" "$OUT/berthd-$TRIPLE"
shasum -a 256 "$OUT/berthd-$TRIPLE" | sed "s|$OUT/||" > "$OUT/berthd-$TRIPLE.sha256"
"$OUT/berthd-$TRIPLE" version
cat "$OUT/berthd-$TRIPLE.sha256"
