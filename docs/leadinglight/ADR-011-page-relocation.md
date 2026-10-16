# ADR 011: preserve writing and references during page filing

Status: accepted; browser lifecycle and isolated native behavior qualified in 0.9.0.

## Context

Moving a Markdown page changes the base directory of source-relative links and images.
The inherited move path preserved the source bytes and updated incoming wikilinks, but did
not preserve ordinary Markdown destinations. Its editor refresh also allowed newer buffers
to survive a rename, which is unsuitable when a folder move changes link text: an older URL
in a newer buffer could overwrite the repaired destination.

## Decision

Folder relocation has a dedicated local boundary. The renderer briefly pauses new input,
joins work already accepted, saves both panes and other pending pages, and captures exact
saved baselines. It retires visible editor instances with the existing pane reservation
mechanism before dispatching the move. Other rename operations retain their existing behavior.

The native command validates one requested vault. A pure destination transform uses
pulldown-cmark 0.13.4 with default features disabled to identify Markdown links and their
source spans. It changes destination spans instead of serializing an entire page. Code and
YAML formatting remain intact. Ordinary relative destinations retain their referents;
portable `attachments/` image forms retain the application's vault-root semantics. An
unsupported or ambiguous outgoing form refuses the move before changing the source path.
Incoming ordinary Markdown references and existing wikilinks are updated separately.

Existing no-clobber rename publication remains authoritative. The source is rechecked before
publication, and incoming pages use scoped leases, exact rechecks and staged replacement.
The walk does not follow symlinks or enter hidden stores. Requested open pages must be
accounted for even when traversal or a rewrite fails.

A folder-specific reply carries the committed source text and before/after text only for
requested open pages that changed, plus paths that could not be safely refreshed. The
renderer validates the reply against its frozen request, remaps the canonical source path,
and reopens pages in their reserved panes from proven content. Failed refreshes stay closed
until an explicit fresh open; they never resume writing stale snapshots. An unknown reply
is not permission to retry the move or recreate its old path.

## Consequences and limits

The pause is brief and explicit; the destination picker itself does not start a move.
An occupied destination is refused, without suffixing or overwriting. Ordinary blank capture
and optional organization remain unchanged. The existing reservation preserves pane ownership,
layout and editor mode; it does not preserve an editor's old undo stack or a caret bookmark.

This is not a transaction against arbitrary external editors or a power-loss guarantee.
Incoming-update failures remain visible after a committed source move. Markdown files and
attachments remain local, and no attachment is relocated or duplicated by filing a page.

The browser disk bridge refuses folder relocation until it can supply equivalent preservation;
it must never fall back to a successful in-memory move. Controlled browser receipts can
qualify interface/lifecycle behavior, while native synthetic-vault checks must qualify actual
filesystem and reference preservation. The memory preview supports only plain pages and
wikilinks and refuses other reference forms with desktop guidance.

Release evidence and supported syntax belong in the milestone verification record after
implementation tests and native acceptance, not in this design decision.
