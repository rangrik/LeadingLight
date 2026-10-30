---
title: Pasting Markdown
description: Paste Markdown into LeadingLight and it arrives formatted, with a heading on the first line naming a new page.
---

# Pasting Markdown

Markdown you paste into a page arrives formatted: headings, lists, to-dos, quotes, code, tables and links all become real blocks, and no `#`, `**` or `>` is left showing. A new page and one paste make a whole page.

## Make a page from Markdown

1. Make a new page. The cursor is in the title.
2. Paste the Markdown.

If the Markdown starts with a heading, such as `# Trip plan`, that heading becomes the page's title. Everything after it goes into the body, and the cursor ends at the end of the body. Press <kbd>⌘Z</kbd> to take the paste back out.

If the Markdown does not start with a heading, the title stays empty and everything goes into the body.

| You paste into the title | You get |
| --- | --- |
| `# Trip plan` and more lines | Title "Trip plan", the rest in the body |
| Lines with no heading first | An empty title, all of it in the body |
| `# Trip plan` alone | Title "Trip plan", an empty body |
| `Trip plan` alone | Title "Trip plan" |
| Plain lines, such as `line a` and `line b` | An empty title, one paragraph per line in the body |

If the page already has a body, the pasted lines go in before it, and what was there stays.

## Paste into the body

Click into the body and paste. A heading on the first line stays a Heading 1 in the body; the title is left alone.

- **Into the middle of a line**: inline formatting joins the line. Pasting `**big**` after "Hello " gives "Hello **big**world" as one line.
- **Headings, lists and quotes** always start on a line of their own. Pasted into the middle of a line, they split it: the words before stay above, the words after go below. The cursor ends after the last thing pasted.
- **Lines stay lines**: each line of text becomes its own paragraph, with its formatting.

## What is understood

| Markdown | Becomes |
| --- | --- |
| `# `, `## ` … | Headings |
| `**bold**`, `*italic*`, `_italic_` | Bold, italic |
| `~~gone~~` | Struck through |
| `==hi==` | Highlighted |
| `[link](https://example.com)` | A link |
| `- item` | A bullet list |
| `1. item` | A numbered list |
| `- [ ] task`, `- [x] task` | A to-do list, open and done |
| `> words` | A quote |
| A fenced code block | A code block, in its language |
| A table, its columns split by pipes | A table |
| `---` | A divider |

### Code fence languages

A code fence's language name sets the block's **Language**. Short and mixed-case names work: `tsx` and `TS` read as **TypeScript**, `yml` as **YAML**, `Python` as **Python**, and `text` as **Plain text**.

## What stays as written

- **Marks with spaces inside them.** `2 * 3 * 4 = 24` and `a == b == c` paste exactly as written; nothing turns italic or highlighted.
- **Inside a code block.** Pasting Markdown with the cursor in a code block keeps it as code, exactly as pasted, with no new blocks.
- **Code copied from a web page.** A snippet copied from a site, coloured or not, arrives as one code block, even if its lines start with `# `. It never turns into headings, and pasted into the title of a new page it goes into the body as code.
- **Formatted text.** When what you copied has its own formatting, such as a web page with a heading and a link, that formatting is used. Blocks copied from another LeadingLight page arrive as they were.

Markdown copied from a code editor, such as VS Code, is formatted from the Markdown.

## Markdown copied from a raw file

When you open a `.md` file as raw text in a browser and copy it, the browser hands it over as one block of preformatted text. LeadingLight treats it like this:

- On a new page, or a page holding only empty lines, it is formatted, with the first heading as the title.
- At the end of a page that already has words, it goes in as a code block marked **Markdown**, holding the file exactly.

A plain `.txt` file copied the same way gives one paragraph per line, not code.

## Turn a Markdown code block into formatted text

Any code block whose language is **Markdown**, pasted or typed with ` ```md `, has a **Turn into formatted text** button.

1. Point at the code block.
2. Click **Turn into formatted text**.

The code block is replaced by the formatted blocks, and the cursor sits at their end, ready to type. This works wherever the block is, even as the last block in a list item; if the Markdown ends in a divider or an image, what you type next goes on a new line after it.

Press <kbd>⌘Z</kbd> to get the code block back, with the cursor in it. The rest of the page is untouched.

::: info Limits
There is no way to paste Markdown as plain text outside a code block yet; to keep it raw, paste it into a code block. Headings or lists pasted at the end of a list item or a quote go inside it. A raw source file copied from a browser, such as a `.py` with `# ` comments, is read as Markdown, so its comments can become headings on an empty page.
:::

## Related

- [The block editor](/write/editor)
- [Block kinds](/write/blocks)
