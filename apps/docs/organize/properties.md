---
title: Properties
description: Add facts to a page, such as a rating, a date, a status or the people involved, and keep them the same across pages.
---

# Properties

Properties hold the facts about a page: a book's author and rating, a meeting's date, a project's status. Any page can have any property, whatever its type.

A property is made once for your whole space. "Rating" means the same thing on every page that has it, so lists can sort and group by it across types.

## The property bar

Under the title of every page is the property bar. It holds:

- **Type**: the page's type, such as Page or Book. See [Types and templates](/organize/types).
- **Add property**: adds a property to this page.
- **Page options** ("…"): the page's own actions. See [Pages and the sidebar](/organize/pages).

A plain page has no properties, so the body starts right under the bar. When a page has properties, each shows as a row under the bar: the property's name on the left, its value on the right. The type's properties come first, in the type's order, then any the page has of its own.

Click a property's name to open its menu:

| Item | What it does |
| --- | --- |
| **Edit property** | Opens **Edit property** to rename it, change its kind or options. |
| **Add to** *type* | Shown on a page's own property. Adds it to the page's type, so every page of that type shows it, after the type's other properties. |
| **Remove from** *type* | Shown on a type's property. Takes it off the type. |
| **Remove from page** | Shown on a page's own property. Takes it off this page. |

On pages of the built-in types, such as plain pages, tags and daily notes, **Add to** and **Remove from** aren't offered. Change those types' properties in their **Type settings** instead.

## Kinds of property

Each property has a kind, which decides what it holds and how you set it. An empty value reads *Empty*; click it to fill it in.

| Kind | Holds | Options |
| --- | --- | --- |
| **Text** | Any words. | |
| **Number** | A number, such as a rating or a page count. | |
| **Checkbox** | On or off, such as a task's Done. | |
| **Date** | A day, picked from a calendar. | **Include a time**, **Allow a range** (a start and an end day). |
| **Select** | One of a list of options, each with a colour, such as a status. | **Allow more than one**, **Options**. |
| **Pages** | Links to other pages, such as a book's author. | **Allow more than one**, **Linked pages are**, **Name on the linked pages**. |
| **Link** | A web address or email. A button beside it opens it. | |
| **File** | One file you choose. Click its name to open it. | |
| **Created** | When the page was made. | Set by the page; can't be edited. |
| **Updated** | When the page was last changed. | Set by the page; can't be edited. |

### Select options

To pick a value, click it and choose an option, or search with **Find or create an option**. If what you type isn't an option yet, **Create** adds it.

To change the list, choose **Edit property** in the property's menu. Under **Options** you can rename an option, pick its colour, remove it with its **×**, or click **Add option**. The options are shared: an option added on one page can be picked on every page with that property.

### Links to pages

A **Pages** property links to other pages. Click its value and search; pick a page, or create a new one from the picker with **Create** and the name you typed. Each linked page shows as a chip you can click to open.

In **Edit property** you choose:

- **Allow more than one**: one page, or many.
- **Linked pages are**: **Any type**, or only pages of one type, such as People.
- **Name on the linked pages**: makes the link two-way. The linked page then lists who points at it under that name. A book's **Author** is named "Books", so an author's page ends with **Linked books** and small cards for each book. Leave it empty and nothing shows on the other side.

See [Links and backlinks](/organize/links) for how those lists look.

### Dates

Click a date to pick a day from the calendar. With **Include a time**, a time field shows too. With **Allow a range**, you pick a first and a last day.

## Add a property to one page

1. Click **Add property** in the property bar.
2. Type a name in **Find or create a property**.
3. Pick an existing property from the list, or pick **New property "*name*"** and then its kind.

A property you add this way is the page's own. Other pages of the same type don't get it. To give it to all of them, choose **Add to** *type* in its menu.

### Reuse a property you already have

Properties are shared, so the list in **Add property** shows every property in your space. It says so at its top: *Properties are shared by all pages.* On the right of each row are the types that use it, such as "People" for Birthday or "Books" for Rating. The icon on the left shows the kind.

Typing "pag" finds "Pages" if you made it before. Pick it and the page gets the same property, with the same kind and options.

Two properties can share a name. The starter set has two called **Status** (for books and for projects) and three called **Project**. The types on the right tell them apart.

If you type the name of a property the page already has, the list says **Already added.**

### The description is not a property

Typing "desc" offers **Description**, marked *Under the title*. Picking it opens the description line under the page's title rather than adding a row. A property can't be named "Description"; the editor says *A page's description is the line under its title.* See [Icons, covers and descriptions](/organize/page-header).

## Rename a property everywhere

Open the property's menu, choose **Edit property**, change the **Name** and click **Save**. Every page and type that uses it shows the new name, with the values it had.

## Change a property's kind

In **Edit property**, pick another **Kind** and click **Save**. Values already set aren't lost: the editor warns *Values already set stay in "Rating (old)"*. The property keeps its name with the new kind, empty, and each page that had a value keeps it in a property named with "(old)".

Created and Updated can't be changed to another kind, and can't be chosen as a kind; they come from the page itself.

## Remove a property

- **Remove from page** takes a page's own property off that page. Its value goes with it.
- **Remove from** *type* takes a property off a type. Pages of the type stop showing it, except pages that had a value: they keep it as their own property, value and all.

::: info Limits
A property can't be deleted from your space yet. You can remove it from every page and type, but **Add property** still offers it, and its values stay stored.
:::

## Created and Updated

Add **Created** or **Updated** with **Add property** to show when a page was made or last changed. They fill themselves in and can't be edited. Ideas show both from the start.

## Settings › Properties

**Settings › Properties** lists every property in your space, oldest first. Each row shows its kind's icon, its name, and a muted line with its kind and the types that use it, such as "Number · Books" or "Pages · People, Books, …". A property no type uses reads "Not in a type".

- Click **Edit** on a row to open **Edit property**. Changes apply everywhere, as from a page.
- Click **New property** to make one. Give it a **Name** and a **Kind** (Text to start with), add options if it is a Select, and click **Create**. It is offered in **Add property** on every page from then on.

A property needs a name: with the name empty, the editor says **Give the property a name** and makes nothing.

## Related

- [Types and templates](/organize/types)
- [Links and backlinks](/organize/links)
- [Lists, tables and boards](/organize/views)
- [Settings reference](/customize/settings)
