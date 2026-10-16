# ADR 007: local page history by recorded location

Status: accepted for version 0.5.0, 2026-10-16. Browser acceptance, isolated macOS application QA
and the native/bridge cross-reading check passed. The scope and remaining limits are recorded in
[VERIFICATION.md](VERIFICATION.md).

## Context

Text deleted or replaced inside a page and then saved is otherwise gone. Local Trash covers a
removed page file, and [ADR 006](ADR-006-qualified-page-saves.md) keeps an unsaved draft
recoverable, but neither keeps earlier saved text. Version history must stay on the device, must
never change whether an ordinary save succeeds, and must not claim identity tracking that the
Markdown files cannot support.

## Decision

The native `leadinglight_history` module keeps selected earlier versions of a page, filed by the
vault-relative path where they were saved. A version is the exact bytes a save is about to
replace. It is not a record of every edit: the save path keeps one only when a small policy asks
for it, and a capture can be skipped or refused.

A save captures inside the qualified ordinary save, in this order: read the original, stage the
new bytes, capture the original when wanted, recheck the original exactly, publish. Capture runs
behind its own panic and error boundary. Every history failure becomes a `notKept` note on an
otherwise unchanged save result: `tooLarge`, `full`, `lowSpace`, `busy` or `unavailable`. There
is no retry or hold for history, and a captured version is kept even when the later recheck or
publication refuses the save. Only the save that attempted the capture carries its note; a
replayed or checked stored result carries `null`, which asserts nothing.

The policy, in order, keeps a version when there is none at that location yet, when it is the
first overwrite there in this run, when the page changed outside this run's last write, when the
save removes at least 2 KiB or 30% of the page, or when the newest version there is at least a
minute old. Bytes equal to the newest version, or to any version from the last two hours, are not
stored again. Pages larger than 10 MiB and empty pages are never captured.

## Store, accounting and retention

The store is `<vault>/.leadinglight/history/`, hidden from note discovery, the watcher and Git:

- `versions/<loc>/location.json` names the recorded path; `<loc>` is 32 hex characters of the
  path's SHA-256;
- `versions/<loc>/<ms>-<sha16>-<6 hex>/` holds exactly `payload` and `version.json`;
- `tmp/` holds `<32 hex>.tmpv` writes and `del-<loc>-<version>` deletions in progress;
- `version-copy-<operation>.json` records copy intents beside the existing draft-copy intents.

A version is listable only when its folder holds exactly those two regular files, its record
matches the folder's time, hash prefix and payload length, and a valid `location.json` names a
path that hashes to the location key. Listing, preview, copy and accounting share this rule.

Every store mutation runs under one per-vault lock: an in-process claim, then an OS advisory lock
on `.leadinglight/history.lock`. Capture and maintenance try once and never wait; a busy lock
means `notKept(busy)` or a skipped run. Copy waits up to two seconds. Lists and previews take no
lock: entries appear and disappear only by folder rename, and previews verify before showing.

Before admitting anything, a capture runs one bounded, metadata-only inventory of the store under
that lock. The inventory is the reservation. No cache authorizes a capture. The initial limits:

| Limit | Value |
|---|---|
| Version-store bytes per vault | 512 MiB (not a cap on recovery files or the vault) |
| Versions per vault | 1,000 |
| Versions per location | 200 |
| Locations per vault | 2,000 |
| Entries in `tmp/` | 64 |
| Verified version input | 10 MiB, independent of recorded metadata |
| Preview | 256 KiB of the verified bytes |

Admission counts the exact payload, record and any new location record. If they do not fit, the
capture first prunes this location's own older versions, never its newest, and otherwise answers
`notKept(full)`. An unknown folder, a link or an unreadable record makes usage unknown: capture
stops, health names the path, and nothing there is deleted. Unknown regular files are counted
and kept. Malformed recognized versions are counted, never listed, and removable by retention.

Within two hours, a location keeps up to 30 versions, its newest among them. Older versions keep
the newest and the newest big change per hour up to two days, per day up to 30 days and per week
up to 180 days. Older ones are removed, and the newest listable version always stays. Deletion
renames a version into `tmp/`, removes its two known files by name, then removes the folder.
Anything else inside stays counted. Nothing is deleted recursively. Background maintenance runs at
the first history use per run, at most daily, and soon after `full`. It stops when the store
cannot be fully counted, and counts again after each step that removed something.

## Recovery surfaces

`list_page_versions` lists one recorded location; `list_saved_locations` lists every location
with its newest time and whether a page exists there now. Both page 100 rows. A rename leaves
earlier versions under the old path, reachable through All saved locations, and the page's next
save starts a new history at its new path. A reused path shows its earlier occupant's versions.
Rows say where and when text was saved, never that it belongs to the same page.

`read_page_version` verifies the complete payload's length and SHA-256 against the row before
returning any text. A gone version is `missing`; a mismatch, unreadable record or unlistable
folder is `damaged`. Valid UTF-8 is shown up to 256 KiB, cut between characters, BOM included;
other bytes return no text. The interface renders that text passively with the existing
Markdown renderer, or shows it unchanged as source.

`save_page_version_as_copy` rereads and verifies the full payload under the lock, then reuses the
draft-copy pipeline: an intent before no-clobber publication, `<name>-2` through `<name>-101`, and
an exact retry after a lost reply. A missing recorded folder answers `folderUnavailable`; there is
no fallback. The original page is never written. `page_history_health` takes a fresh bounded
inventory now and adds this process's latest capture result. It reports `on`, `notKeeping` with a
reason, or `unknown` when the lock is busy. A warning clears only on an `on` answer to a request
sent after the warning was raised; `null` notes and `unknown` answers never clear it.

## Integration

The command DTOs and interface live under `src/leadinglight/pageHistory/`. Upstream files change
narrowly: one page-menu item, one palette command, a pane status slot and an optional
committed-history callback through the existing save hooks. The callback cannot alter a save's
settlement. Native additions are new `leadinglight_history` files, the capture call in
`page_write.rs`, a non-waiting lock acquisition, a verified-bytes copy source and five registered
commands. The browser development bridge models the same contract on disposable folders; it
has no OS lock or durability claims. Existing AGPL licensing, upstream history and attribution
remain intact. No dependency, account, network service or telemetry is added.

## Limits

History is selective. Edits between captures, skipped or refused captures, oversized pages and
writers outside the editor (until the next editor save) are not recorded. Contention can skip a
capture. Disk syncs are conservative evidence, not a power-loss guarantee. A nearly full volume
can still fail the ordinary save, which then keeps its draft through ADR 006.

Each eligible save pays for one bounded store scan, so save time grows with the stored count.
The 1,000-version cap was chosen after a debug-build measurement; release timing is not yet
measured. One unknown folder or link in the store stops capture until a person removes it.
Rename markers, diff, restore in place and attachment history are not part of this decision.
