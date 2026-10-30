---
title: Block kinds
description: Every kind of block in LeadingLight, how to insert each one, and how it works.
---

# Block kinds

A page is made of blocks: text, headings, lists, code, tables, media and more. This page lists every kind, in the order the slash menu shows them, with the ways to insert each one.

## Ways to insert a block

- **Slash menu**: type <kbd>/</kbd> and the block's name, then press <kbd>Return</kbd>. You can also click **Add block** beside any block.
- **Markdown shortcut**: type the shortcut at the start of an empty block, followed by a space.
- **Key**: with the cursor in a block, press the key to turn that block into the kind. Some kinds can also be pasted or dropped in.

<img class="shot" src="/screenshots/slash-menu.webp" alt="The slash menu, listing block kinds in sections" />

| Block | Slash menu | Shortcut | Key or other way |
| --- | --- | --- | --- |
| Text | **Text** | | <kbd>⌥⌘0</kbd> |
| Small text | **Small text** | | |
| Heading 1 | **Heading 1** | `#` | <kbd>⌥⌘1</kbd> |
| Heading 2 | **Heading 2** | `##` | <kbd>⌥⌘2</kbd> |
| Heading 3 | **Heading 3** | `###` | <kbd>⌥⌘3</kbd> |
| Heading 4 | **Heading 4** | `####` | <kbd>⌥⌘4</kbd> |
| Quote | **Quote** | `>` | <kbd>⇧⌘B</kbd> |
| Toggle | **Toggle** | | |
| Emoji | **Emoji** | | |
| Bullet list | **Bullet list** | `-` | <kbd>⇧⌘8</kbd> |
| Numbered list | **Numbered list** | `1.` | <kbd>⇧⌘7</kbd> |
| Alphabetical list | **Alphabetical list** | `a.` | |
| Roman list | **Roman list** | `i.` | |
| To-do list | **To-do list** | `[]` | <kbd>⇧⌘9</kbd> |
| Code block | **Code block** | ` ``` ` then <kbd>Return</kbd> | <kbd>⌥⌘C</kbd> |
| Table | **Table** | | |
| Columns | **Columns** | | |
| Group | **Group** | | <kbd>⌘G</kbd> on selected blocks |
| Divider | **Divider** | `---` | |
| Image | **Image** | | paste or drop an image |
| Video | **Video** | | |
| Audio | **Audio** | | |
| Voice recording | **Voice recording** | | |
| File | **File** | | |
| Embed | **Embed** | | paste a YouTube or Vimeo link |

You can change a block's kind later with **Turn into** in the block menu. See [Selecting and moving blocks](/write/selecting-blocks).

## Basic

### Text and small text

**Text** is a plain paragraph. **Small text** is a paragraph in a smaller size, for captions and fine print.

### Headings

Four levels, from **Heading 1** to **Heading 4**. An empty heading shows its level as a hint. Pressing <kbd>⌫</kbd> at the start of a heading turns it back into text.

A page with two or more headings gets a table of contents beside it. See [The block editor](/write/editor#see-the-table-of-contents).

### Quote

A quote has a bar down its left side. Pressing <kbd>⌫</kbd> at the start of a quote lifts that line out of it.

### Toggle

A toggle has a title line and content you can hide.

1. Type `/toggle` and press <kbd>Return</kbd>. The toggle opens with the cursor in its title.
2. Type the title and press <kbd>Return</kbd> to move into its content.
3. Click the chevron to close it, and again to open it.

The toggle stays open or closed as you left it, also after you reopen the page.

### Emoji

**Emoji** puts an emoji in front of a line, 💡 to begin with. Click the emoji (**Change emoji**) to open the picker, where you can search with **Search emoji**, choose from the full set in groups, or click **Remove emoji**.

## Lists

**Bullet list**, **Numbered list**, **Alphabetical list**, **Roman list** and **To-do list**. Press <kbd>Return</kbd> for the next item. Each item is a block with its own handle, so you can select, drag and delete items one by one.

- Alphabetical lists are marked `a.`, `b.`, `c.` and roman lists `i.`, `ii.`, `iii.`, in lowercase.
- A lettered or roman list typed right under another list starts a list of its own.
- To-dos have a box to check. See [Check off to-dos](/write/editor#check-off-to-dos).

## Blocks

### Code block

Type ` ``` ` and press <kbd>Return</kbd>, or choose **Code block**. Inside it, <kbd>Return</kbd> adds a new line and <kbd>Tab</kbd> indents. To leave the block, press <kbd>Return</kbd> three times at its end.

When you point at the block, or the cursor is inside it, three controls show:

- **Language**: reads **Plain text** to begin with. Choose a language to colour the code. The list includes Bash, C, C++, C#, CSS, Go, HTML / XML, Java, JavaScript, JSON, Markdown, Python, Rust, SQL, Swift, TypeScript, YAML and more.
- **Copy code**: copies the code to the clipboard.
- **Download code**: saves the code as a file named for its language, such as `snippet.js`.

A code block in Markdown also has **Turn into formatted text**. See [Pasting Markdown](/write/markdown).

### Table

Type `/table` and press <kbd>Return</kbd>. A table with a header row and three columns by three rows appears, with the cursor in the first header cell.

| To | Do this |
| --- | --- |
| Move to the next cell | <kbd>Tab</kbd> |
| Add a row below this one | <kbd>Return</kbd> in a cell's text, or <kbd>⌘Return</kbd> anywhere in a cell |
| Write a second line in a cell | <kbd>⇧Return</kbd> |
| Resize a column | Drag the border between two columns |

A list or code block inside a cell keeps its usual <kbd>Return</kbd>: it adds a list item or a code line, not a row. Use <kbd>⌘Return</kbd> there to add a row.

Each row and column has a handle, named like **Row 1** or **Column 2**. Click one for its menu:

- Rows: **Add row above**, **Add row below**, **Delete row**, **Delete table**.
- Columns: **Add column left**, **Add column right**, **Delete column**, **Delete table**.

Each button names itself in a tooltip when you point at it. The table's **Add block** and **Drag to move** sit above the row handles, so each is easy to hit. Handles are hidden on a read-only page.

### Columns

**Columns** puts two empty columns side by side, each with a muted **Empty column** hint. The cursor starts in the first column; press <kbd>Tab</kbd> to move to the second. Each column holds any blocks you like. The columns block has one handle for the whole layout.

### Group

A group draws a box around blocks that belong together. Select the blocks and press <kbd>⌘G</kbd>. You can also choose **Group** in the slash menu: on an empty line it starts an empty group, and on a line with text it puts that line in one.

### Divider

A thin line across the page. Type `---` or choose **Divider**; the cursor moves to an empty line below it.

## Media

Images, video, audio and files are stored with your notes. In the Mac app they sit next to your notes' database; in a browser they are kept inside the page.

### Image

There are three ways to add one:

- Choose **Image**, then **Choose file**.
- Paste an image. It goes in at the cursor.
- Drop an image file onto the page. It goes before or after the block you drop it on, by which half you hit, and that block stays whole.

An image starts at medium width. Click it to show the **Image** toolbar, where you can pick **Small**, **Medium** or **Full** (full width), **Replace** the file or **Remove** it. The width is kept with the page.

### Video and audio

Choose **Video** or **Audio**, then **Choose file**. Both play in the page with the app's own controls: **Play** (then **Pause**), the time, a **Seek** slider and **Mute**. Video also has **Full screen**, which fills the screen with the player and its controls; **Exit full screen** brings it back.

- Clicking the picture selects the video block. It does not start playing.
- The time shows hours for files an hour or longer, like `1:23:20`.
- A tall portrait video is letterboxed so it and its controls stay on screen.

**Voice recording** records from your microphone and writes down what you say. See [Voice notes](/capture/voice).

### File

Choose **File**, then **Choose file**, to attach any file, such as a PDF. A card shows its name and size. Click the card to open the file.

### Embed

Choose **Embed**, paste an address into **Embed URL** and press <kbd>Return</kbd> or click **Embed**. YouTube and Vimeo links become players; other `https://` addresses are shown in a frame. Text that is not a link is marked invalid.

Pasting a YouTube or Vimeo link into an empty line embeds it straight away.

### When a file can't be shown

If an image, video or audio file can no longer be loaded, the block says so, such as **This image can't be shown** or **This video can't be played**, with a **Choose file** button to pick it again.

### Remove a media block

Click the image, video or other media block and press <kbd>⌫</kbd>.

## Links to pages

Type `@` or `[[` and a page's name to link another page. A link alone on its line becomes a block you can show as a **Line**, a **Small card**, a **Wide card** or the **Page** itself, read only. See [Links and backlinks](/organize/links).

The slash menu's **New** section makes a new page of any type, such as a task or a person, and links it where the cursor is. See [Links and backlinks](/organize/links).

::: info Limits
There are no math blocks yet. Columns and groups have equal widths, and list items inside columns have no handles of their own. In the Mac app, a file card whose file was moved or deleted does nothing when clicked, rather than saying the file is missing.
:::

## Related

- [The block editor](/write/editor)
- [Selecting and moving blocks](/write/selecting-blocks)
- [Links and backlinks](/organize/links)
- [Voice notes](/capture/voice)
