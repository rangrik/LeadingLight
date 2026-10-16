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

Later that evening, after the system overlay was dismissed, native computer use successfully
bound the isolated 0.3.0 app. Pointer checks verified closing Properties, opening Today, switching
to stacked pages, resizing the divider and creating a side-by-side split by dragging a page tab.
All Notes row drags still did not initiate a successful native HTML5 drop and remain unqualified.
The two-pane Today shortcut exposed a focus defect: when Today already occupied the other pane,
selection changed but typing remained in the former editor. This case is a correction and
release check for the next candidate; the earlier single-pane shortcut result does not cover it.

# Milestone 4 — immediate capture and dependable resumption

Version 0.4.0 was checked on macOS on 2026-10-16 with disposable local vaults. Ordinary New page
starts empty, accepts immediate typing, and derives its list label from saved body text without
silently renaming the file. Favorites and path search distinguish same-title pages. Empty panes
offer Resume through the existing finder. Favorite metadata, page/property saves and structural
actions share coordinated document ownership.

## Capture, focus and failure recovery

The final frozen browser candidate passes 27 distinct cases across two runs: ten immediate/delayed
capture and Save cases, then seventeen capture, daily-page, recovery, manual-rename and property-save
regressions. Runs used one worker and no retries. They include immediate mouse and Command-N input,
Today already open in another pane, delayed rich/raw handoff, Unicode text, failed creation/retry,
navigation-away retention, and checking that an unresolved draft or failed delivered write never
flashes a successful Save notice. Earlier candidate runs covered 34 distinct flows; these counts
overlap and must not be added as unique tests.

The packaged native app now passes the previously failing immediate New and two-pane Today checks
without added readiness waits. Failed creation was induced by removing write permission from only
the disposable vault directory. The full draft remained visible; Save reported it unsaved; normal
Command-Q returned `saved=false` and kept the window open. Restoring the original permission and
choosing Try again delivered the text once, with focus and continued typing intact. Both rich and
raw paths passed. Unicode paste, including accented and Japanese text, survived raw handoff and
restart. The automation provider drops accented characters with its typing method even in a ready
editor; those synthesized keystrokes are not native Unicode/IME qualification.

Immediate capture followed by normal quit persisted the entire page. A separate raw-buffer edit
immediately followed by quit also persisted. Native logs recorded successful renderer acknowledgment
before termination, and relaunch restored both pages, raw mode and the 50/50 layout. Initial capture
text remains in memory until saved; these checks do not establish crash or power-loss recovery.
Native IME composition and the complete vault-switch failure matrix remain unqualified.

## Other native checks

Earlier isolated candidate checks verified duplicate Favorites and relative-path search, type-then-star
before debounce, preservation of body text and file metadata, both dirty panes across quit/restart,
authored-title page rename and folder rename with continued writing, local attachments and hashes,
malformed raw Favorite refusal with retained text, Resume, search dismissal, stacked resizing and
light/dark appearance. A paced native rename check does not establish every pending-write race;
targeted queue tests and browser regressions cover those separately.

Native All Notes HTML5 row dragging remains unqualified. A bounded folder-drop diagnostic also
produced no movement and left all fixture files unchanged. The evidence cannot distinguish the
automation provider from WebKit behavior. Native tab dragging and divider gestures work; Chromium
checks exercise trusted HTML5 row-drag events. No speculative replacement was introduced.

## Quality gates and limits

The final correction's affected test run passes 1,255 tests in 117 files. Additional focused raw
receipt and independent notification-recorder checks pass; these overlap broader evidence. App and
build-script TypeScript, changed-source lint, production frontend build and isolated native bundle
build pass. The native bundle is signed ad hoc and passes strict resource verification. One reusable
debug target and at most two Cargo jobs were used. Earlier native Favorite/metadata/rename tests and
strict Clippy passed. Normal local hooks remain required for publication.

The broader affected frontend run passed 2,418 tests and failed five unchanged upstream `useMcpStatus`
assertions. Two supplemental release-script cases fail on inherited GNU-find assumptions on macOS.
The separate tests-only TypeScript project retains baseline fixture errors; application/build types
are clean. Full locale parity also remains incomplete (131 English fallback keys absent per target
locale). These are not claims of a clean full upstream suite, coverage qualification, or full locale
support. No telemetry or cloud translation service is used.

`yaml` 2.9.1 is the new direct dependency for validation before narrow Favorite metadata patches.
Compatibility holds remain in [DEPENDENCIES.md](DEPENDENCIES.md). Save receipts, their current
single-vault limitation, and memory-only pending drafts are documented in
[ADR 005](ADR-005-immediate-capture.md). Automatic local version history is a subsequent milestone.
The user's running installed app was not replaced or used for QA; a production update is staged
separately until it can be installed safely.

# Version 0.4.1 — safer saves and draft recovery

Validated on macOS on 2026-10-16 with disposable local Markdown folders. Ordinary page saves
now distinguish committed writes, refusals and uncertain results. Recovery stays attached to
the affected page, with Check again, Save as a new page and confirmed Discard actions.

The final browser acceptance run passes all 25 cases with one worker and no retries: thirteen
save/recovery flows, eight immediate-capture flows, two failed-save boundaries and two property
write races. These check exact disk bytes, independent panes, lost replies without replaying a
write, changed copies, newer typing, missing files/folders, refusal to write through an outside
symlink, and opening a verified copy while the full page list is still loading. Reopening after
Discard reads the current disk contents instead of an old cache. Escape and Cancel restore focus.

A rapid-switch regression exposed an old page's blocks being cached under the newly selected
path. A separate controlled-frame regression reproduced premature readiness followed by loss of
new typing. The corrections retain document identity and bind deferred completion/readiness to
the current swap. The final affected editor/save group passes 705 tests in 63 files. These are
hook/component tests with a mock editor at the timing seam; they do not establish exhaustive
browser or native scheduling coverage.

The isolated, signed 0.4.1 Mac bundle passed mouse-driven two-pane writing and recovery checks.
A read-only page kept its draft and allowed continued typing after copying; the older copy could
not settle newer text. Keeping the current copy opened it in the original pane. Removing a
synthetic source file left its draft editable, and recovery created a separate file without
recreating the missing original. Discard required confirmation; Escape and Cancel preserved the
draft and returned focus to its trigger. Reopen, immediate Save and rich/Markdown toggling did
not resurrect discarded words. The other pane's file hash remained unchanged throughout.

Typing immediately before Command-Q reached disk before native shutdown acknowledged success.
Relaunch restored both pages, their split and recovered text. A second quit with a read-only
target was cancelled with the draft still visible; repairing permissions allowed Save and a
subsequent clean quit. The personal installed app and real vault were never used for QA.

Application/build-script TypeScript and changed-code lint pass. A separately checked historical
TabSwap test file retains fifteen older mock-typing errors outside the new regressions; the
focused recovery test type project passes. English fallback remains intentional: locale
validation reports 177 absent keys per target locale, including 46 new English recovery keys.
No cloud translation, telemetry or remote note feature was added. The earlier upstream-suite
and platform qualification limits still apply.

Native checks cover the local save registry, exact request binding, file staging, copy proof,
writer leases and the disabled obsolete writer commands. The qualified save contract and its
external-writer/crash limitations are in [ADR 006](ADR-006-qualified-page-saves.md). Pending
typing and the outcome registry are process-local; automatic earlier-version history remains
the next increment. Force termination, power loss, native All Notes row dragging, actual IME
and the complete vault-switch fault matrix are not newly qualified by this release.

# Version 0.5.0 — automatic local page history

Validated on macOS on 2026-10-16 using disposable synthetic vaults. Selected earlier text is kept
inside the local vault, verified before preview or copying, and recovered as a separate page.
There is no account, telemetry or remote storage. See [local page history](local-page-history.md)
and [ADR 007](ADR-007-local-page-history.md) for capture, retention and location semantics.

Seven browser acceptance scenarios passed in one final run, one worker and no retries. They
covered real disk capture, formatted/source preview, exact-byte copies, explicit opening in the
requesting pane, independent pane entry points, command-palette routing, focus restoration and a
560 × 720 layout. They also checked passive previews without network requests, BOM/CRLF and
truncation, moved/deleted locations, explicit folder choice, damaged or missing versions, a lost
copy reply without duplication, stale responses, and history warnings separate from page saving.
The first run exposed a focus-restoration defect; a regression test and correction preceded the
passing final run. No smoke assertion was weakened.

The packaged Mac app was tested with a fresh isolated configuration and vault. Mouse input opened
two different pages, edited one and kept the other unchanged. Earlier versions showed the prior
text in formatted and source views. Save as a copy produced exactly the original 77 bytes; the
current page retained the new text. Open copy replaced only the requesting pane and focused its
editor. Escape returned focus to that pane's menu, and the native command palette opened history
for the active page. All saved locations listed its relative path. Normal Command-Q and relaunch
preserved the changed text, both panes and readable history. The QA app was closed afterwards;
the running personal installation was neither inspected nor replaced.

A separate cross-reader acceptance test drove the real Node bridge and native save paths in both
directions. Each reader listed, previewed and copied the other writer's version, matching all row
fields and exact 54-byte BOM/CRLF/Unicode payloads while leaving the current originals unchanged.
The test is ignored in ordinary Cargo runs and was explicitly executed; missing Node was checked
to fail rather than silently pass. It does not prove concurrent bridge/native locking.

Focused native history tests passed 39 cases, with three explicit acceptance/performance tests
ignored by default; the cross-reader test above was run separately. The native safety checkpoint
also passed 1,270 library tests and one integration test, strict Clippy and formatting. Final
Node bridge checks passed 30 tests. UI regression runs covered session invalidation, copy replies,
health ordering and focus; broader and narrow runs overlap and are not a unique total. TypeScript,
changed-source lint, the production frontend and packaged macOS builds passed. Normal local Git
hooks remain required; no cloud analyzer or coverage percentage is claimed for this milestone.

A warm debug-build measurement with 50 alternating-page saves at 1,000 retained versions recorded
108.1 ms median, 116.1 ms at the 95th percentile and 118.9 ms maximum save time. This informed the
initial 1,000-version total limit; the store also limits retained versions per location to 200
and counted storage to 512 MiB. These are synthetic warm-cache measurements, not release-build or
cold-storage guarantees. An authoritative bounded scan, rather than a cache, authorizes capture.

No dependencies were added. New interface strings use the English source locale and existing
fallback; full translated catalogs are not claimed. Native compact-window, fault-injection and
IME matrices were not repeated here; browser and unit evidence cover their stated cases only.
Windows/Linux runtime, force-kill and power-loss recovery remain unqualified. History is selective,
location-based and text-only; it is not a complete backup or a record of every edit.


# Version 0.6.0 — local workspace backup and restore

Validated on macOS on 2026-10-16 using disposable synthetic vaults. Back up workspace saves
open pages, copies ordinary files, attachments, saved views and valid earlier versions into a
new local folder, then checks every copied file. Restore checks the backup again and creates
an exclusive new workspace folder. Opening that workspace is a separate explicit action.
[Local backup](local-backup.md) and [ADR 008](ADR-008-local-backup.md) describe exclusions,
bounds, cancellation, uncertain replies and the non-atomic nature of this file-by-file copy.

Five final browser acceptance scenarios passed with one worker and no retries. They exercised
native-picker cancellation through a supplied test answer, editing/command guard release,
rich-text then raw edits in two panes held behind actual disk save requests, independent
manifest/hash checks, binary and empty attachments, Unicode/BOM/CRLF, nested views, retained
history and exclusions. Restore covered a 560 × 720 form, existing-folder refusal without
overwrite, exact copied bytes, unchanged source pages, explicit Open and restored-history
preview. Same-length payload corruption was refused after inspection and on fresh inspection.
Lost start replies recovered with the same operation ID; unknown status stopped polling without
replaying the job and allowed editing again. These tests use the real disk bridge; picker and
transport faults are deliberately injected. The editor-mode setting remains shared across panes.

The isolated packaged Mac app passed the native picker Cancel path, backup of two edited pages,
inspection, collision refusal, restore and explicit Open. All fourteen copied/restored files
matched the source and manifest by length and SHA-256, including two earlier versions and both
attachments. Restored modification times matched; the unfinished marker was absent only after
success. The existing-folder sentinel and source bytes were unchanged. The restored page opened
with its new text, and Earlier versions displayed the original text. The test app was closed
afterwards; no personal notes or production configuration were used.

The final cross-reader test explicitly ran the ignored native acceptance case. Native and Node
each inspected and restored the other's backup, matching the shared fixture's exact bytes.
Sixteen Node backup cases passed, including red/green regressions for final cleanup failure and
partial history enumeration errors. Native targeted checks covered twenty-seven backup cases,
with the cross-reader case run separately, plus history integration and strict Clippy/formatting.
UI regressions cover already-admitted image imports before the final save barrier, held/retriable
saves, workspace epoch binding and bounded lost command replies. Counts from overlapping runs
are not combined into a unique total. No cloud analyzer or coverage percentage is claimed.

Temporary content-free drag instrumentation was removed before publication. A native automated
row gesture reported button bits of zero, one dragstart and no page dragover/drop or dragend;
it did not establish a human-use defect or qualify native All Notes dragging. No blind drag
rewrite was included. Normal row behavior is unchanged. Force-kill, power loss, hostile same-user
filesystem races and Windows/Linux runtime remain unqualified. Backup and restore are bounded,
verified local copies, not a filesystem snapshot or a synchronization service. No dependency,
telemetry, scheduled backup, cloud storage or remote data feature was added. New copy uses the
English source locale and existing fallback; complete translated catalogs are not claimed.

# Milestone 7 — independent pane editor modes

Validated on macOS on 2026-10-16 for version 0.6.1, with disposable synthetic workspaces.
No real notes were read or used for testing.

The split workspace now owns a separate rich-text/Markdown preference for each stable pane.
Regression tests first reproduced shared-preference coupling and switching despite explicit
preparation refusal. Four additional held-frame regressions reproduced focus being taken back
from another pane or an outside control. The fixes preserve existing single-editor behavior.
The focused run passed 191 tests across 14 files; application and changed-test TypeScript and
changed-file lint passed. The production frontend and isolated native app built successfully.

Six Chromium checks passed against the local development bridge with real BlockNote and
CodeMirror editors and real disposable files. The mode journey covered dirty edits in both
panes, immediate raw exit, active command routing, an unrelated config broadcast, stable editor
ownership, stacking, resizing, visual reordering, close/reopen and restored mode/path pairing.
The existing backup suite now explicitly requires simultaneous rich and raw editors before its
held-save backup, and checks saved bytes, restore collision, tamper refusal and uncertain replies.

Native mouse actions opened and edited two pages, changed only the selected pane's mode, and
returned an immediate raw edit to rich text. The command palette changed the active pane while
the other retained Markdown mode. Mouse stacking, divider dragging, close and reopen retained
both choices. Normal Command-Q and relaunch restored the two pages, mixed modes, vertical layout
and resized divider. Both saved Markdown files matched their pre-quit SHA-256 and byte counts.

Readiness tests cover legacy and invalid snapshots, missing/invalid/blocked preference storage,
provider-free fallback, and unloaded pages. Transition tests cover stale page/vault completions,
refusal and errors, raw buffer forwarding, emergency recovery, and delayed focus restoration.
These are bounded regression checks, not exhaustive native IME, crash, power-loss, or other-OS
qualification. Native All Notes dragging retains its previously documented automation limit;
this increment makes no new claim about that gesture. No dependency or network feature was added.

# Milestone 8 — optional local templates

Validated on macOS on 2026-10-16 for version 0.7.0, using only disposable synthetic workspaces.
The feature adds no dependencies, remote resources, telemetry, account setup or template service.

The domain and page-write seam passed 155 targeted tests across ten files. UI checks passed
28 tests at the first freeze and 16 related tests after the separate keyboard-navigation guard
was corrected. Review regressions first reproduced unstable native default ordering, reuse of
a previous new-template identity, and navigation behind an open draft. The corrected code
canonicalizes defaults, creates each new template exclusively, and guards both keyboard paths.
Application and changed-code types and lint passed. The local disk adapter suite passed 48 tests.

Eight Chrome acceptance cases passed against real disposable files, with one worker and zero
retries. They cover exact selection of duplicate names, passive preview, changed-source review,
creation in the requesting mixed-mode pane, unchanged ordinary blank capture, typing during an
older save, successive new templates, filename collisions, lost create replies, and draft retention
after a failed exact source read. The test fixture routes create/read operations through the
production disk adapter. An additional 480×400 browser check confirms Name, Starting text, Back,
Save and Create remain visible and usable at the configured minimum window dimensions.

Native mouse and keyboard actions created a page from a template with three inherited defaults
without a false source-change loop. Its exact bytes matched the expected generated page and the
source stayed unchanged. An unsaved new-template draft refused Command-Q and remained intact.
Mouse Save and Command-S created two distinct templates in one chooser session. Creating in a
Markdown pane preserved that mode and left the other rich-text pane unchanged. Existing template
identity stayed read-only; an explicit text edit/save affected subsequent pages only. Fourteen
synthetic file hashes and the exact file set survived normal quit and relaunch unchanged.
The restarted app restored both pages and their distinct editor modes; all three templates and
their latest previews remained available.

Native missing-read classification passed four new regressions within the 101-passing-test
LeadingLight filter (five existing ignored tests); the broader vault command filter passed 65
with no ignored tests. Only a proven absent leaf under a valid in-vault directory permits an
explicit create-only retry. Missing parents, permission errors, dangling links and outside paths
do not count as absence. Exclusive creation still refuses a file appearing after that check.

These are bounded checks, not native fault-injection, power-loss, forced-kill, IME or other-OS
qualification. Compact native window resizing remains unqualified by automation; the browser
minimum-size result is separate. The full locale validator reports 461 missing keys per non-English
catalog, including 69 new English keys, under the fork's English fallback policy. Complete
translations, whole-upstream coverage and notarized distribution are not claimed.

# Milestone 9 — contextual page links

Validated on macOS on 2026-10-16 for version 0.8.0, with disposable synthetic workspaces.
The rich `[[` menu offers the other visible loaded page before actual recent visits. Source,
missing, binary and other-vault paths receive no promotion. Typed-query relevance, `@`, explicit
unresolved creation, the 20-result limit and canonical link serialization retain their contracts.
Duplicate titles show vault-relative folders, or filenames when their folders also match.

## Automated and source checks

- 170 targeted tests passed across 14 files: preference eligibility/order/limit, stable editor
  mount and focus, optional folder labels, once-only activation, canonical paths, existing
  creation, tables, rich paste and link activation. App TypeScript and touched-file lint passed.
- Five Chrome browser cases passed with one worker and zero retries. They cover a visible peer
  outranking a newer actual visit, mouse and Enter insertion into the originating pane, closing
  the other pane, exact duplicate-folder choice and navigation, Escape/Search and continued
  typing, checklist/table rich–raw–rich/reopen, and structured Markdown/selected-label URL paste.
- The two new-feature browser assertions failed on the prior behavior; the three neighboring
  writing flows already passed. The final combined run passed all five. Browser tests observed
  no requests outside localhost during these flows.
- A bounded independent source review found no concrete blocker. Preferences are synchronous
  metadata; the changes add no editor remount, focus request, native command, storage,
  dependency or remote service. Canonical targets and guarded insertion callbacks are unchanged.

## Native acceptance

The isolated packaged Mac app passed real-pointer selection and Enter selection with continued
writing in the original pane. Disk checks confirmed exactly one inserted target for each action.
The menu distinguished `work/shared` and `home/shared` pages titled Plan; the selected work link
survived raw/rich switching and Command-click opened its exact destination. Both destination
files remained byte-identical to their originals.

Escape, switching panes, Search while the menu was open, and closing the other pane retained
correct typing ownership and preference ordering. Checklist and table link insertion, checking
an item, editing a neighboring cell, mode switching and reopening preserved their contents.
Native paste produced a heading and checklist, and a URL pasted over selected text preserved
its label. No external link was followed; this native observation is not a network-traffic audit.
Exactly four seeded pages changed intentionally; all other seeded files and attachments stayed
unchanged. The complete set of 32 files, including generated local history, was byte-identical
across a normal quit and restart.

The restarted app restored the left page in Markdown and the right page in rich text, both
saved. Returning the left page to rich text displayed the checked item, intact table, pasted
task and label link without changing the right page.

## Limits

An AX-only automated button action did not insert a suggestion; a real pointer action and Enter
passed. This does not qualify VoiceOver or every accessibility activation route. No new claim
is made for native IME, native All Notes dragging, power loss, forced termination or other
operating systems. Raw autocomplete does not gain contextual ordering in this increment.
No new UI copy or dependency versions changed; the existing English fallback and documented
compatibility exceptions remain. Whole-repository upstream coverage was not measured.

# M10 optional filing — 0.9.0

## Behavior and automated evidence

The page overflow menu offers **Move to folder…** through the existing searchable picker.
Both panes are saved before a move, and committed source/incoming text reopens in the original
panes and modes. Occupied destinations are refused. An unknown reply closes stale editors
instead of recreating the original path or automatically repeating the move.

Two native regressions first reproduced broken outgoing relative images and incoming ordinary
Markdown links. The corrected native suite passed 129 LeadingLight tests with five pre-existing
helper/timing exclusions. The rename filter passed 51 tests; the separately run six command
tests overlap that set. A later reserved-character image regression failed, was corrected,
and the final pure relocation module passed all 22 tests. Source spans preserve Markdown
formatting, reference definitions, fragments, code and frontmatter; portable attachment forms
retain their renderer semantics. Unsupported or ambiguous source references fail closed.

The UI's initial focused run passed 159 tests across ten files. Independent review found a
same-dialog retry problem after a proven refusal; an actual browser regression reproduced it.
The correction passed ten focused adapter/UI tests, including real held-save-queue behavior,
stale navigation, failed reopen and same-dialog retry. TypeScript and changed-file lint passed.
Four final Chrome cases passed with one worker and no retries: mixed-pane latest text and exact
receipt reopen, keyboard collision refusal and continued writing, a lost committed reply, and
another destination in the same picker after refusal. Browser receipts are controlled fixtures;
these cases prove editor lifecycle, not native filesystem transformation. No non-local browser
requests were observed in the successful mixed-pane case.

The full release gate exposed an obsolete App integration fixture and a missing standalone
rename-admission check. Filing now checks that hold before taking its own holds. The updated
App regression stages accepted words before the input pause, supplies an exact native receipt,
and proves that close waits, later moves refuse, and continued writing uses only the new path.
All 87 focused App/save-mutation/relocation tests passed after the correction.

## Isolated native evidence

The packaged Mac candidate moved a rich page while its incoming page stayed in Markdown in
the other pane. New words in both panes and subsequent edits persisted. Source-relative and
vault-root images remained visible; ordinary and wiki incoming links updated and Command-click
opened the canonical moved page. An occupied destination retained its exact sentinel content.
A page originally in a folder containing `#` moved with its nearby image still visible.

Disk checks confirmed the two intended source moves and the edited incoming page. The other
12 seeded files, including attachments, were byte-identical to their baselines. All 28 files,
including generated local history, were unchanged across a normal quit and restart into the
corrected 0.9.0 artifact. It restored the rich left pane and Markdown right pane with their text.
That artifact also passed a collision followed by another destination in the same open picker,
updated both incoming targets again, and saved continued typing. Final disk checks retained
all five writing markers and all 12 unrelated baseline files.

## Limits

Filing does not preserve an editor's prior undo stack or exact caret bookmark. Partial incoming
failures are reported, and unconfirmed pages stay closed until a fresh open. This is not a
transaction against arbitrary external editors or a power-loss guarantee. Native IME, forced
termination, other operating systems and general native row dragging are not qualified here.
The disk browser preview deliberately refuses filing; its memory preview only supports plain
pages and wikilinks. HTML destinations and ambiguous reference forms may require simplifying
the page before moving it. English source copy uses the existing fallback. Existing dependency
compatibility exceptions remain; whole-upstream coverage was not measured.
