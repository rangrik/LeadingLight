# Passage commentary: the experience

Select a passage in a page, choose **Comment on passage**, add a thought or a question if you like,
and LeadingLight keeps the passage with your words in an ordinary Markdown note linked to that page.
By default there is one such note per page; you can ask for a separate one. The page you comment on
is never changed. Nothing leaves this computer: no network, no AI service.

Words used here: **passage** (the text you selected), **commentary** (the linked note), **source**
(the page the passage came from). The note format is described in `commentary-format.md`; native
guarantees in `commentary-native.md`; renames in `commentary-renames.md`.

## Where things are

- **Rich editor:** select text; the formatting toolbar ends with **Comment on passage** (a quote
  icon and its name; only the icon in a pane narrower than 480 px, the name staying its label and
  tooltip). It is there only while the recipe is on, the pane can take input and text is selected.
- **Command palette:** **Comment on passage** (Note group) acts on the active pane's selection, rich
  or raw. With nothing selected it says “Select a passage first, then choose Comment on passage.”
  and opens nothing. Raw mode is palette only.
- **Commentary** button in a page's header, beside the backlinks count, when at least one note is
  linked to it. One note opens beside; several are listed by title. No counts or badges.
- **Source card** under a commentary's header: “Source: <title>” with **Open beside** (or **Show**
  when the source is already in the other pane).
- **Settings → Extensions:** “Passage commentary” is bundled and on by default; turning it off asks
  nothing and turning it on again asks nothing. Off removes the toolbar action and the palette entry
  only: the Commentary button, the source card and every note stay.

## Capturing

The selection is read when you click or choose the command, before focus moves, from the pane you
used. If that page has unsaved words they are saved first; if they cannot be saved, nothing opens:
“Save this page first. Its latest words couldn't be saved.” If the page changed while it saved,
nothing opens and you are asked to select the passage again. A passage over 64 KiB is refused
(“That passage is too long to save. Select less of it.”), as is text that cannot be kept literally.

What is kept is exactly the text you selected, plus a little context before and after, measured in
the page as saved. A place in the page is recorded only when the selection maps to the saved text
without guessing (raw selections that cut through syntax, or rich text the projection reads
differently, keep the quote with no place). Editor positions and block ids are never stored. This
release offers no jump back to a passage.

## The dialog

Title “Comment on passage”: the passage as a plain blockquote (four lines, **Show all**; two on a
narrow window), the recipe's questions (**Your thoughts**, focused, and **A question to come back
to**, both optional), where it goes, a passive preview of the new entry, then **Cancel** and
**Add** or **Create**. ⌘Enter submits. Escape or a click outside with words typed asks “Discard
your thoughts?” (Keep editing / Discard).

Where it goes, said before you press anything:

- “Checking for notes linked to this page…” while the local search runs (Add waits for it).
- No linked note: “Will create Commentary on <title> beside this page.” If a note with that name
  already exists there but is not linked, the dialog says so; Create is refused by the disk check and
  **Use a separate note** switches to a numbered name. An unlinked note is never added to.
- One linked note: “Will add to Commentary on <title>.”
- Several, or a search that could not check every note: an **Add to** list, most recently edited
  first, ending with **New separate note**. Nothing is chosen silently.
- **Separate note** switch: “Will create a new note, Commentary on <title> 2, beside this page.”
- The pane effect: “Opens beside this page.”, “Opens beside this page, in place of <page> (saved
  first).” or “Already open beside this page.”

## Adding and creating

**Create** writes a new note in the source's folder: front matter holding the capture record, the
title, one `[Source](./…)` line, the quoted passage and your words. It never replaces a file.

**Add** first saves any unsaved words in that note (“Saving…”). The note's saved bytes are then the
reviewed baseline: the whole page with one more capture in its record and one entry at its end is
written in one guarded step, only if the page still holds exactly those bytes (“Adding…”). The
title, the Source line and earlier entries are untouched. A note that ends inside an unfinished code
or HTML block is refused: “This note ends in an unfinished code block…”. Words you type in that note
after the write are never merged into it automatically.

The dialog closes only once the write is confirmed. The note opens in the other pane, never in the
source's pane: an existing split replaces the other pane's page (saved first); no split opens one
after the source, stacked when side by side would leave a pane under 400 px. The caret goes to the
end of the note. If the note was written but cannot be shown there (the pane or workspace moved on),
the dialog says “Added to …, but it couldn't be opened here. Find it in All Notes.” with **Done**, and
nothing is written again.

Refusals keep your words: the note changed since you opened the dialog (press Add to review the
updated note), its unsaved words could not be saved, a name is taken, the workspace or the recipe
changed. An unconfirmed reply shows **Check again**, which only asks about that same write and never
writes a second time; Add does not come back by itself.

## Undo

After Add or Create, the note shows “Added to this note.” or “Created beside <source>.” with
**Undo** and a dismiss control. Undo is offered while the note holds exactly the bytes written: an
Add is restored to its exact earlier text; a Create moves the new note to Trash. Unsaved words in
the note are saved first, so Undo can never remove words typed after the write; if the note changed,
it says “This note changed since the passage was added, so Undo isn't available here. Use Page
history.” The notice ends when dismissed, at the next change to the note, or when its pane leaves
the note; leaving the workspace ends it too. Page history keeps the earlier text either way.

## Source card states

- **Found:** “Source: <title>” with **Open beside** / **Show**.
- **Page missing:** “The source page can't be found. It may have been moved outside the app, renamed,
  or put in Trash.” with **Find it…**, which opens the finder. The quote stays as it is.
- **Link not readable** (edited, several links, external): “This note's source link can't be read.
  Edit the Source line under the title to reconnect.”

The card speaks only about the page, never about whether the passage is still in it. Notes with an
unknown record version stay ordinary notes without a card.

## Limits of this release

- The local search for linked notes looks for the record key and then reads each match; it is
  bounded and runs when a page is shown or a passage is captured, and again when pages are added,
  moved or removed, not while you type.
- A rich selection containing tables, nested quotes or other constructs the projection reads
  differently is kept as exact text without a place.
- The visible quote follows the literal encoder's rules (edge spaces of a line are trimmed); the
  record keeps the exact selected text.
- No per-passage jump or source highlighting yet. External moves or a different file at the old path
  are not detected; in-app renames and moves keep the link and leave the capture record's bytes as
  they are (`commentary-renames.md`). If a rename's reply is lost, the source and every open page it
  may have changed, the commentary included, keep new words on screen but stop saving them, and
  cannot be renamed, moved, put in Trash or added to, until LeadingLight is reopened; Save says so
  instead of overwriting what the rename may have written. There is no in-app choice yet to keep
  those words as a copy.
- Browser checks run against the development bridge on synthetic vaults and do not establish native
  durability.
