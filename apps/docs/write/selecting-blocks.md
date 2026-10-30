---
title: Selecting and moving blocks
description: Select whole blocks to delete, copy, move, group or change them, and use the block menu.
---

# Selecting and moving blocks

Besides selecting words, you can select whole blocks: one paragraph, a few list items, or the whole page. Selected blocks show a soft tinted background instead of the usual text highlight. You can then delete, copy, move, group or change them together.

## Select blocks

| To | Do this |
| --- | --- |
| Select one block | Point at it and click **Drag to move** beside it |
| Select a range | Select one block, then hold <kbd>⇧</kbd> and click **Drag to move** beside another |
| Select the block you are writing in | Press <kbd>Esc</kbd> |
| Go back to writing in it | Press <kbd>Esc</kbd> again |
| Add the block below or above | <kbd>⇧↓</kbd> or <kbd>⇧↑</kbd> |
| Select every block | <kbd>⌘A</kbd> |
| Clear the selection | Click into any text |

Clicking a handle also opens the block menu (see below). Press <kbd>Esc</kbd> to close the menu and keep the block selected. A <kbd>⇧</kbd>-click only selects; it opens no menu.

<kbd>⇧↓</kbd> and <kbd>⇧↑</kbd> grow and shrink the selection from where it started. With "two" selected, <kbd>⇧↓</kbd> adds "three"; <kbd>⇧↑</kbd> then goes back to "two" alone, and once more adds "one" above it.

In a list, each item can be selected on its own. Pressing <kbd>⇧↓</kbd> past a list's last item selects the whole block that holds the list; the next press adds the block after it.

<kbd>⌘A</kbd> in a code block selects only the code. Press it again to select every block. In light and dark mode, a full selection reads as one unbroken tint, across headings, quotes, dividers and media.

Clicking into the title clears a block selection.

## Act on selected blocks

- **Delete**: press <kbd>⌫</kbd>. Every selected block is removed. If you delete every block, the page is left with one empty line and the cursor in it.
- **Copy and paste**: press <kbd>⌘C</kbd>, put the cursor where you want them, and press <kbd>⌘V</kbd>. The blocks arrive as they were. List items copied as plain text give one line per item.
- **Move**: drag the handle of any selected block. The whole selection moves together.
- **Group**: press <kbd>⌘G</kbd> to put the selected blocks in a group box. See [Block kinds](/write/blocks#group).
- **Duplicate**: press <kbd>⌘D</kbd>.

Typing while blocks are selected changes nothing, so a stray key can't replace them. This also holds for text from the emoji picker or dictation.

## Move blocks by dragging

Drag a block by its **Drag to move** handle. A line shows where it will land, decided by height alone: over the top half of a block it lands above, over the bottom half below. See [Drag blocks and files](/write/editor#drag-blocks-and-files).

After you drop a block, only that block is selected.

## Use the block menu

The **Block** menu holds actions for the selected blocks. Open it in any of these ways:

<img class="shot" src="/screenshots/block-menu.webp" alt="The block menu beside a to-do, with Turn into open" />

- Click **Drag to move** beside a block. The menu opens to the left of the handle, and the handle stays pressed while the menu is open.
- Right-click selected blocks. The menu opens at the pointer, and the blocks stay selected. Right-clicking text that is not selected shows no block menu.
- Press <kbd>⌘/</kbd> while writing in a block. The block is selected and the menu opens beside its handle.

Use <kbd>↑</kbd>, <kbd>↓</kbd> and <kbd>Return</kbd> to work it from the keyboard, or <kbd>Esc</kbd> to close it.

If several blocks are selected and you click the handle of one of them, they all stay selected and the menu acts on all of them.

### Turn into

Point at **Turn into** to change the kind of block. The current kind has a check beside it. The kinds are **Text**, **Small text**, **Heading 1** to **Heading 4**, **Quote**, **Toggle**, **Bullet list**, **Numbered list**, **Alphabetical list**, **Roman list**, **To-do list** and **Code block**.

- Each selected block is changed on its own, and the whole change is one undo step. <kbd>⌘Z</kbd> brings the blocks back, still selected.
- Several blocks turned into a list become the items of one list. One item turned back into **Text** leaves the list and the rest stay in it.
- Several blocks turned into a **Quote** each become their own quote.
- A block turned into a **Toggle** becomes its closed title. A toggle turned into another kind keeps its text: the title takes the new kind and its content follows as plain paragraphs.

Blocks that can't change kind, such as a divider, an image, a table or columns, show no **Turn into**. Neither does a selection that includes one.

### Duplicate and Delete

| Item | Key | What it does |
| --- | --- | --- |
| **Duplicate** | <kbd>⌘D</kbd> | Adds a copy after the block and selects the copy |
| **Delete** | <kbd>⌫</kbd> | Removes the block and puts the cursor at the start of the next one |

The keys shown in the menu also work while it is open, and the menu closes. <kbd>⌘D</kbd> works without the menu, too: with the cursor in a block, it duplicates that block and leaves the cursor where it was.

## Related

- [The block editor](/write/editor)
- [Block kinds](/write/blocks)
- [Keyboard shortcuts](/customize/shortcuts)
