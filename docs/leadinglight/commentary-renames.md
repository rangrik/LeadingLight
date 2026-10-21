# Keeping links through renames and moves

Part of passage commentary (E2). Folder moves follow [ADR 011](ADR-011-page-relocation.md); this
page describes how filename, title and automatic renames now keep ordinary links the same way, and
what they report. Release evidence belongs in the [verification record](VERIFICATION.md).

## What is kept

A commentary finds its source through one ordinary relative Markdown link, for example
`[Source](../Topics/plan.md)`. When either page is renamed or moved inside LeadingLight, that link
keeps reaching the same file:

- **Renaming or moving the source.** Every page whose ordinary Markdown link resolves to the old
  path is rewritten to the new path. Only the link destination changes; the rest of each page,
  including its front matter, keeps its exact bytes.
- **Renaming or moving the commentary.** Its own relative links are rebased when it changes folder;
  a rename within the same folder leaves them as they are, except explicit links to itself.
- **Title renames.** Changing a page's title writes its `title:` front matter as before and never
  edits its first heading. If the new filename is taken, the page takes `name-2.md`, and links
  name that file.
- **Automatic renames.** A new page named `untitled-…` that takes its first heading as its name
  keeps the links other pages already made to it.

A link is matched only by the exact path it resolves to. Pages with the same title or filename in
other folders are never rewritten, and nothing is guessed from titles. Wikilinks keep their
earlier behaviour: `[[Title]]`, `[[folder/name]]` and `[[name]]` forms are still updated
everywhere, including front matter. Commentary records store their captured quotes in a form those
wikilink updates cannot match, so the saved evidence is never altered by a rename.

## Open pages and unsaved words

Before a rename starts, every open page that it may change is saved and kept from saving again
until the rename answers. The rename returns the exact text each open page had before and after
the change, and the page is refreshed only from that answer; it is never simply reloaded from disk.

Words typed into a page while it is being renamed are kept. They take the same change the rename
made (a new link destination or title line) when that change can be applied exactly. If the words
were typed on the very line the rename changed, in a different way, they stay on the page but are
not saved, and the rename's notice says so, so the rename's change is never overwritten by older
text.

Only one rename may involve a page at a time. A second rename that would touch a page the first one
is changing is refused before anything happens; a manual rename of a page that is already renaming
itself waits for that to finish first. An automatic rename that was refused runs again after the
next edit.

## When something cannot be updated

Once a page has been renamed it stays renamed. If some linked pages could not be updated, the
notice says how many need attention instead of undoing or repeating the rename. A linked page is
left as it is, and counted, when:

- it was being saved or changed outside LeadingLight while the rename ran;
- it uses HTML `href` or `src` attributes, an unused local reference definition or unclosed front
  matter that the link parser does not change, and it may still name the old file. Pages that cannot
  name it are not counted.

If the reply to a rename is lost or unreadable, LeadingLight does not guess: the rename may still
finish on disk, so it is not repeated. The renamed page and every open page it may have changed can
still be read and typed in, but nothing is saved to them, and they cannot be renamed, moved, put in
Trash or changed in other ways, until LeadingLight is reopened. Closing and opening the page again
does not lift this. Words typed there stay on screen only; there is no in-app choice yet to keep them
as a copy, so copy anything you need before reopening LeadingLight. The page list is refreshed so the
page can be found where it is. Only an answer in which the app itself refused the rename, before
moving anything, lets writing continue at once.

## Limits

Renames and moves made outside LeadingLight are not followed. A file replaced by another file with
identical bytes at the same path cannot be told apart from the original. Links written with HTML
attributes are never rewritten. Moving a page between workspaces still updates wikilinks only.

The browser development bridge applies the same link changes and returns the same answers so the
interface can be checked, including folder moves, which it previously refused. Its results do not
show that files are durable on disk; the desktop app's own tests do that.
