# Local page history

Available in version 0.5.0. The [verification record](VERIFICATION.md) describes the browser and
isolated macOS checks. The storage contract and its limits are in
[ADR 007](ADR-007-local-page-history.md).

## What is kept

When a save replaces text, LeadingLight may keep the text it replaced as an earlier version. It
keeps one for a page's first save, the first save of a page in each run of the app, a page that
changed outside LeadingLight, a save that removes a large part of the page, and otherwise at most
about once a minute. Text identical to the newest version, or to one from the last two hours, is
not stored again. This is a set of useful checkpoints, not a record of every keystroke, and the
interface never says otherwise.

Versions stay on this device, inside the vault's hidden `.leadinglight/history` folder. There is
no account, sync, network service or setup step. Pages larger than 10 MiB are not kept.

## Finding earlier text

Earlier versions… appears in each pane's page menu and in the command palette. The menu opens the
history of that pane's page; the palette uses the active pane. The dialog lists this page's
versions by date, reason and size, 100 at a time, with Show older versions for more.

Versions are filed by the path where they were saved. After a rename or move, earlier text stays
under the old name and is found under All saved locations, which lists every recorded path and
whether a page exists there now. The page's next save at its new path starts a new history there.
A path reused by a different page shows the earlier page's versions; rows describe where and when
text was saved, never that it is the same page.

## Looking before keeping

Choosing a version checks its complete stored bytes first. A version that no longer matches its
record is shown as damaged and cannot be copied; one that is gone is shown as no longer kept.
Only then is text shown, up to 256 KiB, with a note when it is cut.

The formatted view is passive: links are plain text, images are labels, and raw HTML is not
rendered, so nothing is fetched or opened and no editor is created. Source shows the exact text,
with notes for a byte order mark or Windows line endings. Text that is not valid UTF-8 cannot be
shown but can still be copied.

## Saving a copy

Save as a copy writes the version's complete original bytes to a new page beside where it was
saved, named `<name>-2.md`, `<name>-3.md` and so on, never over an existing file. The current page
is not changed. If that folder no longer exists, LeadingLight asks for a folder instead of
choosing one, and warns that links inside the copy may not work from a different folder. When a
reply is lost, Check again repeats the same operation, so it cannot create a second copy.

A created copy offers Open copy, which opens it in the pane that asked. Nothing is replaced or
opened automatically, and the other pane keeps its page. Focus moves to the opened copy.

## When history cannot keep up

A history problem never changes a page's save. The page still shows its own saved or unsaved
state. When a version could not be kept, a quiet Versions paused note appears beside that state,
with details in the dialog: the store is full, the disk is nearly full, a page is too large, the
history was busy, or the store cannot be read safely. It is not repeated as a toast.

The note clears only after a fresh health check succeeds; an older save reply cannot clear it.
While it shows, LeadingLight checks again about once a minute, and Check again asks now.
Something unknown inside the history folder stops new versions until a person removes it; the
details name its path, and LeadingLight never deletes it.

## Space and pruning

History uses at most 512 MiB and 1,000 versions per vault, and 200 versions per saved path.
Recent versions are kept densely. Older ones thin out to one per hour, day and week, plus the
latest large deletion in each period; versions older than about six months are removed. The
newest version of each path is always kept. When there is no room, a page's own older versions
make way first. Otherwise the save completes and reports that its version was not kept.

## Integration boundaries

`src/leadinglight/pageHistory/` owns the dialog, preview, saved-locations view, health warning
and command parsing. Upstream components change only at narrow seams:

- the page menu gains one item;
- the command palette gains one command;
- the split workspace gains a per-pane status slot;
- the save hooks pass an optional history note that cannot affect save settlement.

Native storage lives in `src-tauri/src/leadinglight_history/`, behind five commands. The browser
development bridge implements the same contract on synthetic disk fixtures for development and
acceptance tests; it does not model operating-system locks or durability.
