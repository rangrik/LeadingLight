# iPhone QA — 2026-11-05

Implemented in `codex/iphone-focus`. The contract is `features/iphone.feature`.
The November 3 checks used isolated data. November 5 added signed development and private release
installs on the user's iPhone and iPad. Both production libraries are now verified; the dev apps
were removed after backing up their data.

## Passed

- Repository typecheck, 45 desktop unit tests, production frontend and documentation builds.
- All six iPhone regressions in Chromium and WebKit: 12 passes. Offline edits, immediate
  Today/Continue, persisted body search, stale-search refresh, capture dismissal, create/update
  failures and retry without duplication, reading-position preservation, keyboard viewport, rotation, settings, real iPhone
  user agent and offline web links.
- Existing desktop smoke/capture and four iPad scenarios in both engines. A desktop slash-menu
  smoke passed on rerun. One iPad WebKit run collided with another runner's trace output folder;
  its isolated rerun passed. Keep future Playwright invocations sequential or use separate outputs.
- Independent browser QA: 375/390 px, landscape, long titles, larger text, dark mode, focus
  trapping, daily notes, internal links and Back, settings/sync entry, sidenotes and save failures.
  It found five defects: stale search, title size, clipped settings, an error toast covering
  Save, and WebKit resetting the reading position. All were fixed and independently retested.
  No remaining functional blocker in those flows.

The requested Sonnet reviewer could not authenticate (expired OAuth). An available independent
Codex subagent performed QA instead. Berth selected the main checkout because multiple worktrees
share the name `LeadingLight`; tests used this checkout's server at `127.0.0.1:41080` instead.

## Native build

`pnpm ios:init`, `pnpm ios:build`, and `pnpm ios:build:iphone` succeeded. The final archive is:

```text
apps/desktop/src-tauri/gen/apple/build/leadinglight-desktop_iOS.xcarchive
```

The app inside is **LeadingLight iPhone Dev**, identifier `com.leadinglight.dev.iphone`.
Inspected the final bundle: arm64 Mach-O, device families `[1, 2]`, minimum iOS 16.4,
iPhone portrait/landscape, iPad's four orientations, privacy manifest, and no desktop runtime,
tmux or transcription executables. It embeds the frontend for offline use.

This November 3 archive is unsigned and has no provisioning profile. It is not on TestFlight.
The final device archive was rebuilt after the simulator fixes; its scene manifest and privacy
manifest are present. The separate November 5 signed builds are recorded below.

## Simulator acceptance

At the user's request, drove the actual native app in Simulator. Xcode's component setup completed;
CoreSimulator is now 1174.9.2. Used isolated simulators and `com.leadinglight.dev.iphone` throughout.

- **iPhone 17, iOS 26.5:** native startup, capture by touch keyboard, Save with the landscape
  keyboard open, portrait/landscape safe areas, note creation, Today/Continue, body-text search,
  background/foreground and termination/relaunch passed. Read the simulator's SQLite database
  to confirm the exact captured text and note body. The embedded build uses no frontend server.
- **iPad Air 11-inch M2, iOS 18.6:** the same bundle launches with the existing sidebar, supports
  writing and rotation, and restores the note after relaunch. SQLite contains the exact note body.
- Found and fixed missing native scene configuration: without it, landscape left the keyboard
  sideways and safe areas in portrait. The single-scene manifest uses the installed Tao 0.37.1
  delegate; independent source review found no compatibility defect.
- Found and fixed capture-footer overflow above the landscape keyboard. Save and Close now stay
  in the header, contents scroll, and save errors scroll into view. All 12 browser phone tests
  passed after the layout change; all four affected tests passed again after the error fix.
  Independent Chromium/WebKit probes also verified long and short drafts at 110px visible height,
  complete error visibility, caret visibility and retry without duplication.
- Final repository typecheck, frontend/docs builds and three desktop capture/smoke checks passed.

The simulator bundle is at:

```text
/tmp/leadinglight-iphone-6c61-derived/Build/Products/debug-iphonesimulator/LeadingLight iPhone Dev.app
```

Tauri's archive helper rejects the installed iOS 26.5 runtime because the SDK is 27.1. The generated
Xcode project builds successfully against the actual simulator. Reproduce the embedded build by
first running `pnpm --filter @leadinglight/desktop build`, then keeping this command running:

```sh
scripts/ios.sh dev 'LeadingLight iPhone QA 6c61' --no-watch --no-dev-server \
  --features tauri/custom-protocol --config src-tauri/tauri.iphone-dev.conf.json \
  --config '{"build":{"beforeDevCommand":null,"devUrl":null}}'
```

When it opens Xcode, build scheme `leadinglight-desktop_iOS`, configuration `debug`, for the chosen
simulator with `CODE_SIGNING_ALLOWED=NO`. The Tauri command supplies the Rust build options.
No SDK versions or simulator metadata were modified to bypass the helper's check.

## Physical signing and installation — November 5

- Both final arm64 development builds passed, and `codesign --verify --deep --strict` passed.
  The embedded profiles include the intended device. Installed **LeadingLight iPhone Dev**
  (`com.leadinglight.dev.iphone`) on iPhone 15 Pro Max and updated **LeadingLight Dev**
  (`com.leadinglight.dev.ipad`) on iPad Pro 11-inch, 2nd generation, both running 27.0.1.
- At the time of these development installs, paid enrollment still showed **Pending**.
  Xcode issued Personal Team profiles expiring November 12, 2026, around 21:31–21:33 UTC.
  The membership activated later on November 5, with renewal November 5, 2027.
- The iPad was updated in place, without uninstalling. Its container path changed, but the
  existing SQLite database, WAL and 14 attachment files remain, with pre-update timestamps.
  This verifies retained files, not an end-to-end check of every note.
- The owner trusted the profile on both devices and confirmed the phone's Today screen.
  The final installed phone process was running. After trust, the iPad launch command succeeded.
  Physical account sync was completed later, as recorded in the production migration section.
- Fixed the browser approval label to say **LeadingLight on iPhone**. The frontend build and
  root phone smoke passed. Independent Chromium and WebKit checks passed for phone capture,
  search, Today/Continue and Settings, and for iPhone/iPad/desktop-UA iPad/Mac approval names
  and matching connection codes. Approval requests were mocked; no account was connected.

The signed products are under `/tmp/LeadingLight-iPhone-6c61-device/Build/Products/debug-iphoneos/`
and `/tmp/LeadingLight-iPad-6c61-device/Build/Products/debug-iphoneos/`. They embed the frontend.
To reproduce, keep the Tauri build-options process running, using the corresponding dev config:

```sh
APPLE_DEVELOPMENT_TEAM=YOUR_TEAM_ID scripts/ios.sh build --ci --target aarch64 \
  --debug --export-method debugging --open --config src-tauri/tauri.iphone-dev.conf.json
```

Then build `leadinglight-desktop_iOS` in the generated Xcode project, configuration `debug`,
with the exact physical device destination, automatic signing and provisioning updates enabled.
Use `tauri.ios-dev.conf.json` for iPad. Check each embedded profile's device list before installing:
a generic archive initially selected the iPad-only profile for the phone bundle and was not used.

## Further hardware coverage

These are additional editing and media checks for the production app. Account connection and
the production-library comparison were completed below.

1. Open **LeadingLight**, create a note, type, immediately go Home, and reopen. Repeat
   in airplane mode and after terminating the app. Expect the latest words, stored in SQLite.
2. Capture a thought, background immediately, and return. Expect the same words and one capture.
3. Type low on a long page, rotate with the keyboard open, then scroll up manually. Expect the
   caret above the keyboard after rotation and no jump back after deliberately scrolling.
4. Record audio and import an image/PDF. Relaunch offline, play the recording and open the PDF.
   Expect local playback and Quick Look, with cancellation returning to the note.
5. Connect a test workspace from **Notes › Account and sync**. Expect Keychain persistence,
   encrypted note/attachment download, and offline edits syncing on a later foreground connection.

Simulator results cover local editing and persistence, but do not establish every physical
device, microphone and attachment workflow above.

## Production identity and icons — November 5

The user requested production apps alongside the dev installs. Built and archived configuration
`release`, then exported locally with Xcode's `release-testing` method. The resulting universal app
is **LeadingLight**, `com.leadinglight.app`, version 0.2.0. It is signed by Apple Distribution with
an Ad Hoc profile covering both physical devices, expiring November 5, 2027. The profile is not a
Personal Team profile and disables debugger attachment. Strict signature verification passed.
No App Store or TestFlight upload was made.

Installed the exported app on both devices and launched `com.leadinglight.app` successfully.
Process checks confirmed the production app remained running. Neither device had this production
bundle installed before; both development bundles were kept. The initial wireless tunnel/DDI
attempts failed; reconnecting and retrying with the devices awake succeeded.

The iOS source assets had retained Tauri's template logo. All 18 now use the existing cream mark
on an ink background. `scripts/ios.sh` copies them into both fresh and existing Xcode projects.
`scripts/ios-icons.swift` writes RGB PNGs through ImageIO after the official Tauri icon generator.
Independent QA caught and fixed an earlier corrupt conversion and a fresh-init copying gap.
All final decoded color bytes match the generated artwork; dimensions, opacity, catalog copies,
helper reproducibility, and init/dev/build/archive/export copy paths passed independent checks.
The iPhone and iPad icons extracted from the final signed app were also visually inspected.

The frontend build/typecheck passed. Parent and independent phone browser smokes passed on retry;
initial runs timed out under heavy concurrent compilation. No UI defect remained. Real account
connection and syncing in the new production identity were completed in the migration below.

Artifacts: `/tmp/LeadingLight-Production-6c61.xcarchive`,
`/tmp/LeadingLight-Production-6c61-distribution/LeadingLight.ipa`, and the verified extracted app at
`/tmp/LeadingLight-Production-6c61-install/Payload/LeadingLight.app`.

## Production migration and iPad safe area — November 5

The bottom iPad safe area now uses the sidebar background in both appearances. Content still
ends above the home indicator. Independent Chromium/WebKit checks passed all 20 iPad/iPhone
scenarios, plus light/dark, portrait/landscape and keyboard safe-area checks. The parent's
short iPad offline writing, settings and capture smoke passed; frontend typecheck/build passed.

Native sync and its exact approval-origin check now use `https://leadinglight.app`, matching
the deployed sign-in migration. Independent local checks passed both browser rollback cases,
the authentication-boundary test and 16 approval URL checks. No production API was used by QA;
PostgreSQL integration checks were unavailable. Other agents' relay work was left untouched.

Private Library backups cover both production and both dev installations. The initial Mac
snapshot has 63 active notes; iPad dev has 48, and both production libraries and iPhone dev are
empty. Every iPad note ID, all 286 history after-snapshots and all 26 distinct attachment byte
hashes exist on the Mac. No iPad note is newer. Both production apps have now been approved
through the normal browser flow. Fresh backups of both production copies match the latest Mac's
66 active objects, all 600 history after-snapshots, type/property definitions and referenced
attachment bytes. All shared current objects match exactly after resolving local attachment paths
by file hash. Both devices showed **Up to date**. Nine old Mac deletion markers without history
were never in the sync journal; they remain in the private Mac backup.

Final dev backups contain no new changes: iPad dev has 65 active objects and 597 history entries,
all represented by the newer production data; iPhone dev is empty. Removed only
`com.leadinglight.dev.ipad` and `com.leadinglight.dev.iphone`. Fresh installed-app inventories
confirm each device retains `com.leadinglight.app` and no LeadingLight dev bundle. Both production
launch commands succeeded after removal. Private before/after Library backups, consistent SQLite
snapshots and the comparison report remain on the Mac under `LeadingLight Migration Backups`.

The updated Ad Hoc release was installed in place on both devices. Its compiled icons match
the verified production artwork, strict signing checks pass, and the physical iPad no longer
shows the lighter bottom band. No recovery key or native credential is stored in this repository.

## Long pages

The 2,000-paragraph document preserved text and fit the phone layout. The 16 ms target was not met:
Chromium input handling measured roughly 25–33 ms during other builds; WebKit next-frame samples
also exceeded a frame. These methods differ and are not phone hardware measurements. The existing
long-page issue remains open in `DEFERRED.md`; measure again on an idle Mac and real phone.

## Evidence

Ignored artifacts in `apps/desktop/qa/report/` include `iphone-*-today.png`, `iphone-*-notes.png`,
`iphone-*-keyboard.png`, `iphone-*-settings.png`, and `iphone-*-save-error.png`.
Independent probes and results start with `iphone-independent-`; the final WebKit screenshots
are `iphone-independent-webkit-final-home.png`, `-final-note.png` and `-final-save-error.png`.
Native evidence includes `iphone-simulator-note.png`, `iphone-simulator-keyboard-landscape.png`,
`iphone-simulator-rotation-before.jpg`, `iphone-simulator-final.jpg` and `ipad-simulator-scene-regression.png`.
The 110px failure probes are `iphone-independent-{chromium,webkit}-110px-save-error.png`
and `-110px-shorterror.png`.

## Liquid Glass — 2026-11-08

The contract is the glass scenarios in `features/iphone.feature` and `features/ipad.feature`;
the design is decision 42. Checked in the browser build and on an iPhone 17 Pro simulator (iOS 26.5).

- `iphone.spec.ts` and `ipad.spec.ts`: 26 of 26 across Chromium, iPhone WebKit and iPad WebKit,
  including new seams for Back to the tab, the tab bar under the keyboard and a notched phone,
  and the iPad safe-area colours. `pnpm check:themes` passes, with the new glass rows: the lowest
  tab bar label is 4.74:1 (github-dark-dimmed).
- Independent QA (Sonnet 5.5, xhigh) ran 30 checks at 375–1180 px in light and dark, with faked
  notches and keyboards. It found the landscape capture button as an oval, the caret under the
  top fade, a faint selected tab, Back walking through older notes and the fade cutting the glass
  shadow. All were fixed and rechecked. A code review found the tab bar under a hardware
  keyboard's shortcut bar, a strip under dialog footers and stale icon docs; also fixed.
- The desktop app shows no design change in 112 screenshot pairs against the branch base.
- Headless typing on a 2,000-paragraph page is no slower than before; blur on or off differs by
  about 1 ms. Playwright WebKit does not paint `backdrop-filter`, so the blur's cost on a device
  is unmeasured.
- On the simulator, safe areas were real (top 62 pt, bottom 34 pt), the capsule sat 22 pt above
  the bottom edge, only the capsule blurred, and the compiled app held the layered icon.
- Not checked on hardware: the real keyboard hiding the tab bar, rotation, the glass beside iOS 27
  system glass, Increase Contrast, and iPad window controls in a resized window. The device
  steps are in the hand-off slides. The iPad simulator stuck on first boot, so iPad was checked in
  WebKit only.

