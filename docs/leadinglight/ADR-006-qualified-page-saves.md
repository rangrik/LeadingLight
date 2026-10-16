# ADR 006: qualified page saves and explicit draft recovery

Status: accepted. Release qualification is recorded separately in VERIFICATION.md.

## Context

Markdown remains the source of truth. An ordinary write must not truncate the last saved page
before the replacement is ready. A lost command reply also cannot be treated as proof that
nothing was written: blindly retrying could overwrite a later change. Recovery must preserve
newer editor input and remain usable when the original page is missing or unsafe to read.

This decision extends the existing per-page save coordinator and the shared filesystem primitives.
It does not add a second editor queue, cloud service, background synchronization or automatic
version history.

## Decision

The native `leadinglight_history` module owns qualified ordinary saves, an in-process outcome
registry and local draft copies. `save_page_content` binds an immutable request envelope to its
vault, page, session, sequence and submitted SHA-256. Reusing an identifier with different
arguments is refused. `check_save_outcome` queries the original operation; it never replays it.
An unseen query binds and voids its identifier so a delayed original request cannot publish later.

A save reads the original identity and exact bytes, stages and syncs the new bytes beside the
page, then checks the original again before publication through `atomic_replace`. A failed
publication is reported as unchanged only when the same original identity and exact bytes are
proved. Otherwise the operation remains uncertain and its recovery artifacts are retained.
A published write whose directory sync fails remains committed and is never replayed.

The registry excludes overlapping saves and internal mutations. Note and attachment link rewrites
acquire a lease on each linked page before the authoritative read and retain it through writing; a busy or held page is
reported as a failed update. Save holds and structural-operation holds are separate states.
Other pages remain usable.

The existing frontend save coordinator stays the owner of pending text and persistence receipts.
Its recovery state distinguishes a known prepublication refusal from an unknown or held outcome.
A current draft refused because its filesystem path is unsafe remains recoverable. Responses
must match the receiving session and current operation, independently of structural DTO parsing.
A confirmed older save can settle only that submitted snapshot, never newer typing.

## Copies and final choices

Saving a draft as a new page does not clear the original draft or its recovery state. Copy intents
live under the vault's hidden `.leadinglight/history` directory. An intent binds the operation,
source request, chosen draft sequence and hash, destination and staged file identity. Intent and
directory persistence precede no-clobber publication. An uncertain retry may recover only its own
file; a matching name or equal bytes alone do not establish ownership.

Keeping a copy requires fresh proof of the owned single file, its current bytes and the exact copied
draft sequence. The copy is leased through recording the resolution. This proof is repeated on an
exact retry after a lost reply. Discard is explicit and requires no read of the original page.
A later query, copy retry or proof revalidates the current filesystem boundary before content access.

Final resolution has two phases. Native proof records the bound action while the frontend retains
pending text and its receipts. A separate synchronous application checks the session, request,
sequence and exact content, resets or closes the owning editor buffers, and only then settles the
receipt and clears recovery. A failed or stale reset retains a usable recovery state. The UI must
briefly block new input to the affected page, join already-admitted imports and saves, and flush
before capturing the final snapshot. An unresolved busy guard produces a retryable result instead
of an unbounded waiting loop.

## Integration and storage

The wire types are a leaf module under `src/leadinglight`; recovery UI belongs there too. Native
transactions remain additive under `leadinglight_history`. The existing save hook is the deliberate
integration point for pending text, mutations, receipts and lifecycle drains; duplicating those
owners would weaken their ordering. Existing command handlers receive narrow lease guards.
The legacy command remains compatible for callers outside the ordinary editor path.

The native SHA-256 implementation uses `sha2`. Hashes bind requests and verify content; they do
not replace file identity, exact-byte comparisons or filesystem boundary checks. Existing AGPL
licensing, upstream history and attribution remain intact.

Inherited bulk repair and migration commands are unavailable in LeadingLight, and Repair Vault
is absent from its command palette. Git discard, conflict resolution and rebase continuation
commands are also denied before native dispatch. These paths could rewrite pages outside live
draft ownership. Their upstream implementations are retained; read-only history commands and the qualified
local save, creation and Trash paths remain available.

The store and sibling `.leadinglight-*` staging directories are excluded from note discovery and
watcher interpretation. Recovery metadata and payloads remain on the local device. No account,
network service, telemetry or automatic Git synchronization is involved.

## Limits

The last check and filesystem replacement are separate operations, not a compare-and-swap.
An outside writer can still race in that interval. Changes made before the initial read are not
a general external-edit conflict detector. Other property writers retain their existing publication
mechanisms even though leases serialize their interaction with this coordinator.

The outcome registry is process-local. It is not a crash-persistent draft journal, and retained
staging is not automatic version history. Disk syncs are conservative durability evidence, not a
power-loss guarantee. Ordinary save, copy, browser bridge, native UI and lifecycle acceptance must
be qualified separately; passing browser mocks does not establish native filesystem guarantees.
