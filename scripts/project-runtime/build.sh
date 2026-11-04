#!/bin/sh
# Builds the project runtime: Shipyard's berthd at the commit
# runtime/shipyard/UPSTREAM.json pins, with our patches, by a pinned Go.
# Any checksum, notice or patch that doesn't match stops the build.
#
#   scripts/project-runtime/build.sh      writes apps/desktop/src-tauri/binaries/
#   scripts/project-runtime/build.sh --test [go test arguments]
#   scripts/project-runtime/build.sh --test-fixtures [go test arguments]
#   scripts/project-runtime/build.sh --test-systemd
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

# The toolchain, checked against the pin's checksum; a cached one carries the checksum it had.
GO="$CACHE/go$GO_VERSION"
if [ "$(cat "$GO/.sha256" 2>/dev/null)" != "$GO_SHA" ] || [ ! -x "$GO/bin/go" ]; then
  curl -fsSL -o "$CACHE/go.tar.gz" "$GO_URL"
  echo "$GO_SHA  $CACHE/go.tar.gz" | shasum -a 256 -c - || { rm -f "$CACHE/go.tar.gz"; exit 1; }
  rm -rf "$GO" && mkdir -p "$GO"
  tar -xzf "$CACHE/go.tar.gz" -C "$GO" --strip-components=1
  rm "$CACHE/go.tar.gz"
  echo "$GO_SHA" > "$GO/.sha256"
fi

# The source at exactly the pinned commit (its hash is the tree's).
SRC="$CACHE/shipyard"
[ -d "$SRC" ] || git clone --quiet --filter=blob:none --no-checkout "$REPO" "$SRC"
git -C "$SRC" cat-file -e "$COMMIT^{commit}" 2>/dev/null || git -C "$SRC" fetch --quiet origin "$COMMIT"
BUILD=$(mktemp -d "$CACHE/build.XXXXXX")
TEST_STATE=
trap 'rm -rf "$BUILD"; if [ -n "$TEST_STATE" ]; then rm -rf "$TEST_STATE"; fi' EXIT
git -C "$SRC" archive "$COMMIT" | tar -x -C "$BUILD"

# Its license and notices ship with the app as vendor/shipyard has them.
node -e "const n=require('./$PIN').notices; for (const [a,b] of Object.entries(n)) console.log(a+' '+b)" | while read -r FROM TO; do
  cmp -s "$BUILD/$FROM" "$TO" || { echo "$FROM at $COMMIT differs from $TO" >&2; exit 1; }
done

PATCHES=$(node -p "require('./$PIN').patches.join(' ')")
for P in $PATCHES; do
  (cd "$BUILD" && git apply --whitespace=nowarn "$ROOT/runtime/shipyard/patches/$P") || { echo "patch $P no longer applies to $COMMIT" >&2; exit 1; }
done

if [ "${1:-}" = "--test-systemd" ]; then
  [ "$#" -eq 1 ] || { echo "--test-systemd takes no Go test arguments" >&2; exit 2; }
  # OrbStack needs the host home to reach its local control socket. The test
  # itself runs as a separate user inside a newly created isolated machine.
  SYSTEMD_PID=
  # Called by the signal traps below.
  # shellcheck disable=SC2329
  stop_systemd() {
    if [ -n "$SYSTEMD_PID" ]; then
      kill -TERM "$SYSTEMD_PID" 2>/dev/null || true
      wait "$SYSTEMD_PID" 2>/dev/null || true
    fi
    exit "$1"
  }
  trap 'stop_systemd 130' INT
  trap 'stop_systemd 143' TERM
  GO="$GO/bin/go" GOPATH="$CACHE/gopath" GOCACHE="$CACHE/gocache" GOTOOLCHAIN=local GOFLAGS=-mod=readonly \
    "$ROOT/scripts/project-runtime/test-systemd.sh" "$BUILD" &
  SYSTEMD_PID=$!
  SYSTEMD_STATUS=0
  wait "$SYSTEMD_PID" || SYSTEMD_STATUS=$?
  SYSTEMD_PID=
  exit "$SYSTEMD_STATUS"
fi

if [ "${1:-}" = "--test" ] || [ "${1:-}" = "--test-fixtures" ]; then
  TEST_FIXTURES=0
  [ "$1" != "--test-fixtures" ] || TEST_FIXTURES=1
  shift
  [ "$#" -gt 0 ] || set -- ./...
  for TOOL in tmux lsof ps; do
    command -v "$TOOL" >/dev/null 2>&1 || { echo "Runtime tests need $TOOL on PATH for isolated fixtures and cleanup." >&2; exit 1; }
  done
  # Resolve the test browser before isolating HOME, which otherwise changes browser discovery.
  TEST_CHROMIUM=${BERTH_CHROMIUM:-}
  if [ -z "$TEST_CHROMIUM" ]; then
    if ! TEST_CHROMIUM=$(node "$ROOT/scripts/project-runtime/test-browser.mjs" "$ROOT/apps/desktop"); then
      exit 1
    fi
  fi
  [ -x "$TEST_CHROMIUM" ] || { echo "Run pnpm --filter @leadinglight/desktop exec playwright install --only-shell chromium, or set BERTH_CHROMIUM." >&2; exit 1; }
  # Unix socket paths must fit macOS's short limit.
  TEST_STATE=$(mktemp -d /tmp/ll-rt.XXXXXX)
  mkdir -p "$TEST_STATE/home" "$TEST_STATE/tmp" "$TEST_STATE/tmux" "$TEST_STATE/box" "$TEST_STATE/user"
  TEST_BROWSER="$TEST_CHROMIUM"
  if [ "$(uname -s)" = Darwin ]; then
    # Disposable test profiles must not ask for the person's macOS Keychain.
    TEST_BROWSER="$TEST_STATE/chromium"
    cat > "$TEST_BROWSER" <<'EOF'
#!/bin/sh
exec "$LL_TEST_CHROMIUM" --use-mock-keychain "$@"
EOF
    chmod +x "$TEST_BROWSER"
  fi
  touch "$BUILD/.leadinglight-runtime-build" "$TEST_STATE/.leadinglight-runtime-test-state"
  exec env -i HOME="$TEST_STATE/home" USER="${USER:-}" PATH="$GO/bin:$PATH" \
    TMPDIR="$TEST_STATE/tmp/" TMUX_TMPDIR="$TEST_STATE/tmux" \
    BERTH_HOME="$TEST_STATE/box" BERTH_USER_DIR="$TEST_STATE/user" BERTH_CHROMIUM="$TEST_BROWSER" LL_TEST_CHROMIUM="$TEST_CHROMIUM" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
    LL_RUNTIME_TEST_FIXTURES="$TEST_FIXTURES" LL_RUNTIME_POSTGRES_BIN="${LL_RUNTIME_POSTGRES_BIN:-}" LL_RUNTIME_LIVE_FIXTURE="${LL_RUNTIME_LIVE_FIXTURE:-}" \
    GOPATH="$CACHE/gopath" GOCACHE="$CACHE/gocache" GOTOOLCHAIN=local GOFLAGS=-mod=readonly \
    node "$ROOT/scripts/project-runtime/test-run.mjs" "$BUILD" "$TEST_STATE" "$@"
fi

# The version names the patch set too, so two sets never pass for one.
# Patch names are the ordered, space-separated list from the manifest.
# shellcheck disable=SC2086
SUM=$(cd runtime/shipyard/patches && cat $PATCHES | shasum -a 256 | cut -c1-8)

(cd "$BUILD" && env -i HOME="$HOME" PATH="$GO/bin:/usr/bin:/bin" GOPATH="$CACHE/gopath" GOCACHE="$CACHE/gocache" \
  GOTOOLCHAIN=local GOFLAGS=-mod=readonly CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -ldflags="-s -w -X github.com/cosscom/shipyard/internal/version.Version=v$VERSION+$SUM" \
  -o "$BUILD/berthd" ./cmd/berthd)
mv "$BUILD/berthd" "$OUT/berthd-$TRIPLE"
shasum -a 256 "$OUT/berthd-$TRIPLE" | sed "s|$OUT/||" > "$OUT/berthd-$TRIPLE.sha256"
"$OUT/berthd-$TRIPLE" version
cat "$OUT/berthd-$TRIPLE.sha256"
