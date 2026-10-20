# Title literal text

A page title taken from its first-line H1 must show the same characters wherever it appears: the live tab and breadcrumb while editing, the native vault list after a reload, and the browser disk bridge. Extension-generated headings write untrusted text as Markdown escapes and character references, so `[draft]`, `a*b`, `R&D`, `x_y`, a literal `[text](https://example.com)` or `[[page]]` must survive all three readers unchanged.

## One behavior, three readers

- `src/utils/noteTitleInline.ts` turns the H1's inline Markdown into display text. `noteTitle.ts` (live title) and `scripts/vault-api-data.ts` (browser bridge) import the same module, so those two cannot drift. It has no imports, so Node's type stripping can load it from `scripts/`.
- `src-tauri/src/vault/parsing/title_text.rs` mirrors it natively, with its own tests in `parsing/title_text_tests.rs`. It is a private leaf module of `parsing.rs` that depends only on `std`, and it exposes one `pub(super)` function. In upstream `parsing.rs`, only `extract_h1_title` calls it (one `mod`, one `use`, one call). The snippet stripper `strip_markdown_chars` and the inline-Markdown contract (ADR-0181) are unchanged.
- `src/shared/titleSourceContract.json` is the shared corpus. TypeScript, the native `parse_md_file` path and the bridge's `parseMarkdownFile` each assert every fixture. A behavior change starts with a fixture there.

Title precedence (first non-empty H1 after frontmatter, then frontmatter `title`, then filename), filenames, snippets, word counts, autosave and serialization are unchanged. An H1 that decodes to only whitespace, such as `# &nbsp;`, is treated like an empty H1 marker and falls through to the next title source.

## Rules

The input is the text after `# `. It is processed in two passes, linear in its length.

1. Literal text. Each source character becomes a unit marked `source`, `escaped` or `literal`.
   - A backslash before ASCII punctuation produces that character as `escaped`. Any other backslash stays as a literal backslash.
   - A character reference is decoded once: decimal `&#38;` (1–7 digits), hex `&#x26;` (1–6 digits) and the 48 named references in the shared table (`&amp;`, `&lt;`, `&copy;`, `&mdash;`, `&nbsp;` and similar). The result is `literal` and is never read again, so `&amp;amp;` shows `&amp;`. Invalid code points become U+FFFD, following micromark. Decoded tab, line feed, form feed and carriage return show as a space. An escaped ampersand, an unknown name, a missing semicolon or too many digits leaves the text as written.
   - A backtick run opens a code span when a later run has the same length. Its content is `literal` and kept verbatim (no escapes or references), with one padding space removed from each side. An unmatched run stays as backticks.
   - The extension encoder leaves `_` and `&` unescaped inside bare `http://`, `https://`, `www.` and email words, since a backslash would land in the rich editor's link text and target. The title reader finds those words in the same way (word boundary, ASCII case-insensitive prefix, email local part `[A-Za-z0-9._+-]`, trailing `!"&')*,.:;?]_}~` excluded) and marks their `_` and `&` as `literal`. `https://example.com/_draft_/index` and `_owner@example.com` therefore show unchanged. Backslash escapes inside those words are still decoded.
2. Formatting. Only `source` units act as syntax:
   - `[[target]]` shows the target and `[[target|alias]]` the alias. As with the editor's raw `[[...]]` match, the text may not contain a `]` written in the source, escaped or not. A raw `|` or a table-escaped `\|` separates the alias. A `|` or `]` from a character reference or code span is ordinary text: `[[Page&#124;Alias]]` shows `Page|Alias`.
   - `[label](destination)` shows the label. `~~text~~` shows the text when neither inner edge is whitespace.
   - `*` is removed. A run of `_` is removed unless a letter or number is on both sides.
   - Decoded or escaped brackets, pipes, asterisks and backticks never open, close or split any of these.

## Limits

This is a bounded subset of CommonMark and GFM, not a general Markdown renderer.

- Emphasis uses the long-standing removal heuristic, not CommonMark delimiter runs. A lone raw `*` is removed, even though the editor would show it.
- Inline HTML, `<https://...>` autolinks and images get no special handling. `<` stays and `![alt](src)` shows `!alt`. Their `*` and `_` are still removed.
- A raw closing `#` sequence (`# Title ##`) is kept, although the editor hides it. Generated headings escape a trailing `#`.
- Named references outside the table stay literal. Add a name to both runtime tables and the shared fixture together.
- A wikilink may contain a code span or a decoded `]`. The editor does not form a wikilink across inline code, so `[[Page`|`Alias]]` shows as `Page|Alias` here but as bracketed text there.
- Inside a URL or email word an `&` is never decoded, so `https://example.com/?a=1&amp;b=2` keeps `&amp;`. `mdast-util-gfm-autolink-literal` builds the editor's link text from the raw source slice, so the editor is expected to agree (read from source, not run). The encoder writes a backslash before `{` as `&#92;`, so inside a URL word that pair shows as `&#92;{` in both. This is an encoder-side ambiguity: a literal `&#92;{` encodes to the same text.
- Escaped characters inside a URL word (for example `\*`) show without the backslash here. Since the editor's link text is the raw slice, it likely shows the backslash.
- Whitespace follows each runtime: U+FEFF counts as whitespace in TypeScript but not in Rust, and U+0085 the reverse.
- The native Type-template detection (`type_templates.rs`) and the bridge's `bodyAfterTypeTitle` compare the raw heading with the display title, so a Type page whose H1 uses escapes or references does not expose its body template. This predates the change for escaped `*`, `_` and backticks.
