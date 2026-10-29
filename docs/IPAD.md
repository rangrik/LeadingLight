# LeadingLight on iPad

The native iPad target shares the desktop editor, page model, themes and local SQLite store.
Mac agent processes, global shortcuts, menu-bar integration and launch-at-login stay on Mac.
Build, browser and device evidence is recorded in [QA_IPAD.md](QA_IPAD.md).

## Build

Use a Mac with Xcode, CocoaPods, pnpm and rustup. Run `pnpm install`, then `pnpm ios:init`.
The official Tauri initializer generates `apps/desktop/src-tauri/gen/apple/`; that folder is
ignored, while the iOS configuration, permissions and icons are source-controlled.

`pnpm ios:build` builds an unsigned arm64 device archive without launching a window, at
`apps/desktop/src-tauri/gen/apple/build/leadinglight-desktop_iOS.xcarchive`. It needs signing
before installation. The helper chooses rustup's toolchain because a separate Homebrew Rust
installation cannot find rustup's iOS targets.

`pnpm ios:build:sim` builds for the simulator. Tauri also requires a simulator runtime matching
Xcode's SDK: on this Mac, Xcode 27 has its SDK but installed simulator runtimes stop at 26.5,
so simulator packaging is blocked. iOS simulator Rust compilation and the device archive pass.

For device development, run `scripts/ios.sh dev --open`, select the paired iPad and an Apple
development team in the generated Xcode project, then build there. Choose signing explicitly;
no team, certificate or provisioning profile is stored in this repository. TestFlight needs a
signed distribution build and an App Store Connect app record.

The target requires iPadOS 16.4 or later. The frontend preview is available with `?ipad` only
in development; production uses the native platform command. To run the focused browser checks:

```sh
QA_PORT=1437 pnpm --filter @leadinglight/desktop exec playwright test \
  -c qa/playwright.config.ts --project=qa --project=ipad-webkit ipad.spec.ts
```

## TestFlight

`IOS_BUILD_NUMBER=1 pnpm ios:archive` creates an unsigned **release** archive at the same path
as `ios:build`. Choose the next unused build number in App Store Connect before uploading;
the example `1` is provisional. The marketing version stays `0.2.0` and the release bot owns it.
The helper sets `bundle.iOS.bundleVersion` separately; Tauri's `--build-number` would append
to the marketing version. Run `pnpm ios:init` after updating this checkout so XcodeGen includes
the source-controlled privacy manifest. Source icons are opaque, including the 1024-pixel icon.

After confirming Apple Developer enrollment, signing access, and an iOS App Store Connect
record whose bundle ID is `com.leadinglight.app`, export a signed IPA locally:

```sh
APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID IOS_BUILD_NUMBER=1 pnpm ios:export
```

This uses App Store Connect distribution and writes `LeadingLight.ipa` under
`apps/desktop/src-tauri/gen/apple/build/arm64/`; it does not upload. The export options keep
the explicit build number. `release-testing` means ad-hoc distribution in current Xcode,
despite Tauri CLI help calling it TestFlight. No team, credential or profile is committed.

Upload the signed IPA with Apple's Transporter, or distribute the signed archive through
Xcode Organizer using App Store Connect. After Apple processes it, complete any export
compliance questions, create an internal TestFlight group and add your own App Store Connect
account. Add the build to that group, then install TestFlight on the iPad with the invited
Apple Account. External testers need a separate group and Apple's beta review.
[Apple's upload guide](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
and [internal testing guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
describe these steps.

Current handoff (2026-10-29): the user confirmed they do not have an Apple Developer membership,
so TestFlight distribution is blocked. No enrollment or purchase was made. The TestFlight archive is
unsigned and has not been uploaded or validated by Apple. The manifest declares
the filesystem plugin's app-container timestamp use (`C617.1`). Bundled SQLite's filesystem
inspection calls still need review before distribution; no unrelated disk-space reason is
declared. Encryption answers must describe the final build; none is guessed in its plist.

Use this **What to Test** text:

> Test creating and reopening notes offline, rotating and resizing the iPad, using the
> onscreen keyboard on a long page, Quick capture, and adding an image and PDF. Reopen the
> app in airplane mode and check the image and Quick Look preview. Report lost edits,
> clipped controls, keyboard overlap or file errors. This build stores notes on this iPad;
> Mac-to-iPad account sync is not included yet.

## Direct development install

The user chose this route on 2026-10-29 after connecting an iPad Pro (11-inch, 2nd generation).
A free Personal Team can sign for the user's own device; its profile expires after seven days.
Sign in to Xcode's Apple Accounts settings, pair the iPad in Device Hub, and enable Developer
Mode on the iPad. The separate dev bundle keeps its own data and includes the frontend offline.
LeadingLight Dev 0.2.0 was installed and tested on that iPad on 2026-10-29 with the user's
explicit authorization for agent-led device testing. See `QA_IPAD.md` for evidence and the
remaining checks below.

```sh
APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID scripts/ios.sh build --ci --target aarch64 \
  --archive-only --export-method debugging --config src-tauri/tauri.ios-dev.conf.json
xcrun devicectl device install app --device YOUR_IPAD_UDID \
  "apps/desktop/src-tauri/gen/apple/build/leadinglight-desktop_iOS.xcarchive/Products/Applications/LeadingLight Dev.app"
```

Use the exact iPad identifier from `xcrun devicectl list devices`. Verify the embedded signing
profile includes that device before installing. Open **LeadingLight Dev** manually and follow
the acceptance steps below. This build uses `com.leadinglight.dev.ipad`; it is not TestFlight.
If Xcode reports an expired login, refresh it inside Xcode; browser sign-in does not repair it.

For a Personal Team's first device, the generic archive may report that the team has no devices.
Keep the same Tauri build command running with `--open` instead of `--archive-only`, then run
this from `apps/desktop/src-tauri/gen/apple` in another terminal:

```sh
xcodebuild -project leadinglight-desktop.xcodeproj -scheme leadinglight-desktop_iOS \
  -configuration release -destination 'id=YOUR_IPAD_UDID' \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  -archivePath /tmp/LeadingLight-Dev-iPad.xcarchive \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=YOUR_TEAM_ID archive
```

This registers the selected iPad and archives without launching the app. Install the `.app`
from this archive instead. Keep the Tauri command alive until archiving completes, then stop it;
its build context is required by Xcode's Rust script.

## Access to existing notes

The related cloud implementation lives in the **Compare versioning options** chat, currently
in `/Users/pranavkanade/.codex/worktrees/c7fe/LeadingLight`. Its deployed web app is
[LeadingLight Web](https://leadinglight-web.vercel.app). It already includes encrypted journal
sync, offline web storage, history and responsive iPad layouts. That work is not in this
branch. On 2026-10-29 that chat reported Google and GitHub sign-in, session persistence and
logout passing in Safari. Use the same provider across devices; they currently create separate
workspaces. Google remains in testing mode with the user's account enabled.
The latest cloud handoff confirms encrypted note sync in the browser; browser-to-Mac pairing
is next. Native account integration is not included in this iPad build.

The cloud implementation explicitly leaves native account handoff and Mac attachment transfer
unfinished. Its API uses same-origin browser cookies and `/api` routes; a native Tauri origin
cannot use that session. Do not point the native app at the website and grant it native
filesystem capabilities, copy browser cookies, or upload the live SQLite database.

Before promising Mac-to-iPad access, integrate the cloud changes, add native sign-in with a
system-browser callback and account-bound session, and transfer encrypted attachments using
portable identifiers. Verify the same note on Mac and iPad, edits made offline on both,
deletions, wrong recovery keys, images/audio, and sign-out. Use fixture accounts and notes first.

## Native acceptance

With explicit user authorization, Device Hub testing on the physical iPad passed note creation
and editing, cold restarts, Files picker cancellation and retry, PDF preview dismissal and
reopening, and PNG import. With Wi-Fi off, a cold launch retained both attachments and an
offline edit persisted; Wi-Fi was restored afterward. Immediate Home presses preserved a
body edit and a capture in one trial each. These checks do not prove every suspension timing.

Actual onscreen keyboard taps worked in portrait and landscape, including Quick capture Save.
After the rotation fix, the same fifth-paragraph caret stayed visible from portrait to
landscape with the keyboard open, without another tap or character. Multitasking resize and
a very long page remain unverified on hardware; their browser checks passed.
Repeated small resizes exposed a later WebKit scroll adjustment. A single delayed correction
now yields to user input. Focused browser checks and two landscape arrivals on the final signed
build passed: the same fifth-paragraph caret stayed above the keyboard without intervening
editor input. The original PNG and text also survived that update. Evidence:
`qa/report/ipad-device/rotation-final.png` and `final-installed.png` under `apps/desktop`.
A later signed update exposed an old sandbox path in the saved PNG URL. The recovery fix passed
on the physical iPad without reimporting or resetting data. With Wi-Fi off, a cold launch kept
the original PNG and text, and the original PDF opened its fixture text in Quick Look.
Evidence: `qa/report/ipad-device/attachments-recovered-offline.png` under `apps/desktop`.
For repeat acceptance on a separately installed development build:

1. Create a page with a title and a few paragraphs. Leave the app, then reopen it. The latest
   words should remain, including when airplane mode is on.
2. Rotate the iPad and resize it in multitasking. Open the sidebar, choose a page, and open
   Settings. Content should stay readable and the narrow sidebar should close after a choice.
3. Open the onscreen keyboard near the bottom of a long page. The current line should remain
   reachable above the keyboard; dismissing it should restore the app's height.
4. Use Quick capture, save an idea and open it. It should stay inside the iPad app and persist.
5. Add an image and a PDF, reopen the app and turn on airplane mode. The image should remain
   visible; tapping the PDF should open Quick Look. Dismiss it to return to the same page.
   An unsupported file should show an error without leaving the page.

The developer build uses the iPad's own sandbox. It does not read the Mac's production notes.
