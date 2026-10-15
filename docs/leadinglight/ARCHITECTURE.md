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
layout while preserving editor ownership. List drags reuse the upstream note MIME/session
and claim only internal drops over the writing area, before editor and sidebar handlers.
Folder moves and external text/file drops retain their existing routes.

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
available. Do not use parallel installs or duplicate native caches to increase agent throughput.
Opus 5.5 is the sole code implementer, including tests, scripts and configuration. Other models
may coordinate, review and run QA, but route all code changes back to Opus.

Use one `node_modules` and `src-tauri/target`, at most two Cargo jobs, and compact development
profiles. Browser fixtures and native test vaults are synthetic and excluded from Git. Never delete
other projects' caches or touch personal vaults for QA.

## Dependency policy

Use current stable Tauri and current compatible packages. The inherited BlockNote/Tiptap patches
protect editor correctness and must be rebased and tested before that cluster changes versions.
Track held major-version upgrades explicitly in DEPENDENCIES.md. A package being held temporarily
must never be represented as latest. Lockfiles are committed for reproducible builds.
