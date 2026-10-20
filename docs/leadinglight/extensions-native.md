# Extensions: the native E1 registry

This covers how the desktop app stores, turns on and runs E1 extension packages, and what it does
not do yet. The transport contract is frozen in `src/leadinglight/extensions/extensionApi.ts` and
`src/leadinglight/proposals/proposalContract.ts`; the package format is in
[extensions-catalog.md](extensions-catalog.md). The code is in `src-tauri/src/leadinglight_extensions/`,
with the commands in `src-tauri/src/commands/extensions.rs`.

## What E1 does

- **Validates packages** with the same rules, codes, paths and order as the TypeScript validator. The
  shared corpus in `src/leadinglight/extensions/fixtures/cases.json` is checked on both sides.
- **Stores versions.** Importing stores the exact bytes under their SHA-256. It never turns anything on.
- **Turns versions on per vault.** Activation is compare-and-set on the version active in that vault.
  Rolling back means activating an older stored version; it restores behaviour, never note content.
  The version is checked again under the lock that publishes the activation. If an import dropped it
  meanwhile, the activation answers `unknownVersion`, so an activation never names a version that is
  not stored.
- **Runs commands** in sessions owned by one window.
- **Creates one new page per run**, in a folder the person chose, and never over an existing file.

Not in E1:

- adding to an existing page: `bind_extension_document` always answers `unsupported`, and append
  proposals are refused `unsupported`;
- capturing a selection;
- resolving associations.

A package that needs any of these imports as a candidate with `missingCapabilities` and cannot be
turned on.

The bundled Meeting debrief (`leadinglight.meeting-debrief`) ships with the app and is off in every
vault until turned on. Imports cannot use the `leadinglight.` prefix.

## Commands

The 13 commands are named as in `EXTENSION_COMMANDS` and `PROPOSAL_COMMANDS`, and take the frozen
argument objects in camelCase. `submit_document_proposal` takes `{ proposal }`. The proposal is read
strictly: an unknown or missing field is an argument error, not a receipt.

Expected outcomes are always data: refusals, conflicts and `uncertain`. A command fails only when its
arguments cannot be read or the local store cannot be located.

Some reasons in the frozen unions are never sent by E1:

| Reason | Why E1 never sends it |
|---|---|
| `notDocument` | E1 binds no documents. |
| `changed` conflict | Only appends check an expected document. |
| proposal `link` | A bound folder that became a link no longer matches its handle, so E1 answers `handleMismatch`. |

## Where things are kept

Everything is under `extensions/`, beside the app's settings in the local configuration folder.

| What | Where |
|---|---|
| Package bytes | `extensions/packages/<sha256>.json`, immutable, never note text. |
| Active and previous version per vault | `extensions/preferences.json`, keyed by the vault's resolved path. |

Because preferences are keyed by the resolved path, a vault that moves has its extensions off until
they are turned on again.

**These files are not part of the vault and not in the current backup.** Losing them loses imported
versions and activation, never notes.

Every use re-reads the package bytes, checks their hash and validates them again. A missing, changed
or invalid package is listed `readable: false` and is never turned on or admitted. Its recorded
activation stays as recorded and admits nothing.

### Publishing changes

Each preferences change is written to a synced temporary file, then put in place by one rename:

- If the rename fails, the file is unchanged and the change is refused. Imports answer
  `storageUnavailable`. Activation and deactivation answer `vaultUnavailable`, because the frozen
  unions have no storage reason there.
- Once the rename succeeds, the change is made: the app follows it, revokes runs, and answers it.

The folder is synced afterwards. If that sync fails, the app keeps the change and logs a local
warning. The frozen replies promise the current state, not survival of power loss.

### Reading preferences

The preferences file is read only if it is a plain file of at most 4 MiB. It must also keep every rule
the app writes by:

- format 1, with no unknown fields;
- at most 64 stored versions, at most 8 per package and at most 64 vaults;
- package ids, versions and names as the validator accepts them, and well-formed hashes;
- no reserved id among imports, and no hash or sequence number twice;
- every active or previous entry names a version that is stored or bundled, and an entry's active and
  previous versions differ;
- vault keys of at most 4096 bytes;
- sequence numbers below 2^53 and ahead of every recorded one.

Anything else is set aside as `preferences.unreadable.json`, and every extension starts off. Stored
versions are found again from their files:

- at most 256 folder entries are read;
- in name order, up to 64 versions and 8 per package;
- reserved ids are skipped.

Nothing is turned on by this.

When the app ships a changed bundled package, an activation of the old bundled version is dropped. That
package is off in that vault until turned on again.

Sequence numbers are checked. A change that would need one past the bound is refused.

### Bounds on package files

Before a new package file is written, the app looks at up to 256 entries of the package folder:

- It removes package files that no stored version names.
- At most 64 package files may then remain, or the import is refused `storageUnavailable`. A file that
  could not be removed counts towards that limit.
- A folder with more entries than one pass reads also refuses new files.

So failed cleanups stop new files instead of piling up: at most 65 package files are ever on disk.

When an import's preferences change was not published, the package file that import added is removed
again. A file that existed before is never removed for this, and neither is any file after a published
change.

Versions active or previous in any vault are never dropped. An import that would have to drop one is
refused.

## Sessions, runs and writes

| Limit | Value | When reached |
|---|---|---|
| Sessions per window | 8 | Opening another closes that window's oldest. |
| Request keys per session | 256 | New admissions answer `busy`. |
| Live runs per session | 16 | New admissions answer `busy`; admissions still checking their package count. |
| Folder handles per run | 8 | Binding another forgets the oldest. |
| Operation ids per process | 1024 | Never dropped; new operations answer `busy`. |
| Recently closed sessions remembered | 256 | — |

**Window ownership.** A session belongs to the window that opened it, by window label, and to one
resolved vault. Every later call must come from that window. Other windows learn nothing and wait for
nothing.

**Window lifetime.** A window that starts loading a page, or is destroyed, has all its sessions closed
at once. This never waits, so it never blocks the event loop.

**Session protocol.** This follows `extensionApi.ts`:

- `end_extension_run` tombstones the request-time key, so a late admission of that key is refused
  `cancelled`.
- If an end names an unseen key when the session's key table is full, the session is sealed and admits
  nothing new.
- Ending, closing, deactivating and rolling back all revoke runs, then wait for any admitted write to
  finish before answering.

**Activation changes are serialized.** One process-wide gate covers each change from its
compare-and-set through revoking its runs and joining their writes. An older change can therefore
never revoke a newer version's runs. The preferences lock is not held while joining. Runs and writes
never take the gate, so an admitted write always settles.

**Creating a page:**

1. Check the name, size and digest.
2. Check the folder is still the bound one, by path and identity.
3. Hold one path lease, so ordinary saves of that path answer busy.
4. Stage the page beside its target.
5. Check the folder again.
6. Publish with no-clobber.
7. Sync the folder.
8. Read the page back through one handle, within a bound.

A refusal before publication proves nothing was written. A publication that cannot be proven either
way is `uncertain`, and its staged files are kept. A page changed between publication and read-back is
`uncertain`, never a confirmed write.

**Operation ids.** Each id keeps its owner, request digest and outcome for the life of the process:

- The same request answers its recorded result, waiting while it runs.
- Anything else using that id is refused `operationMismatch`.
- `query_document_proposal` never applies or retries anything.

## Restart and known limits

- **After a restart, queries answer `unknown`.** Sessions and runs from before the restart do not
  exist. `unknown` is never evidence that nothing was written.
- **Read-back is not handle-relative.** Another local process racing the page path between its check
  and its open is caught, not excluded.
- **Folder checks are by path and identity**, not by an open directory handle. A folder replaced
  between the second check and publication is the same kind of race.
- **The registry trusts the local configuration folder.** Preference bounds are for corrupt-file
  robustness, not a boundary against someone who already controls that folder.
