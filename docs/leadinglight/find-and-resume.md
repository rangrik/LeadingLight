# Local finding and resumption

Milestone 2 contracts. See VERIFICATION.md for the tested release state.

## One way to find a page

Search in the sidebar, Cmd/Ctrl+P and the existing full-text search command lead to the same
finder. Title, alias and filename matching stays immediate. A short debounce requests body
matches through the existing local `search_vault` command. Snippets are plain text, and title
and body hits for the same path become one row. Search never calls a remote service.

An empty query offers recently opened pages. These are visits, not modification dates.
The currently open page remains in its genuine position in that history.
The list is bounded and scoped to the current vault, and labels are resolved from the current
vault listing. Local storage contains only paths and visit times; it is not a second note store.
Loading, failed navigation and background restoration must not falsely promote a page or
wipe its history. Missing, archived and unavailable pages are excluded from visible results.

## Ownership and failure

A finder selection belongs to the pane requested by the user. An already open page reveals
its existing editor so two panes cannot maintain competing buffers for one file. The dialog
closes after a successful open. Save/read failures leave the previous page and a usable finder.
Older body responses cannot publish after the query, vault or dialog session changes.

New page creation and dropped-image copying also retain their original document and vault.
A newer navigation may supersede opening a newly written file; it does not authorize deleting
that file. A page that was written but could not open receives a different message from a failed
write. Creation remains visibly busy until its outcome is known, including while the optimistic
page entry is already in memory. Moving focus to another pane must never redirect an operation there. Image imports
that finish after their editor changed documents must not insert into the replacement document.
Recorded renames preserve document identity; matching headings in different files do not.

## Integration boundary

LeadingLight-specific finder and recents modules live under `src/leadinglight/`. App owns their
integration with the existing sidebar, commands, note controllers and rename notifications.
The upstream rich editor, filesystem search and Markdown serialization remain the underlying
systems. Changes to shared creation and tab hooks are opt-in where possible, and regression
tests protect their existing callers.

This milestone does not add daily-note automation, remote indexing, a new attachment store,
mandatory organization or a new storage format.
