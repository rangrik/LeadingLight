# First usable milestone — verification

Validated on macOS on 2026-10-15, using disposable local Markdown folders. The source fork
starts from Tolaria revision `177a37e82def22c3f50d50ee2408844a89e4b117`.

## Writing and panes

New local workspaces start with zero pages. Their local Git metadata is retained, while upstream
AI guidance and type-template documents are not seeded into the note list. Regression coverage
checks the empty scan and refusal to overwrite a nonempty folder.

The packaged Tauri app was checked for independently editable pages, rich formatting saved
to Markdown, horizontal and vertical layouts, resizing, retained closed pages, searchable
page selection, independent scrolling, and reuse of an already-open page.

Native title dragging was checked for creating a split, swapping sides, stacking, cancellation
outside the writing area, and continuing to type in the moved editor. Pane-focus shortcuts
were checked to ensure they do not also format the outgoing editor's text.

Direct All Notes dragging was checked in Chromium using genuine mouse input and trusted
HTML5 drag events. All four edge placements retained the current page and opened the dragged
note; center drops replaced only their intended pane. Existing-page reuse, Escape cancellation
and dropping outside the writing area were checked. A forwarded toolbar-drop bug was reproduced
and fixed, with regression coverage for both its misleading hover and unintended replacement.
Pending edits were verified in the synthetic
Markdown files, and internal file paths were not inserted into text. The native automation
provider did not initiate an HTML5 row-drag session, so that provider's row gestures are not
counted as successful native checks.

## Persistence and shutdown

Confirmed editor input survived Command-Q and native window close. Native logs showed the
save request, successful renderer acknowledgment, then termination. Relaunch restored both
pages and their layout. These checks verify normal interactive shutdown, not force-kill or
power-loss behavior. Tests separately cover delayed writes, failed saves, composition and
serialization boundaries, empty files, stale navigation and failed restore reads.

Split-drop loading keeps the old page until a successful read. Regression tests cover failed
save/read, superseded requests, retained hidden pages, reservation ownership, pending-operation
counts, vault changes, source removal/rename and visible error feedback. Internal rejected drops
are consumed before the editor; sidebar and external drops retain their original routes.

## Build and test scope

TypeScript, changed-source lint, a production frontend build and the native macOS app build
were checked. Focused component/hook tests cover the LeadingLight integration and affected
upstream behavior. Native tests cover local policy, settings/configuration, cache paths,
vault lists and shutdown coordination. Normal local commit/push hooks enforce these checks.

This is a first usable writing milestone. The entire upstream test suite and every inherited
feature have not been qualified. Windows/Linux runtime behavior and native physical-device
row dragging were not verified in this session. Major dependency compatibility holds are
listed in [DEPENDENCIES.md](DEPENDENCIES.md).

One nonblocking restoration limitation remains: after an unreadable saved page, ordinary
navigation to another unreadable page can discard the saved layout's fallback path reference.
The underlying Markdown files are unaffected and remain accessible through the note list.
