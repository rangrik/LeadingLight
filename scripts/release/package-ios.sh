#!/bin/bash
# Checks the signed Ad Hoc build and writes what a release carries for iPhone and iPad: the app,
# and the manifest iOS reads when the app's Update button opens an itms-services link.
set -euo pipefail
cd "$(dirname "$0")/../.."
tag=${1:?Pass the release tag}
version=${tag#v}
ipa=apps/desktop/src-tauri/gen/apple/build/arm64/LeadingLight.ipa
work=$(mktemp -d)
unzip -q "$ipa" -d "$work"
app="$work/Payload/LeadingLight.app"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Info.plist")" = "$version"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")" = com.leadinglight.app
codesign --verify --strict "$app"
# Ad Hoc installs only on the devices its profile names, so a profile without any is the wrong one.
security cms -D -i "$app/embedded.mobileprovision" | plutil -extract ProvisionedDevices json -o - - | grep -q '"'
mkdir -p release-ios
name="LeadingLight_${version}_ios.ipa"
cp "$ipa" "release-ios/$name"
url="https://github.com/${GITHUB_REPOSITORY:-rangrik/LeadingLight}/releases/download/$tag/$name"
cat > release-ios/LeadingLight_ios.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
  <key>assets</key><array><dict>
    <key>kind</key><string>software-package</string>
    <key>url</key><string>$url</string>
  </dict></array>
  <key>metadata</key><dict>
    <key>bundle-identifier</key><string>com.leadinglight.app</string>
    <key>bundle-version</key><string>$version</string>
    <key>kind</key><string>software</string>
    <key>title</key><string>LeadingLight</string>
  </dict>
</dict></array></dict></plist>
PLIST
plutil -lint release-ios/LeadingLight_ios.plist
rm -rf "$work"
