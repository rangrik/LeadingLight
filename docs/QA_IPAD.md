# iPad checks — 2026-10-28 and 2026-10-29

Browser checks ran in the isolated `codex/ipad-app` worktree using fixture notes at localhost:1437.
Physical iPad checks followed after the user explicitly requested "you test it". No production
notes were read, copied or changed; the device checks use only fixtures in LeadingLight Dev.

| Check | Result |
| --- | --- |
| Repository typecheck | Passed |
| Desktop create/write/reload smoke | Passed |
| Existing saving and capture regressions | 7 passed |
| Native iPad identity selects native storage without Mac capabilities | Passed in Chromium and WebKit with a mocked native identity |
| Attachment tap selects iOS preview with a filename only | Passed in both engines with a mocked native bridge |
| Native preview rejects traversal, missing files and symlinks outside assets | Focused Rust test passed |
| Narrow touch navigation, offline edits, Settings, capture Save/Close/Open beside | Passed in Chromium and WebKit |
| Sidebar remains reachable after opening a second narrow pane | Fixed during review; passed in both engines |
| Narrow capture Project picker and webpage choices | Fixed during independent QA; passed at 390 px in both engines |
| Rust library for arm64 iOS Simulator | Compile check passed |
| Mac Rust library with desktop code enabled | Compile check passed; packaging resources omitted for this check |
| Production frontend | Built successfully |
| Unsigned arm64 iOS device archive | Built; iPad device family, four orientations, minimum OS 16.4 |
| Quick Look native plugin | Physical iPad opened the fixture PDF, dismissed it and opened it again |
| Simulator app package | Blocked: Xcode SDK 27 has no matching installed simulator runtime |
| Physical iPad and native SQLite persistence | Fixture title and body survived cold relaunch; single immediate-background trials retained a body edit and capture title |
| Native Files picker | Cancel returned to the unchanged placeholder; reopening and selecting the fixture PDF succeeded |
| Native image persistence and offline behavior | PNG rendered after Files import and cold relaunch with Wi-Fi off; PDF preview and a new edit also survived offline relaunch |
| Native attachment paths after an app update | Initial update broke the existing PNG; the corrected signed update restored the same image without reimporting it |
| Native rotation and keyboard behavior | Portrait keyboard taps and landscape capture Save passed; after the fix, rotation kept the existing caret visible without another input |
| Hardware long-page behavior and multitasking | Not verified |
| Account login and Mac-to-iPad sync | Pending integration with the separate cloud work |

The focused regression is `apps/desktop/qa/ipad.spec.ts`. Screenshots are in the ignored
`apps/desktop/qa/report/` folder. Browser tests use IndexedDB; the mocked identity test verifies
capability selection, not a running native SQLite instance.

Independent QA ran through Claude Sonnet 5.5 at xhigh. Berth is unavailable in this checkout,
so it used headless Playwright. Evidence lives in `qa/report/ipad-independent/` under the desktop
app. Its final sweep had 56 passing checks across 390, 600, 820 and 1180 px in Chromium and
WebKit: touch layouts, rotation, navigation, capture and absence of fake local agents. No
confirmed browser defect remained in the tested paths. Its full report is
`qa/report/ipad-independent/REPORT.md`.

A 2,000-paragraph page received 24 real key edits at 200 ms intervals in each engine. Synchronous
editor dispatch had a maximum of 4.5 ms in Chromium and 6 ms in WebKit. Input-to-next-frame timing
was less stable during concurrent builds (maxima 29 ms and 51 ms), so this is not an iPad hardware
60 fps claim. The text arrived at paragraph 2,000. See `perf-parent.json` and `long-*.png` in the
independent evidence folder.

A focused Sonnet 5.5 xhigh caret pass found a later WebKit scroll moving the caret below the
pane during repeated browser resizes. The initial suite passed 16/16 in Chromium and 15/16
in WebKit; a separate WebKit reproduction missed 7/14 cycles. After the final correction,
the affected WebKit sequence passed 14/14 cycles, and the focused late-scroll and manual-wheel
cancellation regression passed in Chromium and WebKit (2/2). The final rerun covered those
affected paths only. Evidence is in `qa/report/ipad-independent/rotation-REPORT.md`,
`rotation-final-webkit.json` and `rotation-final-focused-log.txt` under the desktop app.
Browser viewport changes and simulated keyboard heights do not replace the device checks below.

Remaining native acceptance and sync requirements are in `IPAD.md` and `DEFERRED.md`.

The initial unsigned archive was built at
`apps/desktop/src-tauri/gen/apple/build/leadinglight-desktop_iOS.xcarchive`, with the
capture/header fixes and scoped attachment preview. Fresh `ios:init` regeneration was checked;
no edits to ignored Xcode files are needed to reproduce it. The later signed development
installation is recorded below.

## TestFlight preparation — 2026-10-29

`IOS_BUILD_NUMBER=1 pnpm ios:archive` passed with the release configuration, marketing version
0.2.0 and build 1. Independent inspection confirmed an arm64 device executable, matching dSYM,
the app-root privacy manifest, opaque icons, launch storyboard and four iPad orientations.
The release binary has no debug inspector strings. This packaging check did not open the app.

Shell syntax and plist validation passed. Invalid build numbers and a missing distribution
team stop the release commands before building. The export options select App Store Connect,
preserve the explicit build number and export locally without uploading.

The archive is unsigned. App Store Connect authentication, signing, upload and Apple's
validation remain pending. SQLite's `statfs`/`fstatfs` imports remain an unresolved privacy
declaration issue recorded in `DEFERRED.md`; the archive is not yet ready for distribution.

## Direct iPad install — 2026-10-29

Installed **LeadingLight Dev 0.2.0** (`com.leadinglight.dev.ipad`) on the user's connected
iPad Pro (11-inch, 2nd generation), running iPadOS 27.0.1. Developer Mode is enabled. After
refreshing the expired Xcode login, a build targeting that iPad registered it with the Personal
Team and created a development provisioning profile. No paid membership or TestFlight was used.

The signed archive is `apps/desktop/src-tauri/gen/apple/build/leadinglight-ipad-dev.xcarchive`.
Strict code-sign verification passed; the embedded profile includes the target iPad and matches
the dev bundle. Independent inspection confirmed native identity selection, bundled frontend,
arm64 device code, the privacy manifest and absence of Mac sidecars. `devicectl` reported a
successful install, and a separate app listing confirmed the name, identifier and version.

The profile expires November 5, 2026 at 12:16 AM Pacific. Re-sign and reinstall before then to
continue testing. Existing Mac notes have not been transferred. Build processes were stopped.

## Physical iPad checks — 2026-10-29

The user explicitly requested "you test it", authorizing direct native testing for this pass.
The main agent controls the connected iPad through DeviceHub and uses fixture notes in
LeadingLight Dev. These checks exercise the installed app and native SQLite, not the browser mock.

| Check | Observed result |
| --- | --- |
| Fixture title and three body paragraphs, then cold relaunch | All text retained |
| Type final body marker `7`, immediately send the app Home in the same UI call, terminate and relaunch Dev | Marker retained |
| Type final quick-capture title marker `8`, immediately send the app Home, terminate and relaunch Dev | Marker retained |
| Insert a File block with `/file`, choose a file, then cancel the iOS picker | Returned to the unchanged attachment placeholder |
| Reopen the picker and select `sample.pdf` | Attachment displayed its filename and 2 KB size |
| Tap the PDF, dismiss Quick Look with its close button, then tap the PDF again | Both previews opened; the fixture's unique PDF text was visible |
| Import the fixture PNG through Files | Image rendered in the note |
| Type using actual onscreen keys in portrait | Text entered correctly |
| Enter `Tap` in landscape quick capture and tap Save | Capture saved using the visible button |
| Rotate left with the onscreen keyboard open at the existing fifth paragraph | Initially the caret fell below the pane until another key; after the fix, caret y644 was above the editor bottom y752 immediately, with no intervening tap or key |
| Repeat physical rotations with the keyboard open and no text edits or taps between orientation changes | All four landscape arrivals kept the same fifth-paragraph caret visible; this does not cover every browser resize sequence |
| Install the corrected signed update over the same Dev app | The original PNG rendered again without reimport or data reset; title, body and PDF row were retained |
| Cold-relaunch the attachment-recovery build with Wi-Fi off | Original title, body, capture fixtures and recovered PNG remained; `sample.pdf` opened its unique fixture text in Quick Look |
| Install the final delayed-scroll correction and repeat rotation with the keyboard open | Original text, captures, PNG and PDF row survived the update; both landscape arrivals kept the existing fifth-paragraph caret y657–681 above pane bottom y752 without another input; the original PDF also opened its unique text in Quick Look |
| Hardware long-page caret behavior and multitasking resizing | Not verified |
| Confirm Wi-Fi off in Settings, then cold-launch Dev | Note, PNG and PDF attachment remained intact; the PDF opened in Quick Look |
| Add `Offline edit works.` to the first paragraph, then cold-restart with Wi-Fi still off | The new text was retained |
| Open Appearance in the installed app | Light/dark mode and system-appearance wording displayed correctly |

Device evidence is in `apps/desktop/qa/report/ipad-device/`: `leadinglight-ipad-pdf-preview.png`,
`leadinglight-ipad-offline.png` (before the additional offline edit),
`leadinglight-ipad-keyboard-portrait.png`, `leadinglight-ipad-keyboard-landscape.png`,
`rotation-fixed.png`, `rotation-repeated.png`, `rotation-final.png`, `attachments-recovered.png`,
`attachments-recovered-offline.png` and `final-installed.png`.

Wi-Fi was restored and rejoined the original network after offline checks. The app was left
on the original fixture note in portrait with the keyboard and capture box dismissed.

Each immediate-background case was one trial. These passes do not establish correctness for
every suspension timing. CaptureBox does not register with the shared lifecycle flush; that
remains a code risk, although the capture trial did not reproduce lost text.
