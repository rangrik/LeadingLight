# Reading capture

Research, 2026-11-10. Keep the physical book open and capture into its page.

| Reference | Useful pattern |
| --- | --- |
| [Apple Notes](https://support.apple.com/en-afri/guide/ipad/-ipada87a6078/ipados) | Pencil and finger drawing belong to the note. |
| [Goodnotes](https://support.goodnotes.com/hc/en-us/articles/7353695997199-Convert-handwriting-to-text) | Select handwriting and turn it into editable text. |
| [Notability ink](https://support.gingerlabs.com/en-us/articles/16300114-handwriting-and-math-conversion) | Erase, select, move and resize ink; search recognised words. |
| [Notability audio](https://support.gingerlabs.com/en-us/articles/16300122-recording-and-playing-audio) | Recording is a direct action; the source audio stays available. |

Essential: native Pencil input, palm rejection, pen/highlighter/eraser/selection,
undo/redo, editable strokes saved with a preview, one-action recording on every
page, on-device transcription, direct camera capture, OCR into editable paragraphs,
and a keyboard or touch action to finish a sidenote. Failure must keep the source.

Secondary: zoom, stroke selection and movement come with PencilKit. Text extraction
also works on saved images and ink. PDF annotation, custom paper templates, shape
recognition, live transcripts and replay tied to individual strokes need separate work.

Store paper layout in the existing page properties. Ink, previews and captures use
the existing encrypted attachment sync. PencilKit supplies the drawing controls;
positioned text stays editable on the paper. Ordinary document pages keep their
block editor, and their recognition results remain editable paragraphs.

The paper model follows [Goodnotes’ Text Tool](https://support.goodnotes.com/hc/en-us/articles/7353727615375-Type-text-with-the-Text-Tool): a whole handwriting page with movable typed text boxes. Ink is not an image block; text and strokes remain separately editable.

## Notebook visual revision, 2026-11-10

[Fable 5.2, Extra effort](https://claude.ai/epitaxy/local_74282830-b1ca-489a-8d65-c8a64ef80243)
reviewed the source and screenshots. The user rejected the first implementation’s
visual design. Fable’s second handoff is `/tmp/leadinglight-notebook-direction.md`
and its HTML prototype is `/tmp/leadinglight-notebook-direction.html`.

Warm paper, a title on the sheet, faint ruling and flat tools now carry through web
and native notebooks. Plain, ruled and dotted styles are view settings; changing
them never moves or recolours saved ink. The native row exposes drawing tools,
Text, undo/redo and capture; the full PencilKit palette is under All pens. The header
sits outside saved ink coordinates. Recognized captures become small sources beside
their editable text, with full-size photo preview and audio playback.

The sidebar steps aside on paper. Page details holds properties; Earlier document
notes jumps to the original text. iPhone starts at Fit width and zooms when editing.
Selected notes have a thin boundary and width dot; unselected text has no chrome.
Pen/Text remain distinct tools. The native editor still opens from the page preview.
The visual prototype’s always-Pencil input and automatic editor entry are not part
of this revision. Device and browser evidence lives in `QA_READING_CAPTURE.md`.

## Notebook integration revision, 2026-11-11

Fable 5.2 Extra reviewed the creation, metadata, type and input transitions. The
Notebook type now has a fixed writing format. “New linked notebook” creates a
separate object with a Notes on relation; opening it never converts its source.
Existing mixed pages show both their document and paper, with no data migration.
The pane header holds capture; its old secondary toolbar is gone. Details opens a
sheet without resizing the paper. A source's reverse relation lists its notebooks.

The scenario contract is `features/notebook-integration.feature`. The design review
is `/tmp/leadinglight-notebook-integration-review.md`. Apple Pencil behavior follows
[Apple's double-tap guidance](https://developer.apple.com/documentation/ApplePencil/handling-double-taps-from-apple-pencil).
