# ADR 012: Internal pointer gestures for note rows

Date: 2026-10-20
Status: accepted with browser qualification; native interaction remains unqualified

## Context

LeadingLight supports dragging page tabs to rearrange split panes. Rows in All Notes used
HTML5 drag payloads, with separate pane and sidebar handlers. Browser mouse tests established
that path, but native automation could not establish an operating-system drag session. Those
failures did not prove a product defect. A consistent internal gesture gives the app direct
ownership of previews, cancellation and destination admission across note rows and page tabs.

## Decision

Use one internal pointer session for Markdown note rows, shared by pane and sidebar adapters.
Keep the existing page-tab gesture and editor external text/image drop handling unchanged.
Reuse the existing page drop overlay and sidebar target styling, with no new dependency.

A short press remains a normal click. Modified presses, property controls and context-menu
presses retain their current behavior. A small movement threshold starts a drag; capture uses
a stable surface, while the source path remains the one recorded at press time even if the
virtualized row is recycled. The release point decides the destination. A session ends before
calling the chosen destination so it cannot dispatch twice.

Vault, page, layout and pending-transition changes invalidate the whole row session, including
sidebar destinations. Escape, outside release and pointer cancellation never apply an earlier
preview. Cleanup must not suppress a later unrelated click. The destination revalidates current
eligibility and uses the existing save/relocation machinery.

## Consequences

Note rows no longer export an absolute file path through a native text drag into another app.
The existing Copy file path action remains available. This is a deliberate behavior change;
editor external file/text handling is separate and remains unchanged.

Integration is limited to NoteItem, pane/list and sidebar drop adapters, and removal of redundant
folder handlers. The shared gesture lives under `src/leadinglight/`. Reconcile these seams when
merging upstream changes; do not restore an HTML5 note payload alongside the pointer gesture.
No note storage, native command, dependency or network behavior changes.

The chip is portaled to the document body so editor containment cannot clip it over the list.
Only the chip observes pointer coordinates; unchanged drop zones do not rerender both editors.
Escape is consumed only while dragging. Sidebar folders outside view require scrolling first
or with the trackpad/wheel during the gesture; native HTML5 edge auto-scroll is not retained.

Runtime acceptance must cover trusted pointer placement on all edges and pane centers,
existing-page reuse, cancellation, click/selection controls, pane writing and sidebar dispatch.
The owner requested browser UI testing during this milestone to keep the desktop available.
Native checks may run without showing a window, but browser pointer tests do not establish
WKWebView interaction acceptance. Record that qualification limit in the release evidence.
