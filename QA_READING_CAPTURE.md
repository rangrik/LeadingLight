# Reading capture checks

## Latest notebook integration pass — 2026-11-11

See [Notebook integration QA](docs/NOTEBOOK-INTEGRATION-QA.md). New notebooks are
separate objects with a fixed type and an editable Notes on relation. Ordinary pages
no longer convert or hide their body. Old mixed pages show both surfaces. Capture
actions use the existing header; notebook metadata opens in a sheet. Text completion
returns to Pen, and Pencil gesture handlers follow system preferences.

20 Chromium checks and 11 WebKit integration checks passed; the final three history
checks passed again in each engine after a visual recheck caught a collapsed
preview. Independent Sonnet 5.5 xhigh QA and physical iPad checks are recorded in the
report. Both isolated test apps include the final fixes. All five original iPad
pages and 45 attachments match the backup; only a disposable test notebook was added.

The earlier sections below describe previous builds, including the removed Write/
Handwrite conversion and earlier-notes disclosure. Follow the latest
[capture guide](apps/docs/capture/reading.md) for the current controls.


2026-11-10. Branch `codex/reading-capture`; isolated test data only. No commit or
production app replacement. iPad: **LeadingLight Reading Test**. Mac:
**LeadingLight Dev 6b878c**.

## Notebook visual revision, 2026-11-11

The user identified the whole visual design as the problem and rejected the first
revision. Fable 5.2 with Extra effort supplied a second, concrete HTML prototype.
The implementation now uses warm paper, a title on the sheet, plain/ruled/dotted
styles, a flat native tool row and small capture sources beside their text.
The owner has not yet accepted this revision’s design.

Verified in this pass:

- Workspace typecheck, docs build, signed arm64 iOS archive/export and isolated Mac
  dev installation passed. The final apps are LeadingLight Reading Test on iPad
  and LeadingLight Dev 6b878c on Mac. Production and the user’s Untitled note are untouched.
- Nine reading regressions passed, including failed-save retry and real touch placement. Nine
  notebook browser checks passed across desktop/iPad/iPhone. Four follow-up visual
  and phone-control checks passed; earlier-document-note navigation passed on all three.
- Opening or zooming preserves stored ink and item coordinates. Paper styles persist
  without changing them. Audio sources move beside their text without changing the
  stored recording, and a saved photo can open at full size.
- The real iPad retains existing ink and text through both app updates. The new tool
  row, selection outline, width resize, Undo, paper-style change and reopening passed.
  All pens opens PencilKit; its selection updates the toolbar. Choosing a flat tool
  hides the palette. Camera opens with one action; Cancel returns without a new image.
- Record starts and stops from the new toolbar without moving the sheet while active.
  The remote device again returned a zero-length take and No speech found. This does
  not verify live spoken capture; the earlier known-audio recognition check remains
  separate. Pencil pressure, palm rejection and camera focus need physical input.

Independent Sonnet 5.5 xhigh QA is recorded under
`/tmp/leadinglight-notebook-independent/`. Its first pass found a failed-save path
that could hide an unsaved recording; Quick record now retries that take first.
It also found clipping and overlap around selected phone notes. Follow-up changes
keep the menu and width handle inside the viewport and clear of the source button.
The final independent recheck passed every issue kept in this revision: saved-take
retry, touch placement, selection clipping/overlap, source context menus, active Text
indicator, menu alignment and stable capture controls. The report is
`/tmp/leadinglight-notebook-independent/report-v2.md`; its final checks ran against
the 00:40:25 source snapshot. Seven additional local checks passed fixed toolbar
positions, audio context deletion and 320 px recording. Source photo deletion passed
on all three layouts and keeps the recognized words.

Three browser details remain explicitly deferred in `docs/DEFERRED.md`: keyboard
undo for paper item edits, grip ownership in very small Fit previews, and the retry
card expanding above the paper on a failed save. There is no configured Berth browser,
so QA used headless Playwright against port 1437.

The iPad is left on Reading capture test, ruled paper, Pen active, palette hidden.
Keyboard capture is off; recording and camera are stopped. No native Mac window was
automated. Source and screenshots for browser fixtures are under
`/tmp/leadinglight-notebook-qa/`; these are test notes, not the owner’s writing.

## Earlier full-paper checks on the physical iPad

Tested the iPad Pro 11-inch (2nd generation), iPadOS 27.0.1 through Apple's Device
Hub with the user's permission. Auto-Lock remains Never, as set by the user.

Passed:

- Whole-page ink with a typed thought between two strokes; no new image block.
- Text placement, drag, resize, tap Move then tap a destination, and switching
  between Pen and Text. Ink stays in place while text moves.
- Done, reopen, app updates, and relaunch without pressing Done preserve ink,
  text and positions. The native recovery draft is retired after database save.
- One-tap Record from the document opens paper and starts recording. Shift+Command+R
  stops and keeps the audio. Silence keeps the source with a useful retry message.
- Pressing Done during recording stops it, closes immediately and keeps its audio
  on the paper for later transcription retry.
- The native speech recognizer inserts an editable text box from a known audio
  fixture. The original source remains. New captures start below existing writing.
- Photo opens the rear camera directly. Accepting a photo keeps it on the paper
  even when no text is found. Cancel returns without adding a photo. Item Undo
  removes a test attachment while keeping existing ink and text.
- Command+Enter and the touch finish control close a sidenote and restore document
  focus. E-ink appearance works on the device.

Earlier capture checks also passed native Vision OCR of a known image, legacy ink
block editing, erase/undo/redo, and the Mac's compiled OCR/speech helpers. The audio
fixture was copied into the isolated test app after the live microphone captured
silence. This proves recognition and insertion separately from real spoken capture.
Remote input cannot establish Pencil pressure, palm rejection or camera focus.
Pencil-only drawing is restored after remote touch-ink checks.
Device Hub's keyboard capture is off again.

## Browser and build evidence

Independent Sonnet 5.5 xhigh QA drove desktop, iPad and iPhone browser layouts.
It found no data loss. Its report is `/tmp/leadinglight-paper-qa.md`, with screenshots
and scripts in `/tmp/leadinglight-paper-qa/`. There is no configured Berth browser
in this workspace, so QA used headless Playwright.

Fixed from that review: stretched ink previews, hidden earlier notes, excessive
history writes, small touch targets, writes merely from opening a paper, clipped
long text, overlapping narrow controls, missing-preview feedback, changed ink colours
in dark appearance, and capture placement. Empty paper can return to the document.
Native Done can close during recognition while retaining the source for retry.

- 45 Chromium regression checks passed across reading, appearance, saving, capture,
  voice review and mobile layouts. The final seven reading scenarios passed again.
- WebKit passed five paper core/ink scenarios on iPad and the ink/synced-layout
  scenario on iPhone. Text and ink stay separate; extending paper does not stretch ink.
- Six additional WebKit checks passed on iPad/iPhone for empty-paper removal,
  missing-preview retry and unchanged ink colours with readable text in dark mode.
- Immediate reload after the last paper edit passed on both iPad and iPhone WebKit,
  before the debounced save could run.
- Focused checks passed source-preserving OCR, removal during recognition,
  repeated recordings, keyboard-only capture, permission retries, save failures,
  recovery on reload, earlier document notes, 44 px touch handles, and unchanged
  saved contents when opening synced paper. Sync here uses fixtures, not real devices.
- Forty text keystrokes now produce one history entry after the typing pause,
  while an immediate local recovery copy protects unsaved edits.
- Typecheck, eight attachment-sync tests, 25 theme checks, docs build, Mac dev build
  and signed arm64 iOS builds passed.

Several QA script failures were test errors: reading storage before the 600 ms save,
not reopening the iPhone Notes tab after reload, a page named Notes matching the
navigation button, a closed EPUB picker, and 43.999996 px rounding. Corrected copies
and rechecks are in `/tmp/leadinglight-paper-recheck/`; original evidence is retained.

## Remaining checks with the owner

1. In **LeadingLight Reading Test**, open **Reading capture test**, tap Write,
   and write with Apple Pencil while resting your palm on the display. Choose Text
   to type between passages, then Pen to continue. Back and Write should retain
   both ink and editable text in place.
2. In either test app, press Record, speak a sentence and Stop. Confirm playback and
   the editable transcript. On Mac, Shift+Command+R performs the same start/stop
   while LeadingLight is in front. Native Mac UI was not automated per AGENTS.md.
3. On iPad, import a PDF through Reading library and Files. Check its numbered
   sections and Open original. Browser PDF extraction passed; this native Files
   handoff, physical iPhone capture and production cross-device sync are unverified.

Protected Kindle/Libby content opens in its authorized reader with a linked notebook.
Eligible PDF/EPUB files import into reading sections with normal annotations and
sidenotes. Annotation over the original PDF layout remains deferred.
