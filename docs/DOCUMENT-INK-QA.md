# Document handwriting check — 2026-11-11

Documents now keep handwriting over their blocks and in spaces between blocks.
Entering writing mode changes no stored content, type or metadata. The header
switches tools without adding a second toolbar. Existing notebook files are not
migrated. An annotated list moves and copies as a visibly selected whole list.

Ink follows unchanged marked words when their line shape is unchanged. If the
words or line shape change, Review handwriting retains the original text or image
and its drawing. Restoring the words and layout restores the overlay.

## Browser evidence

- All 11 document-ink scenarios passed in Chromium and WebKit: mode preservation,
  text edits and reflow, real block drag, duplicate/erase independence, delete/undo,
  growing handwriting space, continued typing, save failure/retry, history paint,
  image resize/replacement, clipboard, held-stroke saves, unknown live content,
  heading geometry and whole annotated lists. Ordinary lists still act on items.
- The final held-stroke test also attempts a live replacement after the preceding
  stroke has saved. The active stroke counts as dirty and blocks that replacement.
- All 26 existing editor, notebook integration and reading/capture scenarios passed.
- Nine sync-asset tests passed, including dense ink in both sides of a history event
  and preservation of original snapshot images. Extended point objects still pass
  through attachment validation.
- Workspace typecheck and documentation build passed.

Independent in-session QA found and verified fixes for heading movement, selected
text typing at a stale caret, list-copy anchoring, repeated original-context panels,
and a tool menu consuming the first drawing gesture. Eight final independent checks
passed, including immediate erasing outside a block, independent copy erasure and
the 320px phone menu. Screenshots were visually inspected.

External Sonnet QA was blocked by automatic approval review because it would share
private source with Claude. The user chose to keep QA within this session; the
independent pass used a separate in-session agent and disposable browser contexts.

The 2,000-paragraph page retained all paragraphs and its annotation. Editor dispatch
was p50 2.7 ms, p95 4.0 ms and max 8.0 ms across 222 dispatches. These are editor
update timings, not a claim about complete frame rendering or physical Pencil latency.

Evidence is in `/tmp/leadinglight-document-ink-qa/`, including `agent/verified`,
`webkit`, `previous-regressions`, `long-page.json` and the two `sync-guard` directories.
Independent evidence is in `/tmp/leadinglight-document-ink-independent-internal/`.
The final selection-cleanup revision passed all 11 WebKit scenarios again and five
additional independent checks for selection position, drawing and continued typing.

## Device verification

The test app's data was backed up before installation to
`/tmp/leadinglight-document-ink-before`: eight existing pages and 45 attachments.
Installed the signed development build in LeadingLight Reading Test. Through
Device Hub touch and hardware-keyboard input, the disposable Document ink QA page
passed these checks:

- Enter writing without hiding text or metadata; the keyboard accessory closes.
- A finger does not draw by default. Draw with finger enables immediate drawing.
- An underline stays with its words after a prefix is inserted.
- Replacing an underlined word keeps the caret correct and shows the original
  context with ink. Undo restores the word and aligned overlay.
- Cut and paste moves a complete annotated block below other paragraphs, retaining
  its ink through the iPad clipboard.
- Insert handwriting between paragraphs; strokes near the bottom grow its space.
  Continue typing creates a new paragraph before the existing following text.
- Portrait and landscape retain both ink types and the order of typed paragraphs.
- Entering Write from selected text clears selection handles, the formatting menu
  and keyboard accessory. A newly inserted handwriting space has no blue tint.
- Drawing in that space works immediately after choosing Draw with finger. Undo
  removes the stroke, then removes the new space without changing adjacent content.
- A fresh launch retains all 21 words, the between-block strokes and the moved
  paragraph's underline. The app was left in landscape, outside writing mode, with
  finger drawing and Device Hub keyboard capture off.

Device testing also exposed a lingering text-selection menu and selected-node tint
while drawing. Both were fixed and passed the final physical-device recheck.

The final signed iPad test app and isolated LeadingLight Dev 6b878c Mac app are
installed. Production was not replaced. The final iPad data copy is at
`/tmp/leadinglight-document-ink-after`. All eight original pages match their backed-up
content, type, title, properties, creation and deletion state. All 45 original
attachments match byte for byte (SHA-256). Only one disposable page was added.
The comparison is recorded in
`/tmp/leadinglight-document-ink-qa/ipad-preservation-final.json`.

## Limits

Inline drawing currently requires normal page zoom. Pinching finishes the stroke;
the app asks for normal zoom before drawing again. Device Hub cannot generate
physical Pencil pressure, palm input, double tap or squeeze. Those hardware paths
must be checked with an actual Pencil before claiming acceptance. The hardware
keyboard connection also limits verification of the expanded software keyboard.
Block movement on the physical iPad was checked with cut and paste. Handle drags
passed in Chromium and WebKit with real mouse input; remote touch dragging did not
establish a successful long-press drag.

All editing devices should run the updated app. Older releases cannot inherit the
new live-content preservation guard. No live two-device sync conflict is claimed by
the browser fixture tests. No commit, merge or production installation is included.
