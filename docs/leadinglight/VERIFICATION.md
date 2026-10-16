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

# Milestone 2 — finding and resuming

Validated on macOS on 2026-10-15 for version 0.2.0. The new finder combines title,
alias and filename matching with local page-text snippets. Empty search shows actual recent
visits, including the current page. Organization is opt-in. The app icon is a bright lighthouse.

## Behavior and failure recovery

Seven browser acceptance checks passed across the final full pass and two corrected fault-harness
rechecks. These covered title/alias/body matching, deduplication, archive exclusion, keyboard and
mouse selection, focus restoration, recent visit order and reload, composition handling,
failed creation and retry, repeated activation during a delayed write, failed text search and retry,
stale responses, and reuse of a page already open in another pane. The dialog was also checked
in light and dark appearance and at narrow widths without horizontal overflow.

Focused regression tests cover creation ownership across pane and vault changes, writing named
pages before binding an editor, filename collisions, and late image imports. An independent
review found and reproduced an inherited rename heuristic that could confuse similar files.
The fix requires explicit rename provenance before preserving the editor's document identity.
The final safety run passed 150 targeted tests and 756 related tests. The finder passed all
16 component tests; the final app and LeadingLight group passed 173 tests. These overlapping
runs are not a count of unique tests in the repository.

## Native writing and restart

The packaged 0.2.0 app was launched with an isolated configuration and a disposable empty vault.
Mouse-driven creation and rich-text writing worked in both panes. Search found a phrase present
only in a page body and focused its existing pane without duplicating the editor. Command-P,
Escape and outside dismissal returned focus correctly; subsequent typing changed only the
intended page. Recent visits were checked against file modification times to verify that visits,
not edits, determine their order.

An image and a file were imported through the native chooser. Markdown stored relative attachment
links, and both copied files matched their input SHA-256 hashes. After confirmed editor input,
Command-Q produced a successful renderer save acknowledgment and a clean application exit.
Relaunch restored both pages, their 55/45 split, the active page, the final input, rendered image,
file block and recent order. This checks normal shutdown, not force-kill or power-loss recovery.

## Scope and known limits

No dependencies were added for this milestone. The existing dependency compatibility holds
remain documented in [DEPENDENCIES.md](DEPENDENCIES.md). The native build uses the same reusable
debug target; no additional release or coverage cache was created.

The fork currently uses English source strings and the inherited fallback system. Full locale
parity does not pass: the baseline already lacked 40 keys per target locale, and this milestone
adds 19 English keys. No cloud translation service was used. Remote AI and simultaneous mounted
workspaces remain deliberately disabled; historical tests that require them do not qualify those
features for LeadingLight. The entire upstream feature set and Windows/Linux runtime remain
outside this release's verified scope.

An inherited relationship-inspector issue remains for the next milestone: a human-form key such
as `Belongs to` can also produce an empty suggested relationship row. This milestone verifies
the populated relationship, but does not qualify adding through that duplicate suggestion.

The local macOS bundle was signed ad hoc after packaging to seal its resources, then passed
strict `codesign` verification. This is a local development build, not a notarized distribution.
The installed bundle was then launched against the same disposable vault and checked for its
version, restored pages and attachments, followed by another successful normal shutdown.

Across the targeted public browser runs, 49 distinct tests passed in the 18 changed smoke files.
Four historical cases were skipped: remote AI and mounted workspaces are disabled by fork policy,
and two archive-banner/badge cases lack their expected demo data. The finder has a separate,
passing fixture-backed archive-exclusion test. Corrected tests preserve their behavior assertions;
readiness and virtualized-list handling were updated for the new surface. These results combine
focused runs and are not presented as a full upstream regression-suite pass.

# Milestone 3 — connected and recoverable writing

Source and isolated native-app verification for version 0.3.0 on 2026-10-15 use disposable
Markdown folders. Native packaged-app acceptance and automation limits are recorded below.

## Daily pages, backlinks and recovery

Six fixture-backed browser flows pass after the final lifecycle corrections, with one worker
and no retries. Today uses the local calendar date even when UTC is already the next day,
opens the body ready to type, and reuses its exact file after repeat activation and reload.
The shortcut does not type into the previously focused editor. Backlinks count resolved sources,
open the correct same-title page, preserve the other pane, and reuse an existing page owner.

Moving a page to Trash preserves immediately preceding input, removes it from search and the
ordinary list, and retains the other page and split layout. Trash survives reload. Restore
returns the saved bytes; an occupied original path produces a suffixed copy without modifying
the occupant. The result exposes its actual path and an Open action. Folder menus and the
command palette do not expose permanent folder deletion.

Review-driven regressions cover stale Undo after leaving and returning to a vault, synchronous
Trash admission during quit or workspace switching, and truthful recovery after a file moved
successfully but a later editor check failed. A delayed status message explains longer moves
or restores without taking focus. The inherited duplicate relationship suggestion now preserves
the canonical stored key and existing values.

## Checks and scope

Both application and build-script TypeScript configurations pass, as does lint of changed code.
The final App, LeadingLight and held-save test group passes 226 tests. A broader affected run
passes 2,197 tests and fails five inherited `useMcpStatus` assertions about upstream AI-control
wording and clipboard snippets. Those files are unchanged from the preceding release and the
same five fail in isolation; this is not a clean full-suite claim. The separate Inspector group
passes 143 tests. These overlapping groups must not be added together as unique coverage.
The development-server test group passes all three tests.

The locked Rust check passes. The LeadingLight native group passes 31 tests; one additional
child-process helper is intentionally ignored as a standalone test and invoked by the lock test.
Native tests cover safe paths, multiple-process locking, byte-preserving movement, collisions,
malformed metadata, interruption recovery and idempotent cleanup after restore. They do not
establish power-loss durability or a backup/version-history feature; see
[ADR 003](ADR-003-local-trash.md).

No dependency was added. Rust's declared minimum version is now 1.89 for standard-library file
locking. Dependency compatibility holds and English locale fallback remain disclosed. Other
operating systems and all inherited features remain outside the current runtime qualification.

## Native writing, recovery and layout

The isolated 0.3.0 QA bundle uses its own application identity, configuration, WebKit store and
synthetic vault. The installed personal application and real vault were not used for testing.
Native Today opened the body for typing, reused the local-date page on repeat activation and
Command-Shift-D, and retained its text after a normal quit and relaunch. Backlinks opened the
correct duplicate-title source while leaving the other pane intact.

Native Trash persisted across restart. Restore returned the original page and its bytes, and
Open displayed it beside the retained second page. A separate immediate-input check confirmed
that newly typed body text, the heading and the existing link all survived Move to Trash and
Undo. Both synthetic attachments still match their seeded hashes. Window close produced a
successful renderer save acknowledgment before application exit, and relaunch retained the
restored body text.

Properties now floats inside narrow panes and returns inline in wider ones without remounting
the editor. Native checks covered light/dark appearance, horizontal/stacked layouts, and an
actual 1100-by-760 window that stays the same size when Properties opens. Escape closes the
floating panel and returns focus to Backlinks. Selected attachments retain readable contrast in
dark mode. Behavioral tests cover live resizing, focus return and both native constraint-update
paths; the focused window-control group passes 13 tests and two App integration checks.

The native computer-use provider could not bind this QA application. Scoped macOS accessibility
actions and keyboard input were used instead. A system Screenshot overlay prevented guarded
physical mouse clicks, so these native accessibility checks do not establish native pointer
hit-box coverage. The browser flows exercise the actual mouse paths. The final pane-focus chord
was not requalified during this pass; the earlier milestone's shortcut checks remain separate.
