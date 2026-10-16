# Local backup and restore

Available in version 0.6.0. Runtime evidence is in the [verification record](VERIFICATION.md).
The design and its limits are in [ADR 008](ADR-008-local-backup.md).

## Making a backup

Back up workspace… is in the workspace menu and the command palette. The dialog says what will be
copied and what will not, then asks for a folder. Choose a folder outside your workspaces; another
drive is a good place. LeadingLight makes a new folder there named after the workspace and the
time, such as `Notes backup 2026-10-16 09.30`. It never replaces an existing file or folder.

Choose folder… pauses editing straight away, before the folder picker opens; cancelling the picker
resumes it. After a folder is chosen, LeadingLight lets image imports already under way reach their
page, then saves both panes and every waiting change, the same way it does before closing. If a draft still holds words, or a page has changes that cannot be saved, nothing is copied
and the dialog says what to resolve first. Editing stays paused, with a progress message, until the
backup ends.

A backup holds the workspace's pages, attachments, other files and saved views, and the earlier
page versions that pass their check. It does not hold:

- pages in Trash (the dialog says how many);
- Git history;
- caches and temporary files;
- linked folders.

The backup is a plain folder of ordinary files with a `leadinglight-backup.json` list written last.
It is not encrypted, so keep it somewhere you trust.

## What the result tells you

LeadingLight checks every copied file against what it read. The result says how many files were
copied and checked, and their size. It also lists:

- **Not copied.** Anything that couldn't be copied, such as a link to another place, a file that
  couldn't be read, or one that kept changing, with a few examples. The result is then "Backup saved
  with gaps".
- **Earlier versions.** How many earlier page versions were not included.
- **Trash.** How many items in Trash were not included.

A backup is copied one file at a time, not frozen at one instant. Editing in LeadingLight is paused,
but another app can still change files. A file that keeps changing is listed as not copied, and
files created after the backup started may be missing. If the system could not confirm the copy was
fully written to disk, the result says so; check the folder before relying on it.

## Restoring

Restore from a backup… asks for a backup folder and checks every file in it first. The dialog then
shows the workspace name, when it was backed up, its size, and whether it had gaps. You choose a
name for the new workspace folder and where to put it. Restore always makes a new folder; if one
with that name exists, it asks for another name. Nothing is overwritten, and the open workspace is
not changed.

When the restore finishes, Open it now switches to the new workspace. Your current pages are saved
first, as with any switch. If the switch can't happen yet, the restored folder stays in the
workspace list and the dialog keeps showing where it is.

## Cancelling and uncertain endings

Cancel stops the work and removes what it made. If cancelling arrives after the work finished, the
finished result is shown. When something could not be removed, the result names the location where
files may remain; don't rely on them as a backup or a workspace.

If LeadingLight stops hearing from the operation, it says it lost track rather than guessing. It
names the folder and, after a backup, lets you edit again. It never starts the same backup or restore again by
itself. Try again always begins a new attempt. A finished backup is a folder that contains
`leadinglight-backup.json`.

Quitting during a backup or restore is not blocked. An interrupted backup leaves a folder that
LeadingLight will not accept as a backup. An interrupted restore leaves an incomplete folder.
LeadingLight doesn't delete these for you.

## Privacy

Everything stays on this device. There is no account, upload, schedule or network service, and no
backup runs unless you ask for one.

## Platforms

Backup and restore are built for macOS and Linux desktops. On other systems, and in the browser
preview, the dialog says they aren't available. macOS runtime checks passed; Linux runtime
has not been qualified.

## Integration boundaries

- **Interface.** `src/leadinglight/backup/` owns the dialogs, the reply parsing and the operation
  follower. Upstream code changes at narrow seams:
  - two workspace-menu items;
  - two palette commands;
  - the save and input guard in `App.tsx`;
  - an awaited workspace open.
- **Native.** The work lives in `src-tauri/src/leadinglight_backup/` behind five commands. It reads
  earlier versions through history's own checks, without changing the history store.
- **Development bridge.** The browser development bridge implements the same contract on disposable
  folders for development tests. The desktop app does not use it.
