#!/bin/sh
# Builds the tmux the app carries for its runtime, from the sources runtime/tmux/UPSTREAM.json
# pins, with libevent and utf8proc linked in, so it needs only what macOS has.
#
#   scripts/project-runtime/build-tmux.sh     writes apps/desktop/src-tauri/binaries/
set -eu
cd "$(dirname "$0")/../.."
PIN=runtime/tmux/UPSTREAM.json
CACHE=${LL_RUNTIME_CACHE:-$HOME/Library/Caches/leadinglight-runtime}/tmux
OUT=apps/desktop/src-tauri/binaries
export MACOSX_DEPLOYMENT_TARGET=$(node -p "require('./$PIN').macos")
mkdir -p "$CACHE/dl" "$OUT"
# Built once per pin.
STAMP=$(shasum -a 256 "$PIN" | cut -c1-16)
if [ "$(cat "$OUT/tmux-aarch64-apple-darwin.pin" 2>/dev/null)" = "$STAMP" ] && [ -x "$OUT/tmux-aarch64-apple-darwin" ]; then
  exit 0
fi
BUILD=$(mktemp -d "$CACHE/build.XXXXXX")
trap 'rm -rf "$BUILD"' EXIT
PREFIX="$BUILD/prefix"

node -e "for (const s of require('./$PIN').sources) console.log(s.name, s.url, s.sha256)" | while read -r NAME URL SHA; do
  F="$CACHE/dl/$NAME.tar.gz"
  [ -f "$F" ] || curl -fsSL -o "$F" "$URL"
  echo "$SHA  $F" | shasum -a 256 -c - >/dev/null || { echo "$NAME doesn't match its checksum" >&2; exit 1; }
  mkdir "$BUILD/$NAME" && tar -xzf "$F" -C "$BUILD/$NAME" --strip-components=1
done

# The system's tools only, so nothing installed on this Mac (Homebrew's libraries) gets in.
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
unset PKG_CONFIG_PATH
(cd "$BUILD/libevent" && ./configure -q --prefix="$PREFIX" --disable-shared --disable-openssl --disable-samples --disable-libevent-regress && make -s -j8 install) >/dev/null
(cd "$BUILD/utf8proc" && make -s -j8 install prefix="$PREFIX" && rm -f "$PREFIX"/lib/libutf8proc*.dylib) >/dev/null
(cd "$BUILD/tmux" && ./configure -q --enable-utf8proc --disable-dependency-tracking \
  CPPFLAGS="-I$PREFIX/include" LDFLAGS="-L$PREFIX/lib" LIBEVENT_CORE_CFLAGS="-I$PREFIX/include" LIBEVENT_CORE_LIBS="$PREFIX/lib/libevent_core.a" \
  LIBUTF8PROC_CFLAGS="-I$PREFIX/include" LIBUTF8PROC_LIBS="$PREFIX/lib/libutf8proc.a" \
  && make -s -j8) >/dev/null

# Only what every Mac has: the system's own libraries.
if otool -L "$BUILD/tmux/tmux" | tail -n +2 | grep -v -E '^\s+/(usr/lib|System)/'; then
  echo "tmux links a library a Mac may not have" >&2
  exit 1
fi
mv "$BUILD/tmux/tmux" "$OUT/tmux-aarch64-apple-darwin"
echo "$STAMP" > "$OUT/tmux-aarch64-apple-darwin.pin"
"$OUT/tmux-aarch64-apple-darwin" -V
