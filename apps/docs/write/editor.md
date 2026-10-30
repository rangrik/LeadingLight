---
title: The block editor
description: How to write in LeadingLight's block editor, from typing and shortcuts to links, highlights, to-dos and saving.
---

# The block editor

The body of every page is a block editor. Each paragraph, heading, list item, image or table is a block of its own, so you can write freely and still move, change or select whole pieces of a page.

## Type

Click into the body and start typing. Press <kbd>Return</kbd> to start a new paragraph.

The line you are on shows a hint when it is empty: **Type '/' for commands**. An empty heading shows its level, such as **Heading 2**, and an empty toggle shows **Toggle**. The hint only appears on the empty line that holds the cursor, never on other empty lines.

A new line starts plain. If you were typing in bold or italic and press <kbd>Return</kbd>, the next line does not carry the formatting on. This holds in lists, in to-dos and after <kbd>⇧Return</kbd>.

## Use Markdown shortcuts

Type one of these at the start of an empty block, then a space, and the block changes kind.

| Type | To get |
| --- | --- |
| `#` | Heading 1 |
| `##` | Heading 2 |
| `###` | Heading 3 |
| `####` | Heading 4 |
| `-` | Bullet list |
| `1.` | Numbered list |
| `a.` | Alphabetical list |
| `i.` | Roman list |
| `[]` | To-do |
| `>` | Quote |

Two more work without the space:

- Type ` ``` ` and press <kbd>Return</kbd> to start a code block.
- Type `---` to add a divider. The cursor moves to an empty line below it.

Inline Markdown works as you type, too: `**bold**`, `*italic*` or `_italic_`, `~~struck~~` and `==highlighted==` lose their marks and take the formatting. Marks with a space just inside them stay as written, so `2 * 3 * 4 = 24` never turns italic.

For every block kind and how each one works, see [Block kinds](/write/blocks).

## Insert a block with the slash menu

1. Type <kbd>/</kbd> anywhere. The **Insert block** menu opens with **Text** highlighted.
2. Keep typing to filter it. `/head` shows only the headings, and the filter keeps working across a space, so `/heading 2` shows only **Heading 2**.
3. Use <kbd>↑</kbd> and <kbd>↓</kbd> to move, and <kbd>Return</kbd> to choose. The `/head` you typed is removed and the block takes the new kind.

Names count before keywords: `/columns` gives **Columns**, not **Table**, and `/todo` finds **To-do list**. If nothing matches, the menu says **No results**. If you keep typing words that match nothing, the menu closes.

Press <kbd>Esc</kbd> to close the menu. What you typed stays in the page as plain text, and <kbd>⌫</kbd> removes only those characters.

The last section of the menu, **New**, makes a new page of any type, such as a task or a person, and links it where you are. See [Links and backlinks](/organize/links).

## Format text

Select some words and the **Text formatting** toolbar appears beside them. Click a button to apply it; an active format shows as pressed. The toolbar hides when nothing is selected.

<img class="shot" src="/screenshots/selection-toolbar.webp" alt="The formatting toolbar above selected words" />

| Button | Key |
| --- | --- |
| **Bold** | <kbd>⌘B</kbd> |
| **Italic** | <kbd>⌘I</kbd> |
| **Underline** | <kbd>⌘U</kbd> |
| **Strikethrough** | <kbd>⇧⌘S</kbd> |
| **Code** | <kbd>⌘E</kbd> |
| **Highlight** | <kbd>⇧⌘H</kbd> |
| **Link** | |

The toolbar also holds **Turn into** (make a new page, such as an idea or a task, from the selected words; see [Tasks and new objects](/organize/tasks#turn-selected-words-into-a-page)), **Add sidenote** (see [Sidenotes, thoughts and essays](/write/sidenotes)) and **Ask about this** (see [Ask Claude](/ai/ask)).

These keys only format text. They never open or close the sidebar or anything else in the app.

## Add and remove links

1. Select the words and click **Link** in the toolbar.
2. Type the address into the **Link URL** field and press <kbd>Return</kbd>.

While you type the address, the words stay selected. If the address is not a valid link, such as `hello world`, the field is marked invalid and the old link stays as it was. Press <kbd>Esc</kbd> to close the field; the words stay selected, and typing goes back into the page.

To remove a link, select its words, click **Link**, then **Remove link**.

A web address you type becomes a link by itself.

### Open a link

Clicking a link puts the cursor in its text, so you can edit it. To open it, hold <kbd>⌘</kbd> and click. The address opens outside the app, in your browser.

Links to other pages in LeadingLight work differently. See [Links and backlinks](/organize/links).

## Highlight words

1. Select the words and click **Highlight** in the toolbar.
2. Choose a colour: **Yellow highlight**, **Orange highlight**, **Green highlight**, **Blue highlight**, **Purple highlight**, **Pink highlight** or **Gray highlight**.

The menu closes and only the selected words take the colour. To change it, select the words again and choose another. The colours stay readable in light and dark mode, and they are kept when you reopen the page.

To remove a highlight, choose **Remove highlight** in the same menu. The words keep their other formatting.

For a quick yellow highlight, select the words and press <kbd>⇧⌘H</kbd>. Press it again to remove it. You can also type `==remember this==` to highlight the words between the marks.

In a page with the Playful style, highlights look like a marker stroke. See [Pages](/organize/pages).

## Undo and redo

Press <kbd>⌘Z</kbd> to undo and <kbd>⇧⌘Z</kbd> to redo.

## Check off to-dos

Type `[]` and a space to start a to-do, then click its box to check it. The check is saved with the page.

In a Plain page, a checked to-do shows a filled box with a check, and its words are muted and struck through with a straight line.

### The Playful check

Each page can use the Playful style instead, chosen under **Page options**. In a Playful page:

- Checking a to-do draws a hand-drawn check over the box, then a wobbly line through its words, left to right, like a pen. A soft tap plays. The box stays unfilled and the cursor stays where it was.
- Unchecking fades the marks out instead of drawing them backwards.
- Each new check is drawn with a new wobble.
- A to-do that wraps onto two lines gets one line per row, the second drawn after the first. The lines follow the words as you type or resize the window.
- A to-do nested under a checked one is not struck or muted unless it is checked too. A checked to-do with no text shows only the check.
- When you reopen a page, checked to-dos are already marked, with nothing moving.
- If your Mac is set to reduce motion, the marks fade in instead of being drawn.

## Click blank space

Clicking empty parts of the page puts the cursor somewhere useful, without adding clutter.

- **Below the last block**, when you are not already writing in the body: a new empty line opens there with the cursor in it. Clicking below again does not add a second one; the cursor goes into the empty line. One <kbd>⌫</kbd> removes it.
- **Below the last block while you are writing in the body**: the click only takes the cursor away. Nothing is added.
- **On an empty page**: clicking anywhere below puts the cursor in the first line.
- **In the side margin beside a block**: the cursor goes into the line at that height. Beside a table or columns, the left margin goes to the first cell and the right margin to the end of the last cell.
- **Beside or above the title**: the cursor goes to the end of the title.
- **In the gap just above the body**, under the properties: the cursor goes to the start of the first block.
- **Beside a property, the backlinks or Created this day**: nothing happens.

If the link field is open, clicking blank space closes it and keeps the words selected.

## Use the block handle

Point at any block and two buttons appear to its left:

- **Add block** adds a new line below and opens the slash menu, with `/` already typed. In a list, it adds a new item of the same kind.
- **Drag to move** selects the block and opens the block menu when you click it, and moves the block when you drag it. See [Selecting and moving blocks](/write/selecting-blocks).

Every list item has a handle of its own, even inside a group, a toggle or a quote. Inside columns, the columns block as a whole has the handle.

## Drag blocks and files

Drag a block by **Drag to move**. A horizontal line shows where it will land: above a block if you are over its top half, below it if you are over its bottom half, wherever you are across its width. No line shows where a drop would change nothing.

When you drag a list item out between two blocks, it becomes its own one-item list there, and keeps the items nested under it. An item dropped onto a list of another kind lands beside that list, keeping its own kind.

You can drag an image or other file in from outside, such as from Finder in the Mac app. The same line shows, and the file is inserted where it points. See [Block kinds](/write/blocks).

## Paste

Plain text with several lines becomes one paragraph per line.

Cells copied from a spreadsheet, such as Numbers or Excel, paste as text, not as a picture of the cells. A clipboard holding only an image adds an image block.

Pasting a YouTube link into an empty line embeds the player.

Markdown is formatted as it is pasted. See [Pasting Markdown](/write/markdown).

## See the table of contents

A page with two or more headings shows **On this page** to the left of its text. It lists the headings, with smaller headings one step in.

- A dotted trail runs through the headings, and a small plane sits at the one in view. As you scroll, the plane flies along the trail to the next heading, which turns bold.
- Click a heading in the list to scroll it to the top of the page.
- The list follows your edits: rename, add or delete a heading and it changes. With fewer than two headings, it goes away.

When there is not enough room beside the text, for example in a narrow window or with an essay open beside the page, the list shrinks to a slim rail. Rest the pointer on it, or press <kbd>Tab</kbd> from the title to reach it, and the full list opens over the page. After you click an entry, it closes back to the rail.

## Saving

There is no Save button to remember. Every change is saved on its own a moment after you type.

- Press <kbd>⌘S</kbd> to save straight away. It saves and does nothing else.
- If you switch away, close the window or reload right after typing, the last edit is still kept.
- In the Mac app, pressing <kbd>⌘Q</kbd> right after typing saves first, then quits. <Badge type="info" text="Mac app" />
- If a save fails, a message says your changes couldn't be saved. The words stay on the page.

## Everyday behaviours

- **Tab stays in the editor.** <kbd>Tab</kbd> in a plain paragraph does nothing and keeps the cursor where it is. In a code block it indents; in lists, tables and columns it moves or indents as described in [Block kinds](/write/blocks).
- **Backspace at the start of a heading** turns it back into text. Press it again to join it to the line above.
- **Backspace at the start of a quote** lifts the line out of the quote.
- **Pages from earlier versions** of LeadingLight open with their content.
- **A page with blocks this version can't show** opens read-only, with a message saying so. The blocks this version knows are shown, nothing on the page changes what is stored, and you can still rename the page.

## Related

- [Block kinds](/write/blocks)
- [Selecting and moving blocks](/write/selecting-blocks)
- [Pasting Markdown](/write/markdown)
- [Writing tools](/write/writing-tools)
- [Keyboard shortcuts](/customize/shortcuts)
