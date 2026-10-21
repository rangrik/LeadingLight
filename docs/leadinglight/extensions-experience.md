# Extensions: the E1 experience

Extensions are optional workflows that create ordinary notes. Nothing runs until you turn one on.
An extension is a data-only package (see `extensions-catalog.md`); LeadingLight shows its own
form, preview and buttons and performs every effect itself. This milestone creates new notes from
a form in a folder you choose. It does not read selections, add to existing pages, use the network
or contact any AI service.

## Where things are

- **Settings → Extensions**, after Workflow. One row per stored package: its name, summary, a status
  (On, Off, Not on yet, Unavailable in this version, Can’t be read), Preview, and a switch.
  The last row is **Paste extension…**.
- **New page → From extension…** under From template in the sidebar, and **New page from
  extension…** in the command palette. Both appear only while an extension can run. With one, its
  form opens directly; with several, a small chooser lists every command of every extension that
  is on.

## Turning one on

Preview shows what the extension does, in LeadingLight’s own sentences (how many questions, where
it creates its note, whether it opens it), and a sample note made from sample answers. The preview
writes nothing. **Turn on** is the only confirmation. Turning off asks nothing; notes the extension
created stay as they are. Turning the same reviewed version back on asks nothing.

A valid extension that needs something this version cannot do yet (for example selecting text in
a page) stays visible, says what it needs, and cannot be turned on.

## Adding your own

**Paste extension…**, paste the package text, **Check**. A package with a mistake is not added; the
message gives the validator’s first reason and its exact location in the package (a JSON Pointer
such as `/commands/0/steps/1/folder`), with every problem under Details. A valid package opens the
same preview. Pasting a newer version of an extension that is on shows what changes; turning it on
replaces the behaviour, and **Go back to version …** restores the earlier behaviour after one
question. Neither changes any note; use Page history to change a note.

## Running one

The form shows the extension’s questions, **Create in** (the workspace folder or one of its
folders; the last folder you used for that command is offered again while it still exists), and
the exact file it will create, for example `Will create Meetings/debrief-weekly-sync.md`. The note
preview updates as you type. Below 720 px wide it waits behind **Show preview**; the destination
stays in view. **Create**, or ⌘Enter, is the single confirmation.

Your answers stay in the form whenever nothing was created:

- an unanswered required question is marked under the field, and focus moves to it;
- a note with the same name in that folder is never replaced: change the name and Create again;
- a folder that cannot be written, or a check that did not match, says nothing was created.

If LeadingLight cannot confirm whether the note was created (for example a lost reply), the button
becomes **Check again**. It asks about that same attempt and never writes a second note. Closing
then asks whether to stop checking. If the workspace changes, or the extension is turned off or
replaced while the form is open, the form says it can no longer be submitted and keeps your
answers to copy.

When the extension asks to open its result, the created note opens in the pane that was active
when the form opened. If that is no longer possible, or the extension only creates the note,
the form says where the note was created.

## What is and isn’t backed up

Notes made by extensions are ordinary Markdown notes and are included in workspace backups as
usual. Extension packages and whether each is on are kept on this computer only, and workspace
backups do not include them yet. A backup waits for an extension note already being written to
finish before it starts.

## For developers

- `extensionTransport.ts`: the only route to native; closed command table, strict readers in
  `extensionReplyReaders.ts`, `null` for any unusable reply.
- `extensionMarkdown.ts`: typed document → host Markdown through the literal encoder; digest and
  filename.
- `extensionSessionController.ts`: registry view, visits and sessions, runs, recovery; no React.
- `useExtensions.ts`: one controller per window, visits per vault, and the boundary used by vault
  switch, window close and backup (`holdWithExtensions` for backup).
- `useExtensionUi.tsx` and the `Extension*Dialog.tsx`/`ExtensionSettings.tsx` components: surfaces.
- Tests beside each module; `extensionMarkdown.pipeline.test.ts` and `.schema.test.ts` exercise the
  real encoder and parsers; `tests/smoke/leadinglight-extensions.spec.ts` covers the browser flow
  on disposable vaults.
