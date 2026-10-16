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

Version 0.3.0 adds three connected writing features:

- Today opens one ordinary Markdown page for the current local date, ready to write. Repeated
  visits reuse that page; there is no daily review obligation or automatic page creation.
- Backlinks are easy to find and open the exact source page, including pages with duplicate
  titles. Existing relationships retain their values and do not show duplicate suggestions.
- Local Trash makes page removal reversible across restarts. Save pending writing before
  moving a page, preserve attachments, keep the other pane intact, and never overwrite a
  conflicting file during restore. No automatic expiry or permanent erase control is planned.

The verification record identifies the qualified behavior and remaining limits. The narrow-pane
Inspector floats above the page without squeezing its writing area or enlarging the native window.

## Milestone 4 — capture without waiting

Version 0.4.0 accepts typing immediately after New page or Today, even while the local file is
being created. The pending field belongs to the requested pane and vault. It hands the complete
text to that page's editor and retains a receipt until the save is proven. Naming remains optional;
a failed create keeps the captured words available for retry. Normal close and vault switching
cannot silently abandon an unresolved capture.

The next release strengthens ordinary saves and explicit draft recovery before adding automatic
local page history. Its qualification is recorded separately in VERIFICATION.md.

## Milestone 5 — earlier writing stays reachable

Version 0.5.0 keeps bounded automatic page history locally. Earlier versions can be previewed
and recovered into a new copy without replacing the current page. History remains reachable
after a page rename or removal, and gaps are reported rather than hidden. Ordinary saves and
explicit draft recovery retain their own visible outcomes.

## Milestone 6 — a local copy of the workspace

Version 0.6.0 adds manual backup and restore from the workspace menu. Backup first settles
writing in both panes, then copies pages, attachments, saved views and valid earlier versions
to a chosen local folder with a verifiable manifest. Trash, Git history and temporary data are
excluded. Restore checks the backup and creates a new folder; it never overwrites an existing
workspace. Opening the restored copy is an explicit action.

## Milestone 7 — each pane keeps its own editor

Version 0.6.1 lets one pane stay in rich text while the other uses Markdown. The choice belongs
to the pane through navigation, layout changes, closing and reopening, and normal app restart.
Mode changes retain current words and respect focus when the person moves to another pane or
control. A rich-editor recovery action also targets only its own pane.

## Following increments

Continue in useful, independently verified releases, reusing working inherited capabilities:

1. Capture and resumption: continue polishing the delivered immediate capture, useful pinned
   pages and clear empty states. Naming and organization remain optional.
2. Optional organization: tags, collections and local templates that reduce repeated work.
   Do not require a taxonomy to create or find a page.
3. Rich editing: qualify and refine tables, checklists, code, links, images, paste, undo and
   formatting, including independent editing in both panes.
4. Connected knowledge: improve object properties and navigation when they make a concrete
   writing or retrieval task easier. Keep advanced views secondary.

Correctness and usability fixes can precede the next feature. New surfaces must preserve
local storage, visible error recovery and the existing save/navigation contracts.

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
