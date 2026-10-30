---
title: Lists, tables and boards
description: Show a type's pages or a tag's pages as a list, a table, a gallery of cards or a board, sorted and grouped.
---

# Lists, tables and boards

Every type has a list of its pages, opened from **Types** in the sidebar, and every tag's page lists what is tagged with it. You can show those pages four ways, sort them, and group them. Each type remembers how you left it.

## Pick a view

At the top of a list, the **View** switch has four choices:

<img class="shot" src="/screenshots/view-list.webp" alt="Books as a list, with each book’s author and status" />

| View | Shows |
| --- | --- |
| **List** | One row per page: its icon, title and the properties its type shows on cards. |
| **Table** | One row per page and one column per property: Title first, then the type's properties. |
| **Gallery** | A card per page, with its cover, icon, title and card properties. |
| **Board** | A column per option of a select or checkbox property, with the pages' cards in them. |

Click a row or a card to open its page. <kbd>⇧</kbd>-click opens it beside.

New lists start as **List**, sorted by title.

### List

Each row shows what the type marks **On cards**: for Books, the Author and Status. Values line up in columns from row to row, so statuses and dates are easy to scan. In a narrow pane, long titles and values are cut with "…" so everything stays inside.

### Table

For Books, the columns are Title, Author, Rating, Status, Finished on and Tags.

<img class="shot" src="/screenshots/view-table.webp" alt="Books as a table" />

### Gallery

Cards sit two to a row in a single pane, one to a row in a narrow pane. Under its title, each card shows the page's description, or else the first lines of its body, cut after three lines. When you edit a page, its card shows the new words.

### Board

The board has a column per option, in the property's order, then one for pages with no value, such as **No status**. Each column shows its count beside its name.

<img class="shot" src="/screenshots/view-board.webp" alt="Books as a board grouped by status" />

## Sort

Pick a property in **Sort by**, then click the direction button beside it to switch between **Ascending** and **Descending**.

- Pages without a value for the property come last.
- Sorting by a date, such as **Created** or **Updated**, starts newest first. Going back to **Title** starts at A again.

## Group

Pick a property in **Group by** to list pages under a heading for each of its values, such as "To read", "Reading" and "Read". Groups with no pages aren't shown.

**Group by** and **Board** need a select or checkbox property. When the pages have neither, both are greyed out, and hovering them tells you why. If a type's board loses its last such property, the type shows as a list again.

## The view is kept per type

The view, the sort and the grouping are saved with each type. Choose **Gallery** for Books and Books open as a gallery from then on, while People still open as a list.

## A tag's pages

Open a tag's page and **Tagged** lists everything with that tag, with a count, such as **Tagged · 2**. It has the same view switch, sort and grouping as a type's list, and its columns come from what the tagged pages' types show on cards. See [Tags and daily notes](/organize/tags-daily).

## Choose what cards show

Cards and list rows show the properties a type marks **On cards**.

1. Open the type's list and click **Type settings**.
2. Under **Properties**, tick **On cards** beside each property you want on its cards.
3. Click **Save**.

The same choice is used for links shown as cards (**Small card**). See [Types and templates](/organize/types).

::: info Limits
You can't edit values inside a list or drag cards between board columns yet. Open the page to change a value.
:::

## Related

- [Types and templates](/organize/types)
- [Properties](/organize/properties)
- [Links and backlinks](/organize/links)
