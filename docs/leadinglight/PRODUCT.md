# LeadingLight product plan

LeadingLight is a personal desktop space for thinking and writing. Files belong to the user;
writing works offline; organizing is optional. A fresh workspace is the default.

## Milestone 1 — two pages, one place

Open any two pages side by side or stacked. Both remain editable, with independent scroll,
selection and navigation. A visible layout control opens the second pane, changes orientation
and closes it. A draggable, keyboard-accessible divider adjusts space. The active pane is clear.
Opening a page already visible focuses its existing pane rather than creating competing writers.
Dragging a page's title to a workspace edge previews and creates the corresponding split.
Dragging across an existing split repositions the same editors. Cancelling a drag leaves the
workspace unchanged; a retained closed page can reappear beside the dragged page.
Dragging a note directly from All Notes offers the same placement preview, without opening
the note first. Placing a new note saves the destination's current page before replacing it;
an unreadable note must leave the previous page intact. Internal note drops must never insert
file paths into document text. Existing folder drops and external attachment drops remain distinct.

Acceptance: type in both panes, switch pages rapidly, drag to split or swap, cancel a drag,
drag directly from All Notes, resize, rotate, close a pane, reopen the
app and verify the Markdown files and restored workspace. Failed saves must remain recoverable.
No layout action may discard pending text. Vault changes must not restore paths from another vault.

## Milestone 2 — find a page and resume writing

Preserve the upstream rich editor: headings, lists, checklists, links, quotes, code blocks,
tables, images, undo/redo, Markdown shortcuts and raw Markdown access. Capture a new thought
without selecting a type or folder. One visible Search action finds titles, aliases, filenames
and note text; its empty state offers actual recent visits. Organization starts off unless the
user has explicitly enabled it. Delayed creation and image copying retain their original page
and vault. Attachments remain local. Saving status is quiet but unambiguous; errors explain
the next useful action. See [finding and resumption](find-and-resume.md) for contracts.

The identity is a bright lighthouse on a pale sky-blue tile, with a warm lamp and coral roof.

## Milestone 3 — connected and recoverable

Verify and refine page links, backlinks, tags, daily notes, local attachments, deletion recovery
and optional organization. Prefer inherited working capabilities over rebuilding them. Add only
those surfaces that help capture, retrieve or develop an idea. Keep advanced settings secondary.

## Product rules

- A quiet document canvas, compact navigation, generous line spacing and restrained accent color.
- Familiar keyboard shortcuts and complete mouse paths; focus remains visible.
- Two panes share navigation and app chrome but own their page interactions.
- Start with two choices: Create local workspace or Open a folder.
- No account, onboarding questionnaire, forced taxonomy, streaks, overdue guilt or notification feed.
- Preserve context after absence: restore the last useful writing state and offer obvious recents.
- Standard shadcn/Radix controls and Phosphor icons; support light/dark appearance and reduced motion.

## References

[Capacities documentation](https://docs.capacities.io/reference) and direct read-only inspection
of its installed desktop app informed pane framing, compact navigation and document spacing.
Mobbin searches did not return a verified Capacities result. Supplemental references were
[Notion's document layout](https://mobbin.com/screens/eb1f804d-2396-44b5-ac66-0a4ad3923afd) and
[selection toolbar](https://mobbin.com/screens/f496e09a-815b-4c2e-9253-3db3b53db191).
The finder also draws on the compact hierarchy of Notion’s [recent pages](https://mobbin.com/screens/b1273bdd-d65d-44be-a422-ffc0f601bacd)
and [search results](https://mobbin.com/screens/6573e834-dc7c-42e4-812f-be159ac1f887), while keeping the flow local and simple.

This plan records intended acceptance; the release verification record distinguishes tested
behavior from remaining work.
