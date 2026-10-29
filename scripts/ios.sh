#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../apps/desktop"
# Homebrew's Rust does not use the iOS targets installed by rustup.
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

case "${1:-}" in
  init|dev|build|release-archive|release-export)
    # XcodeGen includes this folder as resources, so the manifest lands at the app root.
    mkdir -p src-tauri/gen/apple/leadinglight-desktop_iOS
    cp src-tauri/PrivacyInfo.xcprivacy src-tauri/gen/apple/leadinglight-desktop_iOS/
    project_file=src-tauri/gen/apple/leadinglight-desktop.xcodeproj/project.pbxproj
    if [[ "$1" != init && -f "$project_file" ]] && ! grep -q 'PrivacyInfo.xcprivacy in Resources' "$project_file"; then
      echo "Run pnpm ios:init to include the privacy manifest in the Xcode project." >&2
      exit 1
    fi
    ;;
esac

case "${1:-}" in
  release-archive|release-export)
    release_action="$1"
    shift
    if [[ ! "${IOS_BUILD_NUMBER:-}" =~ ^[1-9][0-9]{0,3}$ ]]; then
      echo "Set IOS_BUILD_NUMBER to an unused build number from 1 to 9999." >&2
      exit 1
    fi
    release_config="{\"bundle\":{\"iOS\":{\"bundleVersion\":\"$IOS_BUILD_NUMBER\"}}}"
    cp src-tauri/ExportOptions.ios.plist src-tauri/gen/apple/ExportOptions.plist
    if [[ "$release_action" == release-archive ]]; then
      set -- build --ci --target aarch64 --no-sign --archive-only --export-method app-store-connect --config "$release_config" "$@"
    else
      : "${APPLE_DEVELOPMENT_TEAM:?Set APPLE_DEVELOPMENT_TEAM to your enrolled Apple Developer team ID.}"
      set -- build --ci --target aarch64 --export-method app-store-connect --config "$release_config" "$@"
    fi
    ;;
esac
exec pnpm tauri ios "$@"
