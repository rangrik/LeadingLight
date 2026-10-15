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

The upstream tab controller exposes one additional opt-in `openEntryWhenLoaded` operation.
It saves the previous page and loads the requested page before committing a tab change;
ordinary upstream selection APIs retain their behavior. Split placement checks request
ownership, the current vault, layout and source existence before committing. Busy counts
and reservation ownership prevent an older canceled operation from unlocking a newer save
or permitting a second editor for the same note.

LeadingLight has a fresh bundle/config namespace and a separate default local vault. It never
migrates or opens an inherited Tolaria/Laputa folder implicitly. Native commands reject remote
features before dispatch. Frontend feature gates and CSP provide additional protection. See
[local runtime policy](local-only-runtime.md) for implementation and verification details.

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

Use one `node_modules` and `src-tauri/target`, at most two Cargo jobs, and compact development
profiles. Browser fixtures and native test vaults are synthetic and excluded from Git. Never delete
other projects' caches or touch personal vaults for QA.

## Dependency policy

Use current stable Tauri and current compatible packages. The inherited BlockNote/Tiptap patches
protect editor correctness and must be rebased and tested before that cluster changes versions.
Track held major-version upgrades explicitly in DEPENDENCIES.md. A package being held temporarily
must never be represented as latest. Lockfiles are committed for reproducible builds.
