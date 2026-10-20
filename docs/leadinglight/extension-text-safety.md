# Extension text safety

How LeadingLight keeps generated and literal text from turning into instructions, or into different
text. This describes a bounded trust boundary, not a general sanitizer: it covers text that the host
writes into an ordinary note, how the editor reads that note at any size, and how the canonical
Markdown serializer saves it again.

## Why this exists

Markdown in this app is not uniformly inert. `src/utils/htmlBlockMarkdown.ts` recognises an `html`
fence carrying `scripts=sandboxed`, and `HtmlBlock.tsx` runs that preview. Several other constructs
are decoded *after* parsing, from block text whose escapes the parser has already removed: durable
block placeholders, wikilinks, inline math, callout markers and `==` highlights.

So a literal passage a user selected, or text an extension recipe supplies, must stay literal under
the grammar the real renderer uses, through every later save. Removing `<script>` tags would not be
enough, and neither would escaping alone.

## The literal-text encoder

`src/leadinglight/extensions/extensionMarkdownText.ts` is a pure, string-only module. Callers pass
untrusted text and add only trusted block punctuation:

| Context | Builder |
|---|---|
| Paragraph | `encodeLiteralMarkdownLines(text).join('\n')`, blank line before and after |
| Quote | each line as `> line`, blank line as `>` |
| List item | marker on the first line, remaining lines indented by the marker width |
| Heading, or after a trusted prefix | `## ` + `encodeLiteralMarkdownInline(text)` |
| Link label | `[` + inline(label) + `](` + destination + `)`, destination from a validated handle only |

It refuses rather than mangles: oversized text, control characters, unpaired surrogates, a line break
in single-line text, and the reserved placeholders that no Markdown escape can neutralise
(`@@TOLARIA…`, `‹WIKILINK:` and `‹LINKED_CODE:`). Each failure carries a reason and an offset.

Not covered, and needing their own typed renderer or a refusal: link destinations and titles, code,
tables, frontmatter values, wikilink targets, file names, HTML attributes, and appending to a note
that ends inside an unclosed fence or container.

## Escaped-literal provenance

The callout and highlight injectors act on parsed text, where `\[!note]` and `[!note]`, or `\=\=` and
`==`, look identical. `src/utils/markdownLiteralProtection.ts` keeps that distinction:

1. As the **last** preprocessing step, `preProcessRichEditorMarkdown` rewrites exactly three escapes
   to a host sentinel: `\[` immediately before `!` (a callout marker), `\=` inside a run of two or
   more `=` (a highlight delimiter), and a backslash before `{` (kept literal for formulas and paths).
   Running last means math, wikilinks and the other raw-source readers see the source exactly as
   written, so protection cannot change whether something is math or what a wikilink targets. Other
   escapes are left to the parser.

   Fenced code, real code spans and earlier preprocessors' `‹KIND:…›` placeholders are never
   touched. Code spans are found by CommonMark's rule, where a backslash-escaped backtick is literal
   and cannot open one. They are also found across the lines of a paragraph, so prose after a span
   that began on an earlier line is still protected. Lines that start a block of their own (a
   heading, break, list item, new quote, possible table row or indented code) are kept separate.
2. Both parsers carry the sentinel through as plain text, so the injectors cannot match it.
3. `injectRichEditorMarkdownBlocks` restores the literal characters as its very last step.

The sentinel embeds a random per-session nonce. Text from a note cannot contain it, whether raw,
decoded from a character reference, in code, in a wikilink target or in a durable block's properties,
so restoration only rewrites sentinels the host introduced and leaves all other text byte-for-byte
unchanged. Restored code points are bounds-checked, so no input can make restoration throw.

A sentinel can reach parsed blocks in two representations, and both are restored before
serialization, so the nonce is never written to a note:

- raw, in text;
- percent-encoded, where the Markdown URI normalizer wrote it into a link target (for example a
  bare `https://example.com/?q==value`, whose escaped `==` was protected). It is restored to the
  character exactly as that normalizer writes it (`=` stays `=`; `\` becomes `%5C`), so the target
  still matches the visible URL. No other percent-encoded text is decoded.

Protection still cannot recognise every code region before parsing (an indented code block, for
example). Where a sentinel lands inside parsed code, which keeps backslashes literally, the original
escape (`\=`, `\[`) is restored rather than the bare character.

Escape parity holds: `\\` is a literal backslash and stays one, so syntax after it is still authored.
Intentionally authored callouts, highlights, code and links keep working as before.

## The canonical literal serializer

When a block is saved without a source baseline (copied into another note, split, or saved
canonically), `src/utils/blockNoteDirectMarkdown.ts` and `src/utils/blockNoteMarkdownInline.ts`
re-serialize its text nodes, and the next parse reads exactly those bytes. They emit the same
convention as the encoder:

- `` ` `` and `~` (fences, code and strike spans), `*`, and `[` and `]`
- `$`, when the block holds two or more. Math needs a pair on one line and a block's text is the only
  text on its lines, so a lone `$` (as in `{Server}$\{Instance}`) is written as is. A structural
  math item counts as a pair, and table rows, which put several cells on one line, always escape.
- `<` where it could open a tag, comment, declaration or autolink, so `a < b` stays readable
- `&` where it could start a character reference. A hexadecimal reference's `&` is written as
  `&#38;`, because `compactMarkdown` decodes `&#x..;` even when escaped. Inside a bare URL or email
  that GFM autolinks, `&` stays raw so the link target is truthful.
- every `=` in a run of two or more, counted in code points so emoji cannot shift the positions
- a heading's trailing hash run, so `Rank #` is not read as a closing sequence
- line-start thematic breaks, setext underlines, list markers and table pipes, in paragraph, list and
  quote text (not table cells, whose pipes have their own escaping)

Authored HTML and code blocks are untouched; they are serialized by their own typed renderers. The
math and highlight serializers turn their structure back into plain text items before this
serializer runs (`$latex$`, and a bare `==` or `==<colour>` delimiter); those are written unchanged,
so authored math and highlights survive a canonical save.

## Large notes

Notes over 16 KiB are first offered to a faster parser in `src/hooks/editorFastMarkdownBlocks.ts`. It
must show the same text as the ordinary parser, so it declines, and the ordinary parser runs, where
it would otherwise change text:

- an unescaped character reference anywhere in the note (`character-reference`). It deliberately
  decodes no references itself, because a decoder there could reassemble a durable block token.
  Escaped references stay on the fast path, which keeps their spelling.
- two unescaped underscores in one block where one sits between letters or digits
  (`intraword-underscore`). The inline parser would pair them into emphasis; CommonMark never does.
  Code spans, fenced code, durable tokens and placeholders are excluded.

- a code span opened by two or more unescaped backticks (`multi-backtick-code`). The inline parser
  closes a span at the next single backtick, while CommonMark needs a run of the same length; the
  canonical serializer writes double backticks for code that contains a backtick.

It also follows CommonMark where it used to differ. A backslash escapes only ASCII punctuation, so
`C:\Users` keeps its backslashes. Consecutive quote lines form one quote, as in BlockNote; one
quote per line would make a later save write a blank line between them and split the quote.

Its heading rule only treats a hash run as a closing sequence when whitespace separates it from the
content and it is not escaped, so `## C#` keeps its hash. The title-only shortcut in
`src/hooks/editorBlockResolution.ts` copies a lone `# Title` line without parsing, so it now defers
to real parsing whenever that line holds escapes, inline syntax or a protected literal.

## What is accepted, and what is still true

Accepted, because it activates nothing and fetches nothing, and the visible text and target stay
truthful: bare `http(s)`, `www.` and email text still becomes a link through the existing safe link
path, where a click opens the system browser and only `http`/`https` are allowed. Explicit Markdown
links and images, and unsafe schemes such as `javascript:` and `data:`, stay inert text.

Still true, and stated precisely:

- Each line's leading and trailing spaces and tabs are dropped, and Unicode line breaks are
  normalised to `\n`. Other Unicode, including bidi controls, combining marks and private-use
  characters, is preserved.
- A byte-order mark at the very start of a document is dropped by every Markdown parser.
- Passive previews (templates, page history) use plain CommonMark, where `\{` is an ordinary escape,
  so a backslash before `{` is not shown there.
- An authored callout's title is stored in block properties and rendered as the callout header; it is
  not part of the body text.
- In notes over 16 KiB, a line ending inside a code span shows as a line break rather than
  CommonMark's space. Every character is kept, but small and large notes show that whitespace
  differently. This is an inherited fast-parser limitation; generated text never writes code spans.
- A wikilink target is raw source, but its `\=` or `\[` escapes have always been removed: the
  wikilink placeholder carries them unencoded and the Markdown parser unescapes them. That behavior
  predates and is unchanged by literal protection.

Verification lives in `src/leadinglight/extensions/extensionMarkdownText.test.ts`,
`src/utils/markdownLiteralProtection.test.ts` and
`src/utils/blockNoteDirectMarkdown.literalText.test.ts`, which exercise the real pipeline at both note
sizes, the passive previews, repeated canonical saves and the post-parse injectors.
`src/utils/markdownLiteralProtection.schema.test.ts` repeats the key cases against the app's custom
editor schema, at both sizes and after repeated canonical saves, and
`src/hooks/editorBlockResolution.preprocess.test.ts` checks that the source-preserving save path
keeps untouched bytes exactly.
