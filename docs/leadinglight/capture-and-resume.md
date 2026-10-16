# Capture and resume

This describes version 0.4. The release verification record determines which paths have been
qualified.

## Begin with the thought

Ordinary New page creates an empty Markdown file and places the caret in its body. There is no
required title, type, folder choice or template. The sidebar, empty pane, pane add action and
New Note keyboard command share this intent. Explicit type, folder, sheet and named-creation
actions keep their more specific behavior.

Typing can begin immediately. While a page opens, a visible draft field holds the words and
hands them to that page's editor once it is ready. If creation fails, the field remains with
Try again, Copy text and Discard draft. Save and ordinary quit refuse to claim success while
those words have not reached a saved page. Retrying keeps the same words and returns the caret
to the editor. This draft initially lives in memory; it is not crash-recovery storage.

Generated filenames use `untitled-page-<timestamp>` with a collision suffix when needed. Typing
ordinary body text does not rename the file. A leading H1 can still trigger the existing optional
automatic rename behavior. Choosing a filename remains possible independently of the page title.

An unnamed generated page is displayed as Untitled until its first successful save. Its display
label then uses the start of its saved body, capped at 80 Unicode code points. This label is derived
and never written as an extra title or used to rename the file. A failed save must not advertise
an unsaved label as persisted content.

## Titles and exact page identity

Native parsing, live editing and the browser development bridge use the same precedence:

1. A leading H1 on the first nonempty body line.
2. A nonblank frontmatter title.
3. The filename fallback.

Entries carry derived title provenance so an authored title equal to the filename fallback is
still treated as authored. A shared fixture contract covers these distinctions. Existing cached
entries are reparsed after the cache format changes; note files need no migration.

The special body label applies only to filename-derived titles with the generated capture name
pattern. A manually chosen filename matching that pattern is indistinguishable without adding
stored provenance and receives the same treatment. Other filenames keep their existing titles.

Pages with duplicate display labels show a relative folder path in Favorites and the finder.
The finder accepts paths such as `harbor/lantern` or `harbor/lantern.md`, including normalized
case and separators. A matching path takes precedence over creating another page. Labels and
titles never replace the canonical file path used for reading, saving or opening a page.

## Return without losing place

Favorites open the exact page through the existing awaited opener. The current page saves
before replacement; a read or save failure leaves it in place. Opening a page already visible
reveals its owning pane. The note-list filter and the other pane remain intact.

Focus follows a completed open only while that page is still the active destination and the
person has not moved to another control or pane. A slow file read must not take the caret away
from subsequent work.

An empty pane offers New page and, when pages exist, Resume a page. Resume opens the same finder
with actual recent visits. An empty vault uses a short invitation to write. The first-use
Favorites hint is a single line shown only while a page is open; it disappears after a page is
starred. There is no onboarding checklist or completion score.

## Integration boundaries

`src/leadinglight/pageLabel.ts` owns derived labels, duplicate cues and finder path matching.
Existing creation and open hooks retain filesystem and navigation ownership. Shared title
fixtures live under `src/shared/`; native and browser parsers consume the same cases.

Favorite persistence is a separate document operation from Favorite navigation. Its two
frontmatter keys must be published together, with existing page writes and lifecycle operations
coordinated through the save lane. Metadata parsing must preserve unrelated authored text.
Unconfirmed publication and an unmergeable newer draft are visible recovery states, never
optimistic success or silent rollback. The implementation and failure evidence belong in the
architecture and verification records before release.

Folder moves save and hold their affected pages before moving files. They join already-started
page renames and prevent new structural changes during the move. After a successful native
operation, the new canonical paths must be published before optional refresh work; a refresh
failure does not undo a move that already happened. Close and vault changes must also join
admitted work before collecting and saving the current pages. These are acceptance requirements
for the candidate, with runtime evidence recorded separately.
