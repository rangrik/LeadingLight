---
title: Sidebar, panes and tabs
description: How the LeadingLight window is laid out, and how to open pages side by side and in tabs.
---

# Sidebar, panes and tabs

The window has a sidebar on the left and the pages you have open on the right. You can open
several pages side by side, and each of those places can hold tabs, as a browser window does.

## The window

- **The sidebar** runs down the left. **LeadingLight** sits at its top, then **Today**, your types
  (such as People or Books), any pinned pages, and **Recent**, the list of your pages with a
  **New page** button. **Settings** is at the bottom.
- **The page area** fills the rest. Each open page is a card with rounded corners, with a small
  gap between it, its neighbours and the window's edges.
- **The bar** is the slim strip at the right edge of the window. See [The bar](/workspace/bar).

In the Mac app the title bar is part of the window, as in Apple Notes: the traffic lights sit on the
same line as the top of each page.

### The card header

The bar at the top of each card shows where you are, as a breadcrumb: the page's parent, then its
icon and title. A new page reads **Pages** then its title; a book reads **Books** then its title.

- The title in the breadcrumb follows the page's title as you type, before anything is saved.
- Click the first part, such as **Pages** or **Books**, to open that list in the same card.
  Shift-click it to open the list beside the page instead.
- In a narrow card the header stays on one line, and a long title ends in "…".

## Hide or resize the sidebar

To hide the sidebar, click **Toggle Sidebar** or press <kbd>⌘&#92;</kbd>. The sidebar slides away and
the pages take the full width. Do the same again to bring it back.

In the Mac app, **Toggle Sidebar** sits in the title bar just right of the traffic lights, and it stays
in the same place whether the sidebar is shown or hidden. In a browser it sits at the left of the
first card's header.

To change the sidebar's width, point at the gap between the sidebar and the first card. A small grip
shows and the pointer turns into a resize arrow. Drag left or right; the cards move with it. The
sidebar stops at a minimum and a maximum width.

LeadingLight remembers whether the sidebar is hidden and how wide it is, after a reload too. Settings'
sidebar uses the same width, and hiding and showing the sidebar brings it back at that width.

::: tip
<kbd>⌘B</kbd> always makes text bold. It never hides the sidebar.
:::

## Open pages side by side

Every open page is its own card in the page area. A page is open in one place at most: opening it
again moves you to it or moves it, and never makes a second copy.

<img class="shot" src="/screenshots/panes.webp" alt="Two pages open side by side" />

### Drag a page to an edge

1. Press on a page's row in the sidebar and move the pointer over an open page.
2. Move towards the edge where you want the new page: left, right, top or bottom. A dashed card shows
   where it will go, labelled with the side and the page, such as **Open on the right · B**.
3. Let go. The two pages now share the space, each in its own card with its own header.

To cancel, press <kbd>Esc</kbd> before you let go, or let go over the sidebar. Nothing changes.

You can also drag a page that is already open by the breadcrumb in its card header, and drop it near
an edge of another page to move it there. Dropping a page onto its own card does nothing. If you drag
a sidebar row for a page that is already open, it moves rather than opening twice, and keeps its
words and scroll position.

### Shift-click a sidebar row

Shift-click a page's row in the sidebar to open it on the right of the page in view, as
Shift-clicking a link does. If the page is already open, it just gets the focus where it is. Shift
works the same way on a type row (such as People) and on **Today**.

### Split again

You can split a card that is already split. With A on the left and B on the right, drag C near the
bottom edge of B: A keeps the left half, B takes the top right quarter and C the bottom right quarter.

### Resize two pages

Point at the gap between two cards. A small grip shows in the middle of the gap and the pointer turns
into a resize arrow. Drag to share the room differently. A page never gets narrower than a tenth of
the space it shares.

### Close a page

While two or more pages are open, each card header has a **Close page** button. Click it to close that
page; the page beside it takes the room. Anything you typed is saved first.

If you delete a page that is open beside another, the other page fills the space.

## Which page has the focus

One page is in focus at a time. Its row in the sidebar is marked as current, and the title in its card
header is in the regular text colour, while the other headers are muted.

- Clicking into a page focuses it.
- A page you open beside another gets the focus.
- Clicking a sidebar row opens that page in the focused card, replacing what was there. If the page is
  already open elsewhere, it gets the focus where it is and nothing else changes.
- <kbd>⌘N</kbd> makes a new page called "Untitled" in the focused card, with its title ready to type.

Each page saves its own edits, whatever is open beside it.

## Tabs

Each card can hold tabs. The tab row shows only when a card has two or more tabs, so a single page
looks as it always did.

| To do this | Do this |
| --- | --- |
| Open a page in the tab you are in | Click it in the sidebar or click a link |
| Open a page in a new tab | <kbd>⌘</kbd>-click it |
| Open a page beside, in a new card | Shift-click it |
| Open an empty tab | <kbd>⌘T</kbd>, or **+** at the end of the tab row |
| Close the tab | <kbd>⌘W</kbd>, or the close button that shows when you point at a tab |
| Reopen the last closed tab | <kbd>⇧⌘T</kbd> |
| Go to the next or previous tab | <kbd>⌃⇥</kbd> and <kbd>⌃⇧⇥</kbd> |

The active tab is in front; the others are muted. A tab keeps its scroll position and unsaved words
while you look at another tab.

A new empty tab shows **No page open**, with a **New page** button.

When you close a tab, the tab next to it becomes active. <kbd>⇧⌘T</kbd> brings the closed tab back in
its old place, with its history. Closing the last tab of a card closes the card, and the card beside
it takes its room. When the last card's last tab closes, the page area shows **No page open**.

### Back and forward

Each tab keeps its own history, as a browser tab does. Use **Back** and **Forward**, the two chevrons
at the left of the card header, or press <kbd>⌘[</kbd> and <kbd>⌘]</kbd>. A chevron is muted when
there is nowhere to go.

If you go back and then open a different page, the forward history is gone, as in a browser.

These keys work while you are typing in a page too: they never change your words. <kbd>⌃⇥</kbd> also
moves to the next tab and never puts a tab into the text.

### Reorder and move tabs

- **Reorder**: drag a tab along the tab row. The active tab stays the same.
- **Move to another card**: drag a tab onto that card's tab row. If the card has only one page and so
  no tab row, an **Add as a tab** box covers its header while you hover. Once dropped, the tab belongs
  to that card. A card left with one tab hides its tab row.
- **Split**: drag a tab to an edge, such as the window's right edge. It opens in a new card, and the
  card it left closes if it is now empty.

LeadingLight remembers your cards, their tabs, the order of the tabs and the active tab, and puts them
back when you open the app again.

::: info Limits
- Back and forward open a page at its top, not where you were on it.
- Panes can't yet be split, moved or resized from the keyboard or a menu; use dragging.
:::

## Keys

| Key | What it does |
| --- | --- |
| <kbd>⌘&#92;</kbd> | Show or hide the sidebar |
| <kbd>⌘N</kbd> | New page, in the focused card |
| <kbd>⌘T</kbd> | New tab |
| <kbd>⌘W</kbd> | Close tab |
| <kbd>⇧⌘T</kbd> | Reopen closed tab |
| <kbd>⌘[</kbd> | Back |
| <kbd>⌘]</kbd> | Forward |
| <kbd>⌃⇥</kbd> | Next tab |
| <kbd>⌃⇧⇥</kbd> | Previous tab |

You can change any of these in **Settings › Shortcuts**.

## Related

- [The bar](/workspace/bar)
- [Pages](/organize/pages)
- [Links and backlinks](/organize/links)
- [Keyboard shortcuts](/customize/shortcuts)
