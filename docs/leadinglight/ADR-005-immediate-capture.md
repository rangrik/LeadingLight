# ADR 005: immediate capture with explicit save acknowledgment

Status: accepted, 2026-10-16.

## Context

A new page requires asynchronous filesystem work and editor mounting. Sending keyboard input
to the previous editor, or waiting silently for the next editor, loses or misdirects the first
words. A ready Today page in another pane also needs selection and focus to change together.

## Decision

Admit New page and Today synchronously. Use one visible standard textarea while an asynchronous
destination opens. Retain request, vault-session, pane and path ownership throughout. A ready
Today editor can be activated and focused synchronously without the intermediate field.

Deliver text once to the exact mounted, editable, non-inert destination. Verify actual focus and
the ordinary save queue's full-document receipt before retiring the field. The receipt is issued
only after enqueueing and identifies canonical path, queue session and sequence. Retain that
delivery target until the queue proves a saved or completed-Trash outcome. A failed or uncertain
insertion leaves a nonreplayable recovery copy visible.

Explicit Save refuses unresolved capture without announcing success. Ordinary close and vault
switch refuse nonempty, composing or uncertain drafts promptly and prevent new capture admission
during an accepted transition. Navigation and focus changes do not discard draft text. Empty
capture can be canceled. Discarding nonempty text is an explicit confirmed action.

## Consequences and limits

The existing editor serializer and per-page save lane remain authoritative. This introduces no
second file writer, hidden buffer, network service or durable draft format. Initial field text is
in memory until handoff and saving; force-kill and power-loss recovery are not guaranteed.

Ordinary Save covers work admitted for that operation. Later typing remains independently pending
and protected by subsequent Save/close/switch checks. Multi-workspace mounting is disabled. Before
enabling it, receipt lineage must survive expansions of writable roots independently of the
queue's global mutation-cancellation epoch; scope removal must still invalidate dropped work.

Browser tests cover immediate and delayed rich/raw handoff, failed creation/retry, navigation
retention and false Save notices. Native acceptance covers immediate New/Today, refused quit
after failed creation, retry, Unicode paste and normal shutdown/restart. Native IME composition
and a full vault-switch fault matrix are not qualified by those native checks.
