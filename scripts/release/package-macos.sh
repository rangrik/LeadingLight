#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
tag=${1:?Pass the release tag}
node scripts/release/check-version.mjs "$tag"
app=target/release/bundle/macos/LeadingLight.app
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")" = "${tag#v}"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Contents/Info.plist")" = com.leadinglight.app
for binary in leadinglight-desktop berthd tmux leadinglight-transcribe; do
  test -x "$app/Contents/MacOS/$binary"
  lipo "$app/Contents/MacOS/$binary" -verify_arch arm64
  codesign --verify --strict "$app/Contents/MacOS/$binary"
done
test -d "$app/Contents/Resources/licenses/tmux"
test -d "$app/Contents/Resources/licenses/app"
test -f "$app/Contents/Resources/licenses/shipyard/LICENSE"
test -f "$app/Contents/Resources/licenses/leadinglight/LICENSE"
codesign --verify --deep --strict "$app"
"$app/Contents/MacOS/berthd" version
"$app/Contents/MacOS/tmux" -V
mkdir -p release-assets
name="LeadingLight_${tag#v}_macos-arm64"
dmgs=(target/release/bundle/dmg/*.dmg)
test "${#dmgs[@]}" -eq 1
hdiutil verify "${dmgs[0]}"
cp "${dmgs[0]}" "release-assets/$name.dmg"
ditto -c -k --sequesterRsrc --keepParent "$app" "release-assets/$name.app.zip"
(cd release-assets && shasum -a 256 "$name.dmg" "$name.app.zip" > SHA256SUMS.txt)
