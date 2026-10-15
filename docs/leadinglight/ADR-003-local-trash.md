# ADR 003 — Local Trash transactions

Status: accepted for milestone 3. Release qualification is recorded separately in VERIFICATION.md.

## Decision

Page deletion moves the saved file into a private store inside its existing vault. The store is
`<vault>/.leadinglight/trash/<item-id>/`: `item.json` holds the original relative path and metadata,
`payload` holds the unchanged file, and `restore.json` records a restore in progress. Each item ID
is 32 lowercase hexadecimal characters. This is recovery storage, not a backup.

A normal page is restored to its original folder. If its filename is occupied, restore chooses the
first available `-2`, `-3`, and subsequent suffix in that same folder. Publication never overwrites
an existing entry. Keeping the folder preserves the meaning of note-relative attachment links.
If the folder cannot be used safely, restore reports the failure and retains the item in Trash.
Attachments are neither moved nor rewritten.

There is no automatic expiry and no permanent erase or empty-Trash action in the initial UI.
Folder deletion is hidden until a reversible folder transaction has been qualified.

## Integration boundary

`src-tauri/src/leadinglight_trash/` owns storage and recovery. Three commands in `commands/delete.rs`
expose the boundary: `move_to_local_trash`, `list_local_trash`, and `restore_from_local_trash`.
All require an explicit registered vault path. Existing permanent-delete commands remain for
upstream compatibility; LeadingLight's page-removal UI routes through the local Trash controller.

Moves and restores return per-item successes and failures, so a partial batch can preserve the
remaining pages. Listing returns metadata rather than page bodies. The frontend must save and
settle each page's pending edits and automatic rename before moving it, then close only the pages
whose move was confirmed. Errors leave the remaining pages editable.

## Serialization and commit points

An OS advisory lock on `.leadinglight/trash.lock` covers the entire transaction and recovery pass.
Different processes and aliases of the same vault share this lock. Process exit releases it.
The implementation uses Rust standard-library file locks, requiring Rust 1.89 or newer.

A move commits when the original file is renamed into the fresh item directory. A restore commits
when its complete file is published at the chosen destination. After publication, a failed cleanup
is reported as a successful restore with `cleanupPending`, never as a failed restore to repeat.
Subsequent listing or restoration retries cleanup and does not publish another copy.

Restore intents record the destination and file identity before publication, then record the
commit. Recovery removes a retained payload only when it can establish that the published file
exists safely inside the vault. Unproven missing data remains visible for diagnosis. A record with
no payload is not silently erased merely because a different page now occupies the original path.

On macOS and Linux, device and inode identity support interruption recovery. On other platforms,
an interruption before the commit marker may retain both copies. Folder synchronization is best
effort: the guarantee covers application interruption, not power loss, OS failure or disk failure.

## Isolation and unusual items

The store is excluded from note scanning, search, rename rewriting and file-watcher activity.
Before moving files, the implementation establishes and verifies a final `*` rule in
`.leadinglight/.gitignore`, preserving previous lines. A symlink, unreadable file or failed update
refuses the move. No Git command or network operation is part of Trash.

An unreadable metadata record with a retained file appears as `needsAttention`. Recovery can place
that file at the vault top level under a distinct recovery name. The UI must explain that its original
folder is unknown and relative links may need repair. A missing payload is shown as `missing` and
cannot be restored. A published file whose leftover Trash copy cannot yet be removed is
`cleanupPending`, with the recorded restored path; it must never be presented as a fresh deletion.

## Tradeoffs and follow-up

This additive module preserves the inherited editor and Markdown format. It deliberately avoids
an external database, dependency, service or cloud recycle bin. Trash does not restore inbound links
when a filename collision requires a new name. Local version history, backups, folder transactions
and import/export are separate work and must not be inferred from the presence of Trash.
