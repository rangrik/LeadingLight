# Recording selection and native focus — 2026-10-29

Fixed dropped typing after clicking the text below a recording. The separate native
click failure occurs during Computer Use's background activation; capture and Play
work when the app is actually brought forward through Finder.

## Editor fix

A reopened page beginning with a voice block starts with that block selected. A
click moves the browser caret into the transcript, but ProseMirror can still hold
`NodeSelection(0)` until the browser sends `selectionchange`. Our protection against
typing over selected blocks then discards the first keys. A failing run captured
exactly that mismatch: focused editor, DOM caret in the paragraph, recording selected,
and no inserted text. This was not a save overwrite.

`BlockSelectionExtension.handleClick` now changes a whole-block selection to a text
selection during a plain click in editable text. It leaves modifier clicks, controls,
read-only content and dragging alone. The input guard still protects selected blocks.
A deterministic regression holds `selectionchange`, performs the real click and keys,
and verifies the edit and recording. It failed before the fix and passes with it.

## Validation

- Typecheck and all 24 focused editor, voice, review and capture-recording tests pass.
- The previously intermittent capture-review scenario passes 20 consecutive reruns.
- The full capture-review test checks the edit immediately after typing and again
  after creating a page from the original transcript.
- Independent QA passes for immediate typing, selected-block protection, Meta-click,
  text dragging and visual inspection. Sonnet 5.5 and Berth were unavailable; an
  available Codex agent used headless Playwright on port 1460.
- On 2,000 paragraphs, baseline/fixed typing averages were about 11 ms, with p95
  about 15–16 ms. Both had occasional 20–21 ms samples; no regression was measured.
- The rebuilt native app accepts the edit, keeps the original transcript in Review,
  saves both correctly to SQLite, and plays audio after Quick capture → Escape.

Live microphone capture/playback had already passed before this edit: roughly
10 seconds in main and a 6-second capture take preserved through Stop + Escape.
Deterministic transcription and Task + Project creation used the existing generated
speech fixture, separately from the live microphone check. The fixture text is
“Write a short plan for the garden plant tomatoes on Saturday”.

## Native activation boundary

Computer Use can deliver AppKit mouse events while the app has no key window and
is not the foreground process. After a background capture closes, those clicks may
never reach the webview. It also happens with an empty capture, without recording.

Opening the dev app through Finder before Quick capture → Escape → Play succeeds.
The diagnostic trace shows capture relinquishing key status, main becoming key
again, and Play reaching the DOM (1793316699083–1793316699765 Unix ms). The rebuilt
app passes the same sequence. Use real macOS activation when testing this path;
selecting a Computer Use target alone does not establish it. No native focus code
was changed: returning to the previous app remains required by decision 14.

## Evidence and state

Local evidence is in the ignored folder `apps/desktop/qa/report/native-focus-2026-10-29/`:
`agent-selection-result.json`, `agent-qa-results.json`, `agent-performance-results.json`,
`events-followup.jsonl`, `native-fixed-edit.png`, `native-fixed-review.png`,
`native-fixed-final.txt`, and `native-fixed-saved.json`. Earlier traces and diagnostic
source are preserved there; temporary tracing is removed from product source.

Branch: `codex/native-recording-focus`, base `188123a8ad4d80bfe655ea5aef1b10b083d2d645`.
The pre-merge native check used `/Applications/LeadingLight Dev 560b2f.app` with
isolated QA data. Its executable SHA-256:
`82553084182e3de36efb6074af1244deb428bef97800b86fb497089e9fd1db07`.
