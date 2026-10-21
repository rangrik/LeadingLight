# Commentary format 1

A commentary is an ordinary Markdown note about passages of another note, its **source**. It reads
well in any editor. LeadingLight adds two things to it: one fixed `Source` line that links to the
source, and a small record in the front matter that keeps the exact passages that were captured.
The source note itself is never changed to make or extend a commentary.

The source of truth is `src/leadinglight/commentary/commentaryContract.ts`. The modules beside it are
pure: they read and write strings, take vault-relative paths and digests from their caller, and never
touch the file system, native code or the network.

## A note

```markdown
---
_leadinglight_commentary:
  version: 1
  id: 6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f
  captures:
    - id: 0b7e4a1c-5d6f-4e7a-8b9c-1d2e3f4a5b6c
      projection: leadinglight-text-v1
      sourceBodySha256: 9f2c6c1e8d0b4a37f1c25e9d8a6b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d
      start: 120
      end: 149
      exact: "VGhlIFtbV2Vla2x5IFJldmlld11dIHBhc3NhZ2U="
      prefix: "Ym91bmRlZCBwcmVjZWRpbmcgdGV4dCA="
      suffix: "IGFuZCB3aGF0IGZvbGxvd3M="
---
# Commentary on Example

[Source](../Topics/example.md)

> The \[\[Weekly Review\]\] passage

My thoughts.

- Question: What next?
```

The body is the title, the Source line, then one **entry** per capture: LeadingLight's quote of the
passage followed by the recipe's own blocks. Adding a passage appends one entry at the end and one
capture to the record, in a single reviewed change. Nothing else in the note changes.

## The Source line

The only place a commentary names its source. It is the first block of the body after an optional
level-1 heading, and it is exactly one inline link labelled `Source`, with no title and no other text:
`[Source](destination)`. There is no second source path, source id or title anywhere else.

The destination is a path relative to the commentary's own folder (`./page.md`, `../Topics/page.md`),
or to the vault root when it starts with `/`. It is percent-decoded and resolved segment by segment;
it must stay inside the vault and name a `.md` note. LeadingLight writes it relative, percent-encoding
every ASCII character except `A-Z a-z 0-9 - . _` and every invisible or separator Unicode character, so
the app's own Markdown readers cannot mistake it for anything else. The spellings native relocation
writes when a note is renamed or moved are read the same way.

| The first block after the title is | The note's source is |
|---|---|
| `[Source](relative/path.md)` alone | that note, if the path stays in the vault |
| not a paragraph with a link | missing |
| two or more links | unreadable (`multiple`) |
| `http:`, `mailto:` and other schemes, `//host` | unreadable (`external`) |
| a path that climbs out of the vault | unreadable (`outsideVault`) |
| a path that is not a `.md` note | unreadable (`notNote`) |
| other text, another label, a title, a reference link, emphasis, `?query`, `#fragment`, backslash escapes or character references | unreadable (`malformed`) |

An unreadable or missing Source line never makes LeadingLight guess: the note stays readable, the source
card says the link can't be read, and nothing is added to it. Editing the line back into shape restores it.

## The record

A top-level key `_leadinglight_commentary` in the front matter, written exactly as `_leadinglight_commentary:`
at the start of a line, with its fields indented below it. Front matter keys starting with `_` are reserved,
so the record never appears among a note's properties. The record's own lines are read with the `yaml`
parser (failsafe schema, unique keys) on their own, so other front matter that is not valid YAML does
not stop a commentary from working.

| Field | Value |
|---|---|
| `version` | `1` |
| `id` | the commentary's id, a lowercase UUID v4 |
| `captures` | 1 to 256 captures, oldest first |
| capture `id` | a lowercase UUID v4, unique in the record |
| capture `projection` | `leadinglight-text-v1` |
| capture `sourceBodySha256` | SHA-256 (lowercase hex) of the source's body when it was captured |
| capture `start`, `end` | optional pair: where the passage was in that body's projected text (UTF-16 offsets). A hint, never an identity |
| capture `exact`, `prefix`, `suffix` | the passage and up to 64 code points of text on each side, as **base64** |

`exact`, `prefix` and `suffix` are standard base64 (RFC 4648, with `=` padding, no line breaks) of the
text's UTF-8 bytes, written in double quotes. Base64 has no bracket, pipe, hash, colon or space, so the
legacy wikilink rename (which rewrites `[[Title]]` anywhere in a file, front matter included), YAML
requoting, and line-based property edits cannot change a captured passage. Only canonical base64 of
valid UTF-8 is accepted.

States:

- **ready**: every rule above holds. Only a ready record with a readable Source line can be added to.
- **unsupported**: `version` is something other than `1`. The note stays an ordinary note.
- **malformed**: anything else: unknown or missing fields, aliases, anchors or tags, a second key that
  native front matter editing would treat as the same key (case, spaces), an invalid id, digest, offset
  or base64 value, a flow-style or quoted record key, or captures that disagree with their hints.

A note without the key is an ordinary note, even if it has a Source line.

## Writing

**New commentary.** Created in the source's folder by exclusive creation, never replacing a file:

```text
---
<record with one capture>
---
# <title>

[Source](<relative path to the source>)

<entry>
```

The title is the recipe's composed title, written as literal text. A separate note uses the same title
with ` 2`, ` 3`… (the first free name), in both the heading and the file name; the file name comes from
the title by the app's usual title-to-file-name rule.

**Adding to a commentary.** The baseline is the exact text reviewed for the guarded write. LeadingLight
replaces only the record's own lines (with the new capture added last) and appends one blank line, the
entry and a line break at the end of the body, using the note's own line ending (`\n` or `\r\n`). The
person's other front matter, the title, the Source line, earlier entries and anything typed later stay
byte for byte. The result is one whole page, submitted once with the baseline's digest; native writes it
only if the page still has exactly that baseline.

**The entry.** The quote is the passage line by line, each line as `> ` plus the line through the
literal-text encoder (`extensionMarkdownText.ts`), a blank line as `>`. The recipe's blocks follow,
encoded as for any extension. All text stays literal in the rich editor, past 16 KiB, after canonical
saves and in passive previews: HTML fences, `[[…]]`, images, `---`, `$`, `==`, callout markers and table
pipes are characters, not structure. As with every extension, bare `http(s)` text still shows as a link
whose target is its own text. Each line's leading and trailing spaces and tabs are dropped from the
visible quote; the record keeps the passage exactly.

Refused, with the person's input kept and nothing written:

| Reason | When |
|---|---|
| `invalidCapture` | the capture, its selector, the composed document or a path is not well formed |
| `unsafeText` | the encoder refused some text: the passage or an answer contains control characters, or the app's internal markers (`@@TOLARIA`, `‹WIKILINK:`, `‹LINKED_CODE:`), which no Markdown escape can keep literal |
| `tooLarge` | the page would pass 1 MiB |
| `missingTitle` | a new note's title is blank |
| `notCommentary`, `unsupportedRecord`, `malformedRecord` | the note to add to has no ready record |
| `sourceUnreadable`, `otherSource` | its Source line is unreadable, or names another note |
| `unsafeTail` | the note ends inside an unclosed code fence, HTML block or comment, which would swallow the entry |
| `duplicateCapture`, `tooManyCaptures` | the capture is already there, or the record is full |

## Projection `leadinglight-text-v1`

The visible text of a note's body (after its front matter), the same for the rich and the raw editor.
Selectors are measured in it. It is computed from the body with the CommonMark + GFM parser the raw
editor uses (no subscript, superscript or emoji shortcodes), and follows the rich editor where the app
adds its own constructs.

- Leaf blocks (paragraphs, headings, list items, quote paragraphs, code blocks, table cells) in
  document order, joined by one line break.
- Markers are not text: heading `#`, quote `>`, list and task markers, emphasis, strikethrough, code
  span backticks, link brackets and destinations. Links show their label, autolinks their URL.
- A soft line break is one line break; a hard break is two (the rich editor's `<br>` plus the line end).
  Each line's leading and trailing spaces and tabs are dropped, except in code.
- Escapes show the escaped character, except that a backslash before `{` stays (as in the rich editor).
  Numeric and common named character references are decoded; others stay as written.
- Code spans: their content, with one edge space stripped from each side as CommonMark does. Code
  blocks: their content lines.
- `[[target|label]]` shows `label`, `[[target]]` shows `target`; inline math stays `$latex$`.
- Highlights: an even number of `==` in a block's text are delimiters and disappear, with a colour
  prefix after each opening one; an odd number stays as written.
- A callout's marker line (`[!type] title`) is not text; its body is.
- One `￼` for each image, divider, Mermaid, tldraw or HTML fence and math block. Raw HTML blocks, HTML
  tags and comments, and link reference definitions contribute nothing.
- Each table cell is a leaf block, and rows take the header's number of cells.
- Like the rich editor's blank paragraphs, each blank line beyond the first between two blocks (outside
  fences), and a bare `>` between two quoted lines, adds one empty leaf block.

Known differences, which only cost an automatic anchor, never a wrong one: nested quotes followed by a
lazy line, footnotes, inline code that spans lines inside a quote, and blank-line runs inside indented code.

**Editors.** The raw editor passes the whole note and its CodeMirror selection to
`projectRawEditorSelection`. CodeMirror counts a `\r\n` as one position, so the positions are first
mapped to the note's exact text, then the front matter is removed. The selection is anchored unless one
of its ends cuts an escape, character reference, wikilink, object or `\r\n`, or it starts in the front
matter. The rich
editor reads its own text with ProseMirror's `textBetween(from, to, '\n', leafText)`, where `leafText`
returns the wikilink rule above for wikilink atoms, `$latex$` for inline math and `￼` for other leaf
nodes, and passes it to `anchorObservedPassage`. Neither stores editor positions or block ids. A
selection that cannot be anchored keeps its text and context as a historical snapshot without `start`
and `end`, and is never jumped to automatically.

**Resolving a passage later** (`resolvePassage`): `exact` when the body digest still matches and the hint
still holds the text (or its full context matches once); `possible` when the body changed and the text
occurs once with its captured context, or once with either side of it; `ambiguous` when that context
matches more than once; `changed` when the text is there but never in its context; `missing` when it is
gone; `invalid` for an unknown projection or a malformed selector. Repeated text is never told apart by
nearness, titles or other notes.

## Finding a source's commentaries

`discoverLinkedCommentaries` reads the notes the host names, one at a time through a reader the host
supplies, up to 2,000 notes and 32 MiB, and stops when the vault visit ends. A note counts only when its
own Source line, resolved from its own folder, names exactly the source. Notes with an unsupported or
malformed record are listed but cannot be added to. The result says whether every candidate was read;
a host that narrowed its list with a bounded search says so (`candidatesComplete: false`), and the
result is then never complete. An empty result proves nothing unless it is complete.

`planCommentaryDestination` proposes the dialog's destination: create when a complete search found
nothing, add to the one linked note when that is the only one and nothing else is linked, and otherwise
ask the person to choose, most recently edited first. A separate note is always a new note.

## Limits and what is not claimed

- A commentary holds at most 256 captures and 1 MiB; a passage at most 64 KiB.
- Renames and moves made in LeadingLight rewrite the Source line. A source moved, replaced or renamed
  outside the app shows as missing; a different file with identical text at the same path cannot be told
  apart from the original.
- Paths are compared exactly as written, so a Source line typed with different letter case or Unicode
  normalization does not count as linked, even where the file system would open the same file.
- The projection is a baseline for keeping passages and, later, finding them again; it does not decorate
  or change the source.
