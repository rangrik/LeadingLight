# Notebook integration check — 2026-11-11

The original failure hid the document body and metadata when `paper` was added to
its properties. The stored blocks were still present. This revision removes that
conversion and gives new notebooks a fixed Notebook type.

## Flow and evidence

1. Create or open a document. Its Record and mobile Photo actions are in the pane
   header. There is no second persistent capture row.
2. Choose Page actions → New linked notebook. Pending document edits save first.
   A separate Notebook stores the Notes on relation; the source is not rewritten.
3. Write or place text. Notebook options contains paper style, zoom and history.
   Notebook details opens metadata without moving the paper; on phones it lives
   in Notebook options, leaving room for the title and one-tap capture.
4. Return to the source and reopen its linked notebook. Both keep their own content,
   metadata and history. Deleting the source leaves the notebook available.
5. Open an older page with both blocks and paper. The full document appears before
   the handwriting. Opening it does not migrate, rewrite or discard either body.

Before screenshots: `/tmp/leadinglight-integration-qa/shots/01-document-before.png`,
`02-write-hides-document.png`, `03-details-reveals-document.png`.
After screenshots and independent scripts: `/tmp/leadinglight-integration-independent/`.
Design review: `/tmp/leadinglight-notebook-integration-review.md` (Claude desktop,
Fable 5.2 Extra, design only).

## Automated checks

- 20 Chromium scenarios passed: 11 integration checks and nine reading/capture
  regressions. Includes pending text and metadata, all three viewport widths,
  failure/retry/concurrent creation, source deletion, type guards, templates, legacy
  mixed content, history, source-preserving OCR and capture, sidenote completion,
  imports, paper persistence, empty sources, long metadata, title paste, unsupported
  paper and history copies keeping the source's original notebook link.
- All 11 integration scenarios passed in WebKit.
- Workspace typecheck and docs build passed.

Independent Sonnet 5.5 xhigh QA used isolated headless Playwright contexts because
this worktree has no configured Berth browser. It checked stored data as well as
screenshots. Its first pass found history-copy link takeover, blank history preview,
unsupported paper opening a document editor, invalid Notes on choices, stale Text
tool state, narrow phone headers and clipped metadata. These were fixed. The visual
recheck caught a zero-height history preview that DOM-only assertions missed;
the regression now also checks the viewport height and visible text position.
All three affected history checks passed again in Chromium and WebKit. The final
independent paint check passed at 900 and 1400 px height, including scrolling to
later text, no mutation while viewing and restore. Reports are
`/tmp/leadinglight-integration-independent/report-final.md` and
`/tmp/leadinglight-integration-independent/report-history-final.md`.

The 2,000-paragraph check retained every paragraph. Editor dispatch was p50 2.2 ms,
p95 2.9 ms and max 6.3 ms, with roughly three dispatches per key. Key-to-frame samples
measured two animation frames, so they cannot establish a one-frame 16 ms budget.
Occasional 50–57 ms long tasks need a separate trace; see `docs/DEFERRED.md`.

## Physical iPad

Installed the signed development build in LeadingLight Reading Test. Backed up its
Library first to `/tmp/leadinglight-integration-ipad-backup`. The post-test SQLite
comparison confirms all five pre-existing pages retain exactly the same titles,
blocks and properties. SHA-256 comparison also confirms all 45 pre-existing
attachments are unchanged. Only the disposable Notebook integration QA page was
added. Evidence: `/tmp/leadinglight-integration-qa/ipad-preservation-final.json`.
The production app was not modified.

Passed through Device Hub:

- Existing mixed page shows its original document text and handwriting.
- New notebook opens without focusing a title or hidden editor.
- Text arms placement without opening an editor; a finger tap places the note.
- Command-Enter and Finish typing end editing and return the active tool to Pen.
- Text mode selects a note; a second tap edits it. Back returns without restoring
  hidden document focus.
- Portrait and landscape retain the typed note and position.
- Details shows the fixed Notebook type, Notes on and Tags. Renaming then pressing
  Return closes details without focusing the hidden document body.
- App relaunch preserves the new title, typed note and position.
- The final installed build shows the notebook's typed text in history. Both
  history and details close controls clear the status bar and respond to touch.
- Zoom opens its submenu. Selecting and editing the existing test text, then
  Finish typing and Back, returns without a keyboard or hidden editor focus.

Device Hub keyboard capture was switched off again, and landscape restored.
The iPad is left on Notebook integration QA. The final Mac development build is
installed as LeadingLight Dev 6b878c; no native Mac window was automated. Both builds
include the final history layout fix. The temporary browser server is stopped.
No commit, merge or production installation was made.

## Limits

The remote session cannot generate physical Pencil double tap, squeeze, pressure or
palm input. The new handlers compile and read the system preferences; physical
Pencil acceptance remains unverified. A hardware keyboard connection suppresses the
full software keyboard in this device session, so its actual expanded layout also
needs physical acceptance. Command-Enter and the explicit Finish typing path passed.

Browser paper Undo, safe migration of old mixed pages, notebook templates, and
multiple-notebook quick selection remain in `docs/DEFERRED.md`. Existing mixed pages
remain usable without migration. Tests of sync use fixtures, not a live two-device
conflict. This pass does not claim a new real spoken-transcription or camera OCR test.
