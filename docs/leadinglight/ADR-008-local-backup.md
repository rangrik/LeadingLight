# ADR 008: manual local backup and restore to a new folder

Status: accepted for implementation, 2026-10-16. Qualification pending: application runtime QA,
release and publication have not happened. This records the implemented design and its limits,
not a released feature. Evidence will be added to the [verification record](VERIFICATION.md) when
qualification completes. User-facing behavior is described in [local backup](local-backup.md).

## Context

A workspace is one folder on one disk. Copying it by hand can catch a page halfway through a save,
Git internals, caches, and Trash records that only make sense on the disk where they were made.
People need a plain way to keep a checked copy elsewhere and get it back. It must need no
account, sync service or new dependency, and it must never overwrite the workspace or an existing
folder.

## Decision

Backup and restore are manual and local. Back up workspace… and Restore from a backup… appear in
the workspace menu and the command palette. There is no schedule, background job, cloud target,
archive format or encryption. No dependency is added.

A backup is a plain folder named `<Workspace> backup YYYY-MM-DD HH.MM`, or the same name with
` 2` up to ` 99`. It is created inside a folder the user picks, which must be outside every
registered workspace. It holds a `workspace/` tree and `leadinglight-backup.json`. The manifest
is written last and published without replacing anything. Its presence is the only sign that a
backup finished.

A restore never writes into an existing folder or workspace. It first inspects the backup. It then
creates one new folder with the chosen name in the chosen place, copies and checks every file,
and finishes only when all of them match. It opens the result only when the user chooses Open it
now.

The native `leadinglight_backup` module runs the work behind five commands: start a backup, start
an inspection, start a restore, read an operation's state, and cancel. One operation runs at a time
per process. The interface polls its state every 250 ms. Finished results are kept for the 16 most
recent operations, in this process only.

## What a backup holds

| Included | Not included |
|---|---|
| pages, attachments and other regular files in the workspace | Trash (counted and reported, never read) |
| hidden user folders such as saved views | `.git` folders |
| earlier page versions that history verifies at copy time | caches, `.DS_Store`, locks, temporary files and copy intents |
| | staging and marker names beginning `.leadinglight-` |
| | links and special files (reported as gaps, never followed) |

Trash is excluded because its records refer to file identities on the original disk; copied
elsewhere they could misjudge what was moved. Valid Trash items are counted by folder name only,
up to 10,000, and every intro and result says Trash is not included. A count at the cap is shown
as "10,000 or more". Portable Trash is not part of this decision.

## A checked copy over several moments

A backup is not a snapshot of one instant. Each file is read on its own:

1. check it is a regular file and its folders are unchanged;
2. open it without following links;
3. copy it while hashing;
4. check that the file and its folders did not change meanwhile.

A file that keeps changing is tried three times and then becomes a `changing` gap. Unreadable,
vanished, link, special and unstorable names are gaps too, and any gap makes the backup
`incomplete`. Files created after the initial count are not copied and are not reported. After
copying, every written file is read back and its hash compared before the manifest is published.

Earlier page versions use history's existing rules and lock domain, read-only. Versions are listed
by history's own rule. Each one is copied only after history verifies its record and bytes, under
a read-only acquisition of the existing history lock. That acquisition never creates or repairs
the store, its lock file or its ignore file. When the lock file does not exist yet, it takes only
this process's claim. That claim does not exclude another process that creates the lock later.
Every version-shaped entry that is not copied counts in `versionsSkipped`, which the result shows.
That covers entries history does not list and listed versions that fail verification.
A history folder that exists but cannot be read is an `unreadable` gap, never an empty history.

## Preparing the workspace

Clicking Choose folder… starts preparation before the folder picker opens. In one synchronous
step, the interface binds the current workspace and a session number, and holds the existing close
barrier's admissions:

- draft capture (a draft with words refuses at once);
- page renames and moves, Trash, Favorite and other page changes;
- folder moves.

It also makes the app shell and both panes inert. It suspends keys, shortcuts and native menu
commands, so only the dialog takes input. Cancelling the picker releases all of this.

Then it waits for image imports that were already accepted to land in their page. It then runs the
same flush that close uses, which saves both panes and every queued page.

The backup is refused before anything is copied in any of these cases:

- that flush fails;
- any page still has a held or retriable save;
- the window starts closing or switching;
- the workspace changed at all, including switching away and back.

Close, quit and workspace switching keep their own behavior; this path does not replace them.

## Restore

Inspection reads the manifest, up to 64 MiB, and validates it strictly:

- unknown fields and bad formats are refused;
- counts, sums and status must agree;
- every path must pass the shared path rule;
- duplicates and file/ancestor conflicts are refused;
- excluded artifacts are refused even when listed.

Inspection then re-reads and hashes every listed file. Files under `workspace/` that the manifest
does not list are counted and never restored. A folder without a manifest is "not a backup".

Restore does not trust the inspection. It reads the manifest again, which must have the inspected
hash, validates it again, and hashes every byte as it copies. Any difference means "the backup
changed", and nothing is presented as restored.

The new folder gets a hidden `.leadinglight-restore-unfinished` marker first. Removing the marker
is the completion point. Modified times are kept where the disk allows it. Restored earlier versions
are ordinary files; the new workspace's own history lists the ones that pass its rules.

Open it now adds the folder to the workspace list, then waits for the ordinary guarded workspace
switch. If that switch is refused, for example by unsaved work, the result and its path stay on
screen and the folder stays in the list.

## Answers, cancel and uncertainty

- **Cancel.** It is checked between files and every 1 MiB, including during the read-back check. A
  cancel accepted before completion removes what the operation made. A cancel that arrives after
  completion changes nothing, and the completed result is shown.
- **Cleanup.** It removes only files and folders whose recorded identity still matches, deepest
  first and never recursively. If anything remains (a stranger's file, a changed folder or an
  error), the result reports only a location where files may remain. It does not claim those files
  are marked or still ours.
- **Lost replies.** The interface never sends a start twice:
  - a start reply that fails or takes over 30 seconds is followed only by status checks for the
    same operation;
  - a status reply that fails or takes over 5 seconds counts as missed;
  - an `unknown` status, or eight missed replies in a row, ends in a "lost track" message that
    names the destination and, for a backup, lets go of the workspace;
  - late answers are ignored;
  - a copy that keeps answering "running" has no time limit.
- **Durability.** A durability sync that fails after completion is reported as completed but not
  confirmed written, and is never retried.

## Paths and bounds

Every folder on the way to a file is checked against the identity recorded when first seen, before
and after each open. Leaf files are opened without following links, and output files are created
only where nothing exists. A same-user process that swaps a folder between a check and an open can
still redirect one read or write. This is a stated limit of this increment, not a claim of safety
against an arbitrary local attacker.

| Limit | Value |
|---|---|
| Entries counted before any write, history included | 100,000 |
| Total relative-path bytes | 16 MiB |
| One path | 1,024 bytes, 64 segments |
| Manifest | 64 MiB, when written and when read |
| Gap entries kept in the manifest | 1,000, plus a total |
| Tries for a changing file | 3 |
| Copy and check chunk | 1 MiB |

A workspace over a bound is refused before anything is written.

## Integration

- **Frontend.** The interface lives in `src/leadinglight/backup/`, including the frozen command
  contract `backupContract.ts`, which imports nothing from the desktop app. Upstream files change
  narrowly:
  - two workspace-menu items through a context;
  - two palette commands;
  - the backup guard in `App.tsx`;
  - a guarded-handler wrapper in `useAppCommands`;
  - an awaited `openWorkspace` in `useVaultSwitcher`.
- **Native.** The work is in `src-tauri/src/leadinglight_backup/` with thin commands in
  `commands/backup.rs`. History changes only by gaining a read-only version exporter and lock
  acquisition. Workspace roots come from the existing vault boundary.
- **Platforms.** The native module runs on macOS and on Linux (x86_64 and aarch64). Elsewhere every
  start answers "unavailable". Linux has not been runtime-qualified.
- **Browser bridge.** The browser development bridge implements the same contract on disposable
  disk folders. The in-memory preview answers "unavailable". Qualification includes a test in which
  native and bridge each restore the other's backups.
- **Licensing.** AGPL licensing, upstream history and attribution are unchanged.

## Limits

- **Not a snapshot.** Other applications can change files during a backup. Files that appear after
  the count are missed.
- **Interrupted operations.** Quitting during an operation is not blocked, and close does not wait
  for it. Nothing removes what it leaves automatically:
  - an interrupted backup leaves a folder without a manifest, which inspection reports as not a
    backup;
  - an interrupted restore normally leaves its unfinished marker.
- **Not a power-loss guarantee.** Disk syncs are conservative evidence, not proof against power
  loss or a forced kill.
- **Integrity, not authenticity.** A coherent manifest forged by hand is not detected.
- **Not encrypted.** Backups are ordinary files.
- **What is not kept.** Trash, Git history and caches are not in a backup.
- **Process-local ids.** Operation ids are kept per process. After 16 newer operations or a
  restart, an earlier id is unknown.
