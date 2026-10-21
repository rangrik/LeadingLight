# Commentary, natively: adding to a page, and Undo

This covers what the desktop app does natively when an extension adds to an existing page, and how
a committed write is undone. It extends [extensions-native.md](extensions-native.md), which still
covers the registry, sessions, runs and creating a page. The wire shapes are frozen in
`src/leadinglight/extensions/extensionApi.ts`, `src/leadinglight/proposals/proposalContract.ts` and
`src/leadinglight/proposals/proposalUndoContract.ts`. The code is in
`src-tauri/src/leadinglight_extensions/` (`document.rs` for the page work, `runs.rs` for the
registry), with narrow helpers in `leadinglight_history/` (kept, pinned versions) and
`leadinglight_trash/` (the guarded Trash move).

## What native does and does not judge

Native never reads a passage, never parses commentary metadata, and never decides which note belongs
to which source. The trusted desktop host prepares the whole new page from the captured passage and
the person's answers. Native guarantees only three things:

- the write lands on exactly the page that was bound;
- the page still holds exactly the bytes that were reviewed;
- the result is exactly the reviewed whole page, written once, with the earlier text kept first.

`selection.read` and `association.resolve` are host services of the desktop UI. From 0.13.0 the
desktop host performs them, so native lists all five capabilities as supported. The switch is
`HOST_SERVICES_QUALIFIED` in `manifest.rs`; a build without that host must turn it off, and then a
package that needs them, the bundled commentary included, stays off and lists what is missing.
`document.append` is native and always supported.

## Binding a page

`bind_extension_document { runId, path }` belongs to the calling window, like every other run call.

- `path` is relative to the vault, with `/`, and ends in `.md`. Absolute paths, `..`, and hidden
  segments (starting with `.`) are refused `outsideVault`.
- Every folder on the way must be a real folder, never a link. The page must be one plain file with a
  single link. Links answer `link`; a folder or anything else answers `notDocument`.
- The page must be valid UTF-8 (`notDocument`) and at most 1 MiB (`unsupported`: nothing added to it
  could fit in a proposal).
- The reply carries `contentSha256`, the digest of the bytes read now. That is the handle's baseline,
  and it never changes. A newer page needs a new binding.
- Bind returns no text. The host reads the page itself and must build the new page from bytes with
  that digest.

A run keeps at most 8 document handles; binding another forgets the oldest.

## Adding to a page

`submit_document_proposal` with `kind: 'append'` carries the whole new page and `expectedSha256`, the
handle's baseline. One run makes one write, whether it creates or adds. In order:

1. The operation id, the run, the handle and the baseline are checked. A digest that is not the
   handle's answers `handleMismatch`.
2. Size and digest are checked. A page that would not change answers `digestMismatch`.
3. One Undo slot is reserved in the session. When the session already holds 16 unused Undo tokens, the
   append answers `busy` before anything is read. No offered Undo is ever dropped to make room.
4. The page path is resolved again without links. A page that became a link answers `link`. A folder
   that became a link or another folder answers `handleMismatch`. A missing page is `conflict changed`.
5. One page lease is taken; an ordinary save of the page, a held save or another writer answers `busy`.
   Everything below happens inside this one lease.
6. The page is read through one handle. Bytes other than the baseline are `conflict changed`.
7. **The exact earlier bytes are kept on disk first** (below). If they cannot be kept and verified,
   the append is refused before the page changes: `busy` when page history is busy, otherwise
   `storageUnavailable`.
8. The new page is staged beside the old one, with its permissions.
9. The baseline is checked again exactly, same file and same bytes, right before publication. Any
   change is `conflict changed`.
10. The page is replaced the way an ordinary save replaces it, the folder is synced, and the result is
    read back.

A committed append always carries its Undo token. `durable: false` means it was written but a sync
failed; it is never retried. A publication proven not to have happened answers `storageUnavailable`.
Anything that cannot be proven, including a read-back that does not match, is `uncertain`. Kept
staging files stay for recovery, the earlier text stays in page history, and no Undo is offered.

## Where the earlier text is kept

The earlier text becomes an ordinary page-history version of that page. It is written whatever the
automatic capture policy would say, and an empty page counts too. If an identical version is already
listed for the page, that one is used.

The version is written and synced, read back and checked by length and digest, then **pinned**. All
of this happens under page history's own lock, before the page is replaced.

Before any pin is given out, the version's files, its location's record, its folder, and every
folder above it up to the vault are synced again. This applies whether the version was written now
or was already there. A sync that failed earlier is never taken as done. Examples are a location
synced right after a version was renamed in, or a parent synced right after a folder was created,
which later writes would otherwise skip. While such a sync keeps failing, appends and Undo are
refused before the page changes. Once it succeeds, the same version is used without writing a second
copy. A pinned version is never
removed. Every removal path checks pins under that same lock: pruning during capture, the per-page
tiers and the budget pass of maintenance. Pins are also left out of what pruning plans to free, so
they never cost ordinary versions their room.

Pins live in this process's memory, for as long as the Undo they back. The app runs as one instance,
so no other process prunes the store meanwhile. At most 128 versions are pinned at once; each is at
most 1 MiB. Once unpinned, the version is ordinary page history under ordinary retention, and the
newest version of a page is always kept. So the earlier text stays recoverable from Page history
after Undo is no longer offered. That is the long-lived path.

The kept version is listed with the `checkpoint` reason, so the history wire and older readers are
unchanged. Page history lives in the vault (`.leadinglight/history`), stays out of Git, and is part of
backups like any other version.

## Undo

The commands, in `PROPOSAL_UNDO_COMMANDS`:

| Command | Arguments | Answer |
|---|---|---|
| `undo_document_proposal` | `{ request }`, read strictly | `UndoReceipt` |
| `query_document_undo` | `{ operationId }` | the recorded answer, `running` or `unknown`; never applies anything |
| `release_document_undo` | `{ sessionId, undoReceipt }` | `released` or `unknown`; no page changes |

### Who may undo, and for how long

- An Undo token belongs to the window and session its write was committed in. It does not belong to
  the run or the package. Ending the run, turning the package off and rolling it back all keep it.
  It is core host behaviour.
- The request must name that session, the token, the write's `kind`, and its digests:
  `expectedSha256` is the receipt's `afterSha256`, and `beforeSha256` is the receipt's for an append
  and `null` for a create. Another window or session answers `sessionClosed` or `unknownReceipt`.
- A token is used up by `undone` or `uncertain`; a second press answers `consumed`. A conflict or a
  refusal keeps it usable.
- A token ends, and its version is unpinned, when it is released, when it is used, or when its
  session closes. Closing waits for an Undo in progress, then forgets every token of the session. A
  window that closes or reloads forgets its tokens without waiting; an Undo already running finishes
  first. A restart forgets every token.
- The UI should release a token when its notice is dismissed, when the note changes, or when the pane
  leaves the page.

### Each press is one operation

Every press has a fresh UUID. The same id with the same fields answers its recorded result, waiting
while it runs. The same id with any other field, from another window, or an id a proposal already
used, is refused `operationMismatch`. After a lost reply, query the id. Never press again
automatically. The ledger keeps 1024 Undo operations per process and never drops one; when it is
full, new presses answer `busy`. Releasing a token never erases an answer. The original proposal's
query still answers its committed receipt after the write is undone.

### Undoing an addition

Inside one page lease:

1. The recorded path is resolved again. If nothing is there, the answer is `conflict missing`. A link,
   or anything that is not one plain file, is `conflict changed`.
2. The page must hold exactly the bytes the append wrote. Otherwise it is `conflict changed`, so words
   typed afterwards are never lost.
3. The earlier text is read back from page history under its lock and verified. If it was removed or
   damaged outside the app, the answer is `preimageUnavailable` and the page is untouched.
4. The text being replaced is kept the same way first, so nothing is replaced without a recoverable
   copy.
5. The earlier text is staged, checked again exactly, published, synced and read back:
   `undone { restoredSha256, durable }`.

### Undoing a creation

Inside one page lease, the created page must still hold exactly what was written. Then it goes
through `leadinglight_trash::move_exact_to_trash`:

1. The page is read through one handle and compared again.
2. Its Trash record is written.
3. The same file and the same bytes are checked once more, at the final rename. An edit while the
   record was being prepared stops the move. The record is discarded and the answer is
   `conflict changed`.
4. A rename that fails while the page is proven still in place is `refused storageUnavailable`.
5. Anything after a rename attempt that cannot be proven is `uncertain`, never a no-write refusal.

Trash can restore the page as usual. Ordinary Trash is unchanged.

### What Undo never does

- It never touches the source page of a passage.
- It never follows a moved or renamed note: that answers `conflict missing`. Any other file now at
  that path fails the exact-bytes check.
- It never rebases the earlier text onto newer bytes.

## The bundled commentary recipe

`leadinglight.passage-commentary` ships with the app. It is the shared
`fixtures/passage-commentary.json` with a reserved id, and a test keeps the two equal.

- **It is on by default.** In a vault with no recorded choice, it lists and admits as active, because
  this build supports everything it needs. Nothing is written to make it so.
- **Off is remembered.** Turning it off records the existing `previous` entry. That record is never
  cleared by an app update: when a new app ships changed commentary bytes, the Off moves to the new
  version instead of being dropped. A vault that holds an Off is never forgotten to make room for
  another vault.
- **On again** is an ordinary activation with `expectedActiveSha256: null`.
- The preferences file format is unchanged.
- Meeting debrief stays off by default.

## Known limits

- Rechecks are not a compare-and-swap. A process outside the app that writes between the last exact
  check and the rename is not excluded. It is caught afterwards and reported as `uncertain` or
  `conflict changed`, never as a confirmed write.
- After a restart, Undo is gone and queries answer `unknown`. The earlier text is still in Page
  history.
- External moves of a note, and a byte-identical file reusing its path, cannot be told apart from the
  note. Native does not claim to.
- Native adds to any page a run binds. The app still has no page chooser, though. Its own review
  keeps unavailable any command that asks the person to pick a page (`chosenExistingDocument`, such
  as the observation-log example), so only notes linked to a passage's source are added to in this
  version.
