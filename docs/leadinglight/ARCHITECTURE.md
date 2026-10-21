# LeadingLight fork architecture

## Upstream relationship

The repository retains Tolaria's full Git history. `upstream` points to
`https://github.com/refactoringhq/tolaria.git`; `origin` points to
`https://github.com/rangrik/LeadingLight.git`. Never push LeadingLight changes upstream.
AGPL licensing and original attribution remain. Internal Tolaria identifiers are preserved when
changing them would introduce unnecessary coupling; app identity and local data namespaces differ.

Keep product-specific modules under `src/leadinglight/`. Existing source receives small integration
changes. Rust local-only policy and settings normalization have a documented boundary. Avoid whole
file rewrites and broad symbol renames. Public docs carry decisions, not private agent transcripts.

## Storage and trust

Markdown files are canonical. Existing filesystem operations and editor serialization remain the
persistence boundary. Layout preferences reference pages; they never replace the note files.
Two panes must not own independent unsynchronized buffers for the same file. A pending save is
owned by a document, not a single global timer that another page can overwrite.

The split controller and drag adapters live under `src/leadinglight/`. Title drags change
layout while preserving editor ownership. Markdown note rows use one internal pointer
session shared by pane and sidebar destinations. The original path and participating
destinations are captured on press; a movement threshold preserves ordinary clicks. Global
workspace invalidation revokes the entire gesture, and the actual release point admits one
destination before dispatch through existing save/relocation operations. External editor
text/file drops retain their existing routes. The row chip follows the pointer over the list
and sidebar through a body portal; only that chip subscribes to pointer coordinates, so moving
within a drop zone does not repeatedly render the editors. See [ADR 012](ADR-012-note-row-pointer-gestures.md).

Each stable pane also owns its rich-text/Markdown preference. An optional controlled editor
interface reserves the current page and session before content preparation and refuses stale
completion. The existing workspace snapshot persists modes beside paths in visual order;
upstream single-editor callers retain their shared preference. This adds no save queue or note
metadata. See [ADR 009](ADR-009-pane-editor-modes.md).

The upstream tab controller exposes an opt-in `openEntryWhenLoaded` operation.
It saves the previous page and loads the requested page before committing a tab change.
Known-content opens also report whether they committed and accept a completion guard; a
successful commit cancels older reads, while canceled cleanup releases only its own reservation.
Ordinary upstream selection APIs retain their behavior. Split placement checks request
ownership, the current vault, layout and source existence before committing. Busy counts
and reservation ownership prevent an older canceled operation from unlocking a newer save
or permitting a second editor for the same note.

LeadingLight has a fresh bundle/config namespace and a separate default local vault. It never
migrates or opens an inherited Tolaria/Laputa folder implicitly. Native commands reject remote
features before dispatch. Frontend feature gates and CSP provide additional protection. See
[local runtime policy](local-only-runtime.md) for implementation and verification details.

## Finding and resumption

The additive finder combines the inherited title matcher with the existing local full-text
command. It owns request generations so an older response cannot cross a query or vault
boundary. App integrates the sidebar command and successful-visit observer; the shared editor
and Markdown persistence remain authoritative. Recent history is bounded, local, per-vault
metadata containing paths and timestamps, never note bodies. The split controller exposes
`openNoteWhenLoaded` for truthful finder navigation and `readyForVisits` for completed restoration
in the current vault session. A new session is created on every vault transition, including
leaving and returning to the same folder. See [finding and resumption](find-and-resume.md).

Async creation and image drops retain request-time document ownership. They must revalidate
that ownership after disk work before changing an editor or reporting document-specific errors.
Successfully persisted files are retained when later navigation supersedes an operation.
The finder uses `createPage` to distinguish a failed write, a written page that could not open,
and a written page successfully opened. Named pages are written before binding an editor to
their path, so a refused filename collision cannot expose the existing file to template autosave.
Image-drop ownership uses the editor's document-session signal: an untitled page's automatic
rename keeps that session, while replacing the document invalidates it. The split tab adapter
records actual in-place renames with `renamedFrom`; similar headings or overlapping text in
two separate files cannot establish document identity or bypass loading the destination file.

## Capture and resumption

Optional local templates live in `src/leadinglight/templates` and reuse ordinary Type documents.
`useNoteActions` binds a controller to the existing vault, pane reservation and page mutation
coordinator. Exact-path source reads supply a resolved starting text and defaults together;
fresh validation precedes exclusive creation beside that source. The chooser and explicit-save
editor retain dirty revisions and unresolved attempted paths. Their lifecycle guard refuses work
before quit, vault-switch or backup takes prerequisites needed by an active template operation.
The scoped browser bridge follows the same fail-closed read contract. Blank capture remains
unchanged. See [ADR 010](ADR-010-local-templates.md).

Ordinary New page has an explicit plain-creation intent: persist an empty, untyped Markdown
file before opening it and focus the body. Contextual type, folder, sheet and named creation
retain their specific intent. Native parsing, live editing and the development bridge share
title-provenance fixtures. The derived source is carried on entries, never written into notes;
the native cache version changes so older entries are reparsed.

`src/leadinglight/pageLabel.ts` derives a short display label from the last saved body of an
unnamed generated capture. It does not rename files or invent stored titles. Authored titles
win even when they happen to match the filename fallback. Relative-path cues distinguish
duplicate labels, and the finder can resolve a relative path directly. Favorites use the same
awaited exact-page opener and preserve list filters and existing pane ownership. See
[capture and resume](capture-and-resume.md).

Favorite persistence has a separate native transaction, described in
[ADR 004](ADR-004-favorite-transactions.md). The editor's per-page save coordinator owns its
publication and integration with newer drafts. Recovery and malformed-draft holds are visible
states, not permission to replay an old snapshot. Property-write, rename, folder-move and
close integrations must preserve that ownership boundary. The milestone verification record
qualifies the completed implementation and its failure paths before release.

`src/leadinglight/favoriteKeys.ts` contains only the YAML text transforms and their contracts.
The browser bridge and server build import this leaf directly; it must not import desktop hooks,
components or invocation code. `favoriteTransaction.ts` retains the application coordination and
compatible exports. This keeps the shared parsing boundary independent of the desktop UI.

The filesystem watcher excludes both the exact `.leadinglight` store and sibling staging
components beginning with `.leadinglight-`, matching the rename and migration walkers. Temporary
payload events must not look like external page edits; publication is observed at the page path.
Other hidden namespaces, including saved views under `.laputa`, retain their existing behavior.

`vault/staged_file.rs` owns the shared filesystem steps: plain-file checks, a captured file
identity and its bytes, sibling staging, publication and conservative failure classification.
Favorite remains a thin adapter and keeps its identity-only check before publication. The
separate exact recheck also compares bytes and revalidates the path after reading; it supports
the ordinary-save transaction without coupling it to Favorite result types.
After a failed publication, only an exact unchanged original permits the failed result;
otherwise staging is retained as uncertain. A successful publication with a failed directory
sync remains committed. The final check and replacement are separate operations, so this is
not a filesystem compare-and-swap or a power-loss guarantee. Native metadata replacement
continues through the unchanged `atomic_replace` module.

`leadinglight_history` adds the native ordinary-save transaction and its outcome registry.
Requests bind a vault, page, session and exact submitted snapshot. Queries never replay a write;
uncertain results keep recovery available. Internal mutations use overlapping-path leases, and
note and attachment link rewrites lease each linked page before their authoritative read. Draft copies use local intents,
no-clobber publication and current file ownership, sequence and content proof before resolution.
The registered root and stored parents are revalidated before later recovery reads. See
[ADR 006](ADR-006-qualified-page-saves.md) for the contract, frontend settlement boundary and
explicit limits.

Automatic page history extends the same module. The
ordinary save captures the text it replaces between staging and the exact recheck. Every history
failure becomes a `notKept` note on an unchanged save result. Versions are filed by recorded
vault-relative path under `.leadinglight/history/versions/`. One per-vault process and OS lock
serializes capture, retention and copy-source verification, and a bounded inventory under that
lock authorizes each capture; no cache does. Previews and copies verify the complete payload
first, and copies reuse the no-clobber draft-copy pipeline. The interface lives in
`src/leadinglight/pageHistory/` and reaches upstream code through one menu item, one palette
command, a pane status slot and an optional save-hook note. See
[ADR 007](ADR-007-local-page-history.md) and [local page history](local-page-history.md).

Manual renames retain the mounted rich editor through the pane's explicit `renamedFrom` record.
The swap hook verifies that the editor still holds that old path, flushes its pending text through
canonical routing, and advances the reactive content path without replacing the live blocks.
Similar titles or body text do not prove that two pages are the same document. Scoped DOM lookup
returns an empty surface when Tiptap's unmounted view throws; it cannot borrow another pane's
scroll container or focus. These lifecycle boundaries also let a Today focus request finish after
its editor mounts.

`pendingCapture.ts` coordinates one visible `PendingCaptureField` while New page or Today is
opening. Admission happens synchronously, before filesystem work. The request retains its vault
session, pane and destination; navigation cannot redirect its words. Rich and raw editors expose
an exact-page handoff endpoint that checks mounted, editable, non-inert ownership and actual focus.
The rich endpoint uses the mounted ProseMirror view because BlockNote can still report headless
during Tiptap's first initialization task. Raw handoff first resumes its focus guard.

The ordinary save queue returns a receipt only after enqueueing the full document. The receipt
contains canonical path, content, queue session and sequence. Capture checks the exact content,
then retains a delivery target after removing its field. Save, close and vault switch must prove
that target reached a saved or completed-Trash outcome; a successful-looking drain alone is
insufficient. Uncertain insertion keeps a recovery copy without replaying it. Close and vault
switch refuse unresolved words and hold new capture admission through the transition. See
[ADR 005](ADR-005-immediate-capture.md) for guarantees and limitations.

## Daily pages, connections and recovery

Milestone 3 adds three bounded integrations. `useTodayPage` computes a local calendar date on
request and opens `Daily/YYYY-MM-DD.md`. `exactPage` creates that path exclusively before binding
an editor, or reads the existing file after a refused create. An editable title does not determine
the daily page's identity. Requests retain their original vault session and pane reservation.

Inspector connection rows resolve through the same wikilink resolver as editor navigation.
Known source entries open by exact path through the awaited split controller; duplicate titles
cannot redirect a backlink click. The page-header count and Inspector rows share one cached
summary. Relationship suggestions compare canonical keys while preserving the stored key and values.

`useLocalTrash` coordinates page removal with the save queue and split controller. The native
`leadinglight_trash` module owns file transactions, locking and interruption recovery. Trash is
local to each vault and excluded from ordinary page discovery. See
[ADR 003](ADR-003-local-trash.md) for the storage contract, collision handling and guarantee limits.
The browser development bridge uses disposable filesystem fixtures to exercise the same visible
flows; native transaction guarantees are qualified separately with Rust and native-app tests.

Manual backup and restore shipped in 0.6.0; see VERIFICATION.md for qualification and limits.

- **Where it lives.** `src/leadinglight/backup/` and the native `leadinglight_backup` module.
- **Backup.** A backup is a new plain folder whose manifest is published last.
- **Restore.** It validates and rereads a backup into a new, exclusively created folder, and opens
  it only when asked.
- **Preparation.** Before any wait, the interface takes the close barrier's admissions and an input
  guard. It joins image imports already accepted, then runs the unchanged close flush. Unresolved
  saves, drafts with words, or a changed workspace session refuse the backup.
- **History and exclusions.** Earlier versions are exported through history's own verification,
  under a read-only acquisition of its existing lock. Trash, Git and caches are excluded.
- **Operations.** One operation runs per process and is polled. Lost replies are queried and never
  replayed.

See [ADR 008](ADR-008-local-backup.md) and [local backup](local-backup.md).

## Bringing in upstream changes

1. Commit a clean, verified LeadingLight state. Fetch `upstream main --no-tags`.
2. Create a `codex/upstream-YYYY-MM-DD` integration branch from LeadingLight main.
3. Merge `upstream/main` normally; do not rebase published LeadingLight history.
4. Resolve conflicts with this fork's local-only policy, identity and pane contracts intact.
5. Audit new dependencies, startup tasks, network calls, settings and editor lifecycle changes.
6. Run local tests/builds and native synthetic-vault QA, particularly concurrent edits and restart.
7. Integrate only after review. Record the upstream revision and any retained patch exceptions.

## Agent coordination and resource use

The manager owns task assignments, dependencies, Git and the single native build. Each agent has
explicit file ownership and a private report under ignored `workspace_management/`. Shared-contract
changes are communicated before edits. Completed work is reviewed by a different model when
available. Parallel coding uses separate managed worktrees with explicit integration ownership.
They share the primary checkout's dependency installation and native target; builds are serialized
by the manager. Do not use parallel installs or duplicate native caches to increase throughput.
The current owner direction assigns implementation, tests, scripts and configuration to
Opus 5.5 at extra-high effort. Codex manages integration, review and QA with separate ownership.

Use one `node_modules` and `src-tauri/target`, at most two Cargo jobs, and compact development
profiles. Browser fixtures and native test vaults are synthetic and excluded from Git. Never delete
other projects' caches or touch personal vaults for QA. Keep only the installed application and
one verified compressed rollback archive. Remove completed test and build app bundles after
verification so desktop search does not accumulate old application copies.

## Dependency policy

Use current stable Tauri and current compatible packages. The inherited BlockNote/Tiptap patches
protect editor correctness and must be rebased and tested before that cluster changes versions.
Track held major-version upgrades explicitly in DEPENDENCIES.md. A package being held temporarily
must never be represented as latest. Lockfiles are committed for reproducible builds.

## Inspector sizing

The split workspace measures each visible pane. Below 400 pixels of remaining writing width,
Properties floats inside that pane instead of taking space from the editor. The same editor and
Inspector remain mounted while the window or divider changes size. The panel is a labelled,
nonmodal region; Escape closes it when an inner field or menu has not consumed the key, and focus
returns to its opener or page. The other pane remains usable. Wider panes retain an inline panel.

LeadingLight opts into floating-Inspector window constraints through `useAppWindowControls`.
Both the immediate constraint update and the layout effect omit Inspector width from the native
minimum, so opening Properties does not enlarge a narrow window. Sidebar and note-list minimums
still apply; callers that do not opt in retain the inherited constraint calculation.

## Contextual page links

The existing rich `[[` menu receives optional preferred paths from App's vault-scoped recent
visits and the split workspace's other visible, loaded page. `wikilinkContext.ts` filters those
preferences against eligible current-vault entries, excludes the source from promotion and
deduplicates paths. Promotion applies only to empty discovery before the existing result limit;
typed-query ranking and `@` behavior remain unchanged. No editor key or focus request depends
on these preferences.

Duplicate titles receive display-only vault-relative folder labels. If two files share both a
title and folder, their relative filenames distinguish them. Shared list components accept an
optional secondary label; other callers retain their current rendering. Canonical link targets,
aliases, link resolution, save queues and Markdown serialization keep their existing ownership.
There is no new storage, native command, dependency or remote lookup.

## Optional page filing

The page menu and existing folder actions share a dedicated relocation coordinator under
`src/leadinglight/relocation`. It captures the originating vault and page, holds new actions and
input, drains accepted writes, and retires visible editors through existing pane reservations.
Folder moves use exact native before/after receipts to reopen pages in their original panes
and modes. Unconfirmed replies never trigger an automatic replay or an old-path write.

`leadinglight_relocation_links.rs` uses CommonMark source spans to change only destinations.
It preserves source-relative image and ordinary Markdown referents, recognizes the renderer's
portable attachment forms, and refuses unsupported outgoing syntax before source publication.
`vault/rename.rs` retains no-clobber publication and accounts for every requested open page,
with leases and exact rechecks around incoming updates. Other filename/title rename paths
retain their existing behavior. See ADR 011 for the contract and its limits.

The disk browser preview explicitly refuses this operation until equivalent filesystem and
reference guarantees exist. Controlled browser receipts test editor lifecycle separately from
native filesystem acceptance. No vault content leaves the machine.

## Adapt extension authoring

Adapt is a chat that asks a provider for one E1 extension package, one question, or "not possible".
It runs only on an explicit Send. Each Send starts a fresh, bounded provider thread carrying:

- the request;
- the attachments visible in the composer, attached explicitly;
- the earlier turns shown, whose replies may quote earlier context;
- the identity of the package being changed;
- the built-in extension guide.

Nothing else from the vault is sent.

**Every effect goes through E1's trusted path:** validation, the effect-free preview, its single Turn
on, the run form and undo.

- **Revisions** carry the exact base version and the version that was on when the extension was
  attached. Activation is a compare-and-set against that recorded value.
- **Nothing is adopted or edited automatically.**
- **No package code, JavaScript or HTML runs, and nothing patches the app core.**

**Where it lives.**

- **UI.** `src/leadinglight/adapt/`: transport, controller, candidate checks, dialog and adoption
  hooks.
- **Native host.** `src-tauri/src/leadinglight_adapt/`, with 13 fixed commands in
  `src-tauri/src/commands/adapt.rs`.
- **Conversations.** Stored per vault under LeadingLight's local app data, outside the vault and
  outside workspace backups.

**Providers.** Codex is the first provider: a separate local process with a private app `HOME` and
`CODEX_HOME`, and its own sign-in. Claude is unavailable initially, with no paid fallback.

See [ADR 014](ADR-014-adapt-extension-authoring.md), [the provider notes](adapt-provider.md) and
[local runtime policy](local-only-runtime.md).
