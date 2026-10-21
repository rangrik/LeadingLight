# Asking about text you attach: the experience

**Ask LeadingLight** (the dialog that also builds extensions, formerly Adapt) answers questions about
text you attach. You attach a passage, a page or pasted text, ask in your own words, and the reply is
an **answer** you can read and copy. When the request is about how LeadingLight should work, the reply
can still be an extension candidate, exactly as before.

## Where things are

- **Ask LeadingLight…** in the sidebar (with its one status, **Working…** or **Reply ready**), in the
  command palette, and as **Ask…** in Settings → Extensions. Opening it attaches nothing.
- **Ask about this page…** in the command palette: opens Ask with the page in front attached, after
  its unsaved words are saved.
- **Ask about this passage** in the command palette: takes the text selected in the active pane, rich
  or raw, and opens Ask with it attached. With nothing selected it says “Select a passage first, then
  choose Ask about this passage.” and opens nothing.

Only Codex answers; Claude is unavailable. Nothing runs in the background, and nothing is sent until you
press **Send**. Answers are read-only in this release: nothing in a reply changes a page.

## What is sent

Send carries three things and nothing else from your workspace:

- your request;
- the attachments shown above the composer;
- LeadingLight's guide.

The earlier requests and replies shown in the conversation are added only when the line under the
composer says so. **New request** leaves them out.

- **No implicit context.** Opening the dialog reads nothing. Pressing Send attaches nothing on its
  own: the page you are on, your selection and your links are never added for you.
- **Labels, not paths.** Attachments are sent with their titles as labels. File paths never leave the
  computer.
- **Removing a chip.** A removed attachment is not in the next Send. Earlier replies shown in the
  conversation may still quote it; **New request** starts without them.

## Attaching

**Attach** offers these choices:

- **Selected passage.** The active pane's selection, taken when you choose it. It is labelled
  "Passage from <page>". If nothing is selected, it says so and attaches nothing.
- **Current page.** The page in front, saved first and taken as it is then.
- **Another page…** Opens the page finder to choose one. Here it matches page titles and paths only
  and never searches page text, so no other page is read while you choose. The chosen page is not
  opened; its saved text is attached (saved first if it is open in a pane). Only Markdown pages can be
  attached.
- **Pasted text…**
- **An existing extension.**

Several pages can be attached, each by its own choice. Attaching the same page again replaces its chip.
Each chip is a button: open it to see exactly the text Send will carry, as plain text. A long text
shows its first lines with **Show all**. The × removes the chip. When a fresh request has a single
chip, its text is shown open.

The limits are unchanged, and over a limit the dialog says what to shorten:

- 8 attachments;
- 128 KB each;
- 512 KB together with the request and the earlier replies included.

Earlier answers count in full toward the 512 KB, so a long conversation may need **New request**.

## Answers

An answer is the model's short note, then its text as formatting, shown the way LeadingLight previews
page text.

- Headings, lists, emphasis, quotes, code and tables are shown.
- Links are plain text and cannot be opened.
- Images are a short placeholder and are never loaded.
- HTML is shown as the characters it is.
- Wiki links, callouts, math and other workspace syntax stay literal.
- Nothing is fetched.

**Markdown** shows the exact text. **Copy** puts that exact text on the clipboard. If copying fails,
the answer stays where it is, shown as Markdown so you can select it, and the dialog says so. Copy
works on every answer in the conversation, not only the latest.

Questions, "not possible" replies and extension candidates behave as before: Preview and turn on, Keep
for later, Try it, Undo.

## Resuming

Conversations stay on this computer:

- closing the dialog keeps the request, the chips and any reply still working;
- **Ask about this page…** and **Ask about this passage** return to the conversation that last asked
  about that page, shown as it was stored, with the new chip in the composer. Without one they start a
  fresh request, keeping anything you typed. This window remembers only page paths and conversation
  ids, and never sends them;
- opening Ask from the sidebar shows the latest conversation when it ended with a reply;
- **Earlier requests** lists the others.

Returning to a conversation never reads the page again. When you send in it, the earlier requests and
replies shown there go along; the line under the composer says so before you press Send, and **New
request** leaves them out.

## Limits of this release

- Answers cannot yet be saved as a note or added to a page; copy them instead.
- There is no Ask button in the editor's formatting toolbar yet; use the command palette or Attach.
- Ask is in the main window only.
- The model sees only what you attach. It cannot search your workspace, read linked pages or open
  files.
- An older LeadingLight cannot show a conversation that contains an answer. It leaves the conversation
  on disk untouched.
- How well Codex answers, and the native window, are not qualified by the browser checks.
