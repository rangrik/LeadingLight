# ADR 009: pane-owned editor modes

## Context

The upstream editor stores its rich-text/Markdown preference in the shared vault configuration.
Two editors that subscribe to that preference change mode together. The second editor receives
that change without running its own normal content-preparation path.

LeadingLight already gives each pane a stable identity and keeps one editor owner per page.
Changing how one page is displayed should not change the other pane's editor.

## Decision

The split workspace owns one mode preference for each stable pane. It supplies an optional
controlled-mode interface to the existing editor hooks. Controlled editors do not subscribe to
or write the shared mode field; callers without the interface retain the upstream preference.

The local workspace snapshot stores an optional validated pair of modes in the same visual
order as its page paths. A pane carries its mode when moved, retains it while navigating, and
keeps it when closed and reopened. Old snapshots remain readable. Without saved pane modes,
the matching vault's legacy preference seeds both panes once; absent or unreadable preferences
fall back to rich text. Later global configuration broadcasts cannot reset those choices.

A mode transition reserves the current pane, page, navigation generation and vault session.
It commits only while that reservation remains current. Repeated pending commands are
coalesced. A replaced page, closed pane or later visit to the same vault cannot receive an old
completion. Existing recovery and workspace-operation input guards remain authoritative.

The existing rich/raw content preparation, pending buffers and caret restoration continue to
own the transition. Refused or failed preparation leaves the current mode in place. A
successful mode change is not an acknowledgment that the file has been saved; the existing
save coordinator and visible save state remain the persistence authority. The rich editor's
emergency raw fallback targets its own pane without attempting the failing serialization again.

## Consequences

Two pages can remain independently rich or Markdown through layout changes and normal restart.
No note format, native command, new dependency or remote service is introduced. Forced raw
display for non-Markdown content remains a document capability, separate from pane preference.
One page still cannot acquire competing editor buffers in both panes.

Workspace storage is best effort. If the local preference store is unavailable, editing remains
possible but reopening cannot promise to restore a preference that was not written. Release
qualification and its limits are recorded in [VERIFICATION.md](VERIFICATION.md).
