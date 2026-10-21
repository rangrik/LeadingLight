# Website capture: page to note

How LeadingLight turns a web page the person asked for into an ordinary Markdown note. The page has
already been fetched by the native leaf (`src-tauri/src/leadinglight_web_capture/`, contract in the
native module's `wire.rs`); this covers only the conversion. The code is in
`src/leadinglight/webCapture/`. The entry points are in `webCapturePipeline.ts`, and the frozen
shapes and limits are in `webCaptureContract.ts`. No dialog, command or extension step uses it yet.

The page is untrusted data from start to finish. The note it produces is either:

- **exact**: it opens in the editor as exactly the converted article and saves back to the same
  bytes;
- **refused**: a fixed reason, with the address kept so a link-only note can still be saved.

Nothing is fabricated, cut short or fetched.

## Pipeline

1. **Prechecks**, before any parsing:
   - the decoded text must be at most 5 MiB of UTF-8;
   - at most 150,000 start tags (a cheap scan).
2. **Inert parse.** `DOMParser` builds a document with no browsing context, so no script runs and no
   resource loads.
   - Every original `<base>` is removed, and the captured final URL becomes the only base. Links
     resolve against the page that was fetched, never against the app or a planted base.
   - The document must have at most 50,000 elements and at most 400 levels of nesting.
3. **Extraction** with Mozilla Readability 0.6.0 (Apache-2.0, pinned exactly). It finds:
   - the article;
   - the title, byline, site name and language;
   - an ISO-8601 published date, kept as `YYYY-MM-DD` only.

   Two Readability behaviours are corrected around it:
   - it turns every H1 into an H2, so top-level headings are marked before it runs and restored
     after;
   - it strips classes, so code-language hints are marked on each `<pre>` and preserved.
4. **Sanitizing** with the app's DOMPurify, in a private instance:
   - a tag allowlist;
   - no `data-*`, `aria-*`, `style` or event attributes;
   - `class` only for a code-language hint on `<pre>`;
   - `src` and `href` only for absolute http(s) addresses (DOMPurify's default `data:` allowance
     for media is removed);
   - form controls are removed together with their text.
5. **Block model.** The sanitized article is walked into the structure a note can hold:
   - Containers become paragraphs, with HTML whitespace collapsed as a browser shows it.
   - Quotes become quoted lines. A list inside a quote keeps visible `•` or `1.` markers. Code and
     tables inside a quote follow it as their own blocks.
   - Lists nest up to 8 levels; deeper items stay as paragraphs inside the deepest kept item.
   - Simple rectangular tables stay tables. Tables with spans or ragged rows become one paragraph
     per row (`a | b`). Layout tables, whose cells hold blocks, are read cell by cell.
   - Images, video and audio become text links such as `Image: The lamp room` to their http(s)
     address. They are never images: nothing is downloaded or shown.
   - Links are absolute http(s) only. Links to `javascript:`, `data:` or `mailto:` addresses, or
     to a fragment of the captured page itself, become plain text.

   The model is written out as minimal HTML, with every text escaped there.
6. **The editor's own HTML parser** reads that HTML: a headless default-schema BlockNote editor,
   the same parser paste uses.
   - Where the app's editor schema is loaded (always, in the running app), this default editor
     also carries the app's blocks. BlockNote 0.46.2's `CustomBlockNoteSchema.extend` copies new
     specs into the shared default spec map, and the app's schema is built with `.extend`.
   - Two of those blocks parse from `<pre><code>` by language: `html` becomes a live HTML block and
     `mermaid` a diagram. So each code label is settled (next section) before the HTML is written,
     and the parser never sees the page's own hint.
   - Any block type outside the allowed set still refuses the page.
7. **Normalizing** to the note's grammar:
   - Blocks: paragraph, heading, bullet and numbered items, quote, code, table and divider.
   - Marks: bold, italic, strike and code.
   - The title is the only H1: when the article has its own H1, every heading moves down one level.
   - Every text, code and link passes the existing literal-text refusal check. An internal editor
     marker (`@@TOLARIA…`, `‹WIKILINK:`, `‹LINKED_CODE:`, the literal-protection sentinel) refuses
     the page.
8. **Frontmatter, title, optional host paragraphs and the article** are then settled through the
   reopen check (below).

The pipeline runs on the main thread, because `DOMParser` is not available in workers. Between
stages it yields to the event loop and refuses with:

- `cancelled` when the caller's `AbortSignal` has aborted;
- `tooComplex` past a 15-second budget.

Each stage is bounded by the limits checked before it.

## Code is never live

Markdown in this app is not inert (see [extension-text-safety.md](extension-text-safety.md)). A
code block's label decides whether it reopens as code or as something the editor runs or draws.
Each label is settled to the label the editor itself would end on, and that fixed point is what
gets written:

- **HTML, HTM and XHTML code is labelled `xml`.** It is never `html`: an `html` fence reopens as a
  live HTML block. Unlabelled code that the editor would infer as `html` is also labelled `xml`.
  This matters because, measured in this lane, unlabelled HTML code is inferred as `html` when the
  note opens, written as an `html` fence on the next canonical save, and becomes an HTML block on
  the following open.
- **Unlabelled code is labelled the way the editor would infer it.** Aliases are canonicalised
  (`sh` becomes `bash`).
- **Code a bare fence would turn into a diagram is labelled `txt`.** This covers text beginning
  `graph`, `pie`, `timeline` and similar. Mermaid and tldraw labels are dropped.
- **A code line that starts like a fence (`` ``` ``, `~~~`) becomes its own paragraph in code
  style, between fenced parts.** Such a line would otherwise end the note's fence early, or flip
  the math preprocessor's fence tracking, so that later `$$` lines turned into math inside code.

## The reopen check

The conversion does not assume its output is exact. The note's bytes are first written with the
editor's canonical serializer (`serializeRichEditorBlocksToMarkdown`, the editor's own save). Then:

1. They are opened through `resolveBlocksForTarget`, the code that opens any note, with every
   post-parse injector. Each block's text, marks, links, levels, nesting and code labels are
   compared with what was meant.
2. They are also read by the parser the note does not use at its current size:
   - a small note is grown past 16 KiB, so the fast parser reads it;
   - a large note goes through the BlockNote-parser path, composed from the same exported steps.
3. A block that reopens differently loses its marks; if it still differs, it also loses its links.
   Its text never changes. Anything still different refuses the page as `notExact`.
4. The canonical save of the reopened note must reproduce the bytes. A bare address becomes an
   explicit link on the first save, so the check accepts the next fixed point only when it reopens
   the same and reproduces itself.

Some cross-element hazards are lowered before the check:

- an unstyled `==` run;
- a backslash before another run's marker;
- a link right after `!`, which would reopen as an image.

The verification path is a fixed scheme (`leadinglight-web-capture://verify.md`). It is cleared
after each use, but while present it can evict one entry of the editor's six-entry parsed-note
cache. The reopen editor can be swapped with `createVerifyEditor`, for example for an editor built
with the app's own schema.

## The saved note

```markdown
---
source: "https://example.org/2026/10/article"
author: Ada Example
site: Example Site
published: 2026-10-01
captured: "2026-10-20T14:03:11Z"
_leadinglight_capture:
  version: 1
  kind: article
  requested: "https://example.org/a"
  extractor: readability-0.6.0
  converter: leadinglight-article-v1
---
# Article title

…
```

- **`source`** is the final URL, and the only URL any code reads back. `requested` is recorded
  only when a redirect changed the address. Any "Saved from" line the host adds is display text,
  never read back.
- **`captured`** is the caller's fetch time, in UTC.
- **`author` and `site`** are kept only when short, single-line and literal-safe.
- **The provenance record** is one hidden `_` key, which both frontmatter readers treat as system
  metadata.
- **Quoting** follows the app's own property writer, so re-saving an unchanged value from the
  properties panel keeps the line.
- **Every value is read back** with the properties panel's reader and a YAML parser. An optional
  value either would see differently is left out rather than written wrong. For example, the panel
  reads `Yes` as true, and a value holding both quote kinds and `#` cannot be written exactly.
- **The title** is the H1 and `title` is not written. Without a page title, an article's leading
  heading becomes the title; without either, the host name does. A blank title the person types
  also means the host name.
- **Size.** The note is at most 768 KiB. A longer article is refused as `tooLarge`, never cut.

## Refusals

| Reason | When |
|---|---|
| `invalidInput` | A URL is not absolute http(s), has credentials, or the time is not RFC 3339 UTC. |
| `tooLarge` | The page is over 5 MiB, or the article or note is over 768 KiB. |
| `tooComplex` | Over the element, nesting, start-tag or block limits, or past the time budget. |
| `unreadable` | No article, under 140 visible characters, or a page with a password field and under 1,500. This covers script-only shells and sign-in walls. |
| `unsafeText` | An internal editor marker, or other text the literal check refuses. |
| `notExact` | The note would not reopen as exactly the converted article. |
| `cancelled` | The caller aborted. |

A refusal carries the retained address facts, and the page title when one was read safely, for a
link-only note (`buildLinkOnlyNote`). Its body is only the host paragraphs the caller supplies.

## Measured

Synthetic pages, measured in jsdom only; timings in a webview are not measured:

| Page | Size | Result | Total |
|---|---|---|---|
| Article page | 4.98 MB, 361 KB note | converted | 2.6–3.6 s |
| At the element limit (about 48,700 elements) | 1.6 MB | converted | 1.5–1.7 s |
| Article over the note limit | 1.9 MB | `tooLarge` | 1.5–2.2 s |

Across the runs, the longest single uninterruptible stage was about 0.8 s.

## What is and is not qualified

- **Tests** (`src/leadinglight/webCapture/*.test.ts`, synthetic fixtures only) cover:
  - extraction, structure, links and media;
  - literal text below and above 16 KiB;
  - byte-identical canonical saves and determinism;
  - each refusal, cancellation and the budget;
  - frontmatter through both readers, and property edits through the app's browser-mode writer;
  - inertness.
- **Inertness in jsdom** proves only that the conversion code makes no request and writes nothing
  into the app's document; jsdom never loads subresources itself.
- **A separate headless Chrome 155 check** saw no request from a `DOMParser` document with
  resource-bearing HTML, before and after the base rewrite. It did not run the full converter, and
  says nothing about WKWebView, WebView2 or WebKitGTK.
- **App schema.** `webCapturePipeline.schema.test.ts` (5 tests) repeats the reopen checks with the
  app's own schema loaded. This includes code the page labels `html`, `mermaid` or `tldraw`. It
  needs the integrated checkout, where the schema's IronCalc asset resolves.
- **Not measured:** real sites' extraction quality, and the native fetch. The latter is qualified
  by the native leaf's own tests.
- **Accepted limits:**
  - ordered lists restart at 1, because the canonical serializer writes a start number only for a
    note's first block;
  - a block whose marks the note's Markdown cannot reproduce keeps its text but loses its marks;
  - quotes are written one paragraph per quote;
  - blank lines at a code split are dropped.
