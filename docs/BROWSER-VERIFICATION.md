# Shared browser verification

2026-10-28 · `codex/browser-parity`

This pass adds saved element and area comments, frozen screenshot attachments,
frame-aware inspection, viewer-owned style previews, page-scoped developer tools,
history suggestions and clearing, and native download preferences. Manual browsing
and agent actions still use the same Chromium tab. Website content stays untrusted.

The MIT repository research and parity matrix are in `BROWSER-RESEARCH.md`.
Decisions 31 and 33 in `DECISIONS.md` explain the architecture and limits.
`DEFERRED.md` records what remains; this is not exact proprietary Browser parity.

## Automated checks

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed after integrating main |
| Desktop unit tests | 34 passed |
| Native Rust unit tests | 8 passed |
| Full headless app suite after main | 151 passed; four failures investigated and rechecked below |
| Browser UI recheck | 31 passed on the final source (2.6 minutes), including every changed browser scenario |
| Go race and real Chromium suite | Passed: all `TestBrowser` cases with `-race` (63.7 s runtime, 1.2 s CLI) |
| Runtime packaging | All 32 patches replay; `v0.3.30-ll.27+b5218455`, build `67eaa1e9bca2` |
| Real-agent probe | Five passed again on the final binary: shared tab, plain folder, two-agent cookie isolation and unchanged folder/user settings |
| Runtime/UI smoke | Passed again on the final runtime: real Chromium input, navigation, dialogs, chooser-bound upload, exact download bytes, popups, feedback, viewport and clearing |
| Native download orchestration harness | Passed: duplicate panes, workspace isolation, bounded/partial writes, cancellation, reload, disk failure and closed panes |
| Independent Sonnet 5.5 QA | Browser build against isolated real runtime; final findings recorded below |
| Isolated macOS app | Final source built and installed as LeadingLight Dev 0c49fc; native UI remains manual |

The first full app run included 155 scenarios. Two failures exposed the same
address-draft bug: redirected and newly allowed pages did not update a focused but
unedited address field. The fix tracks edits separately from focus; both scenarios
passed their focused recheck. A long annotation scenario exceeded its 30-second
total budget and was split at its persistence/upload seam; both parts passed at
normal limits. The legacy feedback failure coincided with a Vite hot update;
its unchanged test passed in isolation. All 31 final browser checks passed without source
edits during the run. The final app suite now contains 159 scenarios after splitting
the long test and adding the Escape, toolbar and same-value input regressions.

Independent QA also found that a failed developer command left an earlier result
visible. The result is now cleared before validation or execution; tests cover
both invalid JSON and a refused command after success. Escape in the style menu
now dismisses that menu first, preserving the feedback draft and preview. The next
Escape closes feedback and resets its preview; remote-page full-view Escape still works.

A final recheck exposed a same-URL paste while the last tab was closing: the
combobox deduplicated an unchanged value, so the close handler did not see an edit.
Raw input now marks that edit even when the value is unchanged. A held-response
regression failed before the fix and passed afterward, without an added sleep.
The 520 px split and 320 px full-view toolbar now give Address its own row; all six
actions remain visible, and the 1280 px layout retains one row.

The runtime tests cover nested same-origin and cross-origin frames, zoom and scroll,
stale frame/document handles, concurrent viewer leases, expiry and cleanup, exact
style restoration, and atomic element screenshots. Capture checks document,
geometry and metadata before and after the image request; a moved or replaced
element fails rather than attaching mismatched evidence.

Developer tests cover default-off settings, explicit page approval, denial,
revocation, navigation and expiry, another tab's isolation, command/parameter
validation, result/event bounds, and stopping a CPU profile on revocation.
Download tests cover destination confinement, collision-safe copies, exact bytes,
restart recovery, prompt claims, concurrent saves and retained active records.
A popup fixture's fixed 500 ms wait was replaced with polling its existing 10-second
navigation deadline after a host-load failure; no product timeout was increased.

Evidence is kept in the main checkout under
`apps/desktop/qa/report/browser-parity-2026-10-28/`, including logs, screenshots and
real-agent/UI reports. These are ignored local verification artifacts, not app data.
Previous baseline evidence remains under `apps/desktop/qa/report/sonnet-browser/`.

## Merge and packaging

Main through `747fdd9` was integrated before validation, including the writing
review feature. The user authorized finishing and merging after tests. Native
build success does not establish that OS menus and dialogs were exercised.
No native window was automated, and no user notes or browser profile were used
by the isolated runtime tests.

## Native checks

Use the installed LeadingLight app. Browser tests cannot establish WebKit's OS
menu behavior or prove that native file dialogs work with the person's folders.

1. Open Browser and a page with a text field. Try typing, Select All, Copy, Cut,
   Paste, Undo and Redo through the Edit menu and keyboard shortcuts. Each action
   should happen once. Switch to a note; the same actions should edit that note.
2. In Settings → Browser choose a download folder and download a file. It should
   appear there once. Enable Ask where to save, download again, cancel once, then
   choose a destination on another download. Cancellation should not reopen the
   dialog after an app reload; manual Save should still work.
3. Sign in to a site of your choice, quit and reopen, and restore its tab. The
   sign-in should remain. Clearing history alone should keep that sign-in;
   clearing website data should sign out only this workspace, retaining bookmarks
   and files already downloaded.

Audio transport, camera/microphone permission flows, native page accessibility,
extensions/profile import and cloud browsing remain architecture work. Developer
access covers an approved page, not unrestricted browser-wide CDP. Text replacement,
rotated/skewed/mirrored frame picking and time-scoped website-data removal also
remain explicit gaps. History time ranges are implemented.
