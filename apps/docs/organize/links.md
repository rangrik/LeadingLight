---
title: Links and backlinks
description: "Link pages with @, [[ and #, choose how a link looks, and see every page that points back."
---

# Links and backlinks

Links tie your pages together. Type <kbd>@</kbd> to link a page in the middle of a sentence, and every page lists the pages that link to it. Links point at the page itself, not its name, so they keep working when you rename it.

## Link a page

1. In the body, type <kbd>@</kbd> or <kbd>[[</kbd>, then the start of a page's title, such as "@du".
2. The **Link to a page** menu lists the pages that match.
3. Press <kbd>Return</kbd>, or click a page.

<img class="shot" src="/screenshots/mention-menu.webp" alt="Typing @Dun shows the book Dune, and options to create a new page of any type" />

The link shows the page's icon and title, followed by a space so you can keep typing. Use the arrow keys to move through the menu.

- Click a link to open the page in the same pane.
- <kbd>⇧</kbd>-click it to open the page beside the one you are reading. See [Sidebar, panes and tabs](/workspace/layout).

You can also copy a link from a page's row in the sidebar (**More** › **Copy link**) and paste it into a body. It becomes the same kind of link.

## Make a new page from the menu

If the page doesn't exist yet, keep typing its name. The menu ends with **Create "Arrakis"** and one item for each type, with its icon, in the order of the sidebar's Types: Page, Person, Book, Meeting, Project, Task, Idea, Collection and any type you made.

Pick a type and the page is made with that type and its properties, and the line links to it. You stay on the page you were writing.

Tags and daily notes aren't in that list. Type <kbd>#</kbd> for a tag, and see [Date links](#link-a-day) for days.

If you undo right after, the link goes but the new page stays.

## Links follow renames

Rename a page and every link to it shows the new name, and its new icon too. Nothing needs updating by hand.

### Aliases

Give a page other names to find it by. Add the **Aliases** property (see [Properties](/organize/properties)) and type the names, separated by commas, such as "Arrakis, Desert planet". Typing "@desert" then offers Dune, with "Desert planet" as a hint beside it.

## Link a day

Type "@today" (or just "@tod") and press <kbd>Return</kbd> to link today's daily note. If the day has no note yet, linking it makes one. See [Tags and daily notes](/organize/tags-daily).

## Choose how a link looks

A link inside a sentence is always a small inline link. A link alone on its own line is a block, and can show in four ways. Hover it and open the **Link view** menu:

| Link view | Shows |
| --- | --- |
| **Line** | The page's icon and title on one line. |
| **Small card** | A card with the page's cover, icon, title and the properties its type shows **On cards**. |
| **Wide card** | A card across the full width of the page, with a taller cover and the page's description. |
| **Page** | The page's body, read only, under its title. |

A page shown as **Page** inside another page doesn't embed in turn: if that page shows yours as **Page** too, the link inside reads as a wide card, so pages never repeat inside each other.

A link to a task on its own line, as a **Line**, has a checkbox in place of the icon. See [Tasks and new objects](/organize/tasks).

### Let the type choose

Each type sets how its links look by default, in **Type settings** › **Links show as**. If Books show as **Wide card**, every new block link to a book is a wide card. You can still change any single link with its **Link view** menu. See [Types and templates](/organize/types).

## Tags with `#`

Type <kbd>#</kbd> and a word, such as "#ide". The menu offers your matching tags, and **Create #"ide"** if there is none yet. Pick it: the line shows "#ide" and a tag page "ide" is listed under Tags. See [Tags and daily notes](/organize/tags-daily).

## Backlinks: what links here

At the end of every page, **Backlinks** lists every page that links to it, with a count, such as **Backlinks · 2**. Under each page is the line around the link, such as "Reading @Dune this week", so you can see why it links without opening it.

<img class="shot" src="/screenshots/backlinks.webp" alt="Backlinks at the end of Dune, listing Trip to Kyoto with its line" />

A page that links here through a property, such as a collection's **Items**, shows the property's name instead: **Through Items**.

Click a page in the list to open it.

### Backlinks by type

When the linking pages are of more than one type, tabs show above the list: **All** first, then one tab per type with its count, such as **All 4**, **Pages 1**, **Tasks 1**, **Ideas 2**. Click a tab to see only that type; the count in **Backlinks · 4** stays the same. The arrow keys move between tabs.

Each page opens on **All**. If the pages in the tab you picked stop linking here, the tab goes and **All** is picked again. When every linking page is the same type, there are no tabs.

## Pages linked through a property

Some properties are two-way: a book's **Author** names the person, and the person's page lists their books. At the end of a page, before the backlinks, a section for each such property shows the pages pointing here through it, as small cards with their icon, title and tags:

- an author's page shows **Linked books · 1**
- a project's page shows **Linked tasks**, **Linked ideas** or **Linked meetings**

Click a card to open the page, or <kbd>⇧</kbd>-click it to open it beside. When a page drops the link, its card goes. These pages aren't listed again in Backlinks, and the property doesn't show as a row on this page. Set up your own in **Edit property** › **Name on the linked pages**. See [Properties](/organize/properties).

## Unlinked mentions

Pages that name this page in plain words, without a link, are listed under **Unlinked mentions**, with a count. Expand it to see each page and the line that names it.

Click **Link** beside one to turn those words into a link. The page then moves up into Backlinks. If that page is open in another pane, the link appears there at once.

## When a linked page is deleted

If you delete a page, links to it read **Deleted page**, struck through, and can't be clicked.

## Related

- [Tags and daily notes](/organize/tags-daily)
- [Tasks and new objects](/organize/tasks)
- [Lists, tables and boards](/organize/views)
- [Objects, types and links](/guide/concepts)
