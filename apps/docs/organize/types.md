---
title: Types and templates
description: Sort pages into types such as Person, Book or Meeting, shape each type's properties, and start new pages from templates.
---

# Types and templates

Every page has a type. A type says what kind of thing the page is about, such as a person, a book or a meeting, and which properties its pages show. Types are yours to change: rename them, give them icons, add properties, or make your own.

## What a type gives its pages

A type is a bundle you can edit:

- a **Name** and a **Plural**, such as Book and Books
- an **Icon** and a **Colour**
- its **Properties**, shown on every page of the type, in order
- which of those show **On cards**
- how links to its pages look (**Links show as**)
- its **Templates**, and which one is the default
- how its list of pages is shown (list, table, gallery or board)

A page follows its type, and can still add properties of its own. See [Properties](/organize/properties).

## The starter types

A new space comes with these types. They are ordinary data, so you can change them like your own.

| Type | Plural | Properties | On cards |
| --- | --- | --- | --- |
| Page | Pages | None | |
| Tag | Tags | None | |
| Daily note | Daily notes | None | |
| Person | People | Email, Phone, Company, Birthday, Tags | Company |
| Book | Books | Author, Rating, Status (To read, Reading, Read), Finished on, Tags | Author, Status |
| Meeting | Meetings | Date (with a time), Attendees, Project, Tags | Date |
| Project | Projects | Status (Planned, Active, Done), Due, Tags | Status, Due |
| Task | Tasks | Done, Due, Project, Tags | Due, Project |
| Idea | Ideas | Project, Tags, Created, Updated | Project |
| Collection | Collections | Items, Tags | |

Page is a plain page, the default for anything you write. Tag and Daily note are covered in [Tags and daily notes](/organize/tags-daily), Task in [Tasks and new objects](/organize/tasks).

The app also makes a few types for its own work. You never make their pages from **New**:

| Type | What it holds |
| --- | --- |
| Agent | One agent at work: its profile, the task it was given and the agent that started it. |
| Report | What an agent published for you to read, signed and dated. |
| Feedback | Sidenotes you chose to send to a task's agent. |
| How you work | The page Tail keeps about how you work. |

See [AI and agents](/ai/) and [Tail and suggestions](/ai/tail).

## Change a page's type

Click **Type** in the property bar under the title and pick another type. The page shows that type's properties at once, empty if it had no value for them, and its sidebar row takes the type's icon.

Changing the type keeps every value. A property the new type doesn't have stays on the page as its own.

Daily note and the app's own types aren't offered here: a daily note is made by its date, and agents' pages by the app.

## Save a page's shape as a type

When a page has grown properties you want on other pages too, make a type from it.

1. Open **Page options** ("…") in the property bar and choose **Save as type…**.
2. Enter a **Name**, such as "Novel". The **Plural** fills itself in; change it if it is wrong.
3. Click **Save as type**.

The new type gets the page's properties, and the page becomes one of it. The type shows under **Types** in the sidebar by its plural.

To add just one of a page's own properties to its type, click the property's name and choose **Add to** *type*. See [Properties](/organize/properties).

## Open a type's list

The **Types** section of the sidebar has one row per type, by its plural name. Click one to open its list:

- the type's icon and plural name at the top
- **New** *type*, such as **New book**, to make a page of the type
- **Type settings**
- its pages, as a list, table, gallery or board. See [Lists, tables and boards](/organize/views).

A type with no pages yet says so, such as **No books yet**, with a sentence on what the type is for and a **New book** button.

**New** on Daily notes opens today's note. Agents and Reports have no **New** button; the app makes them.

## Edit a type

Open the type's list and click **Type settings**, or use **Settings › Types**. In the **Type settings** dialog:

| Field | What it changes |
| --- | --- |
| **Icon** | The type's icon, from the same picker as a page's icon. Pages without their own icon show it. |
| **Name** and **Plural** | What the type is called. The sidebar uses the plural. |
| **Colour** | The type's colour. |
| **Links show as** | How a link to one of its pages looks when it sits on its own line: **Line**, **Small card**, **Wide card** or **Page**. See [Links and backlinks](/organize/links). |
| **Properties** | The properties every page of the type shows. Move one with the up and down arrows, remove it with **×**, or click **Add property**. Tick **On cards** to show a property on the type's cards and list rows. |
| **Templates** | See below. |

Click **Save**. Every page of the type follows at once. For example, moving Rating to the top makes every book show Rating first.

How a type's list is shown is not in this dialog: pick the view, sort and grouping in the list itself, and the type keeps them.

### Delete a type

Types you made, and most starter types, have **Delete type** in their settings. Click it, read *Its pages become plain pages.*, and confirm. A starter type you delete doesn't come back.

The built-in types Page, Tag and Daily note, and the app's own types, have no **Delete type** button: the app relies on them.

## Make a new type

1. Open **Settings › Types** and click **New type**.
2. The dialog is titled **New type**, with every field empty. Type a **Name**, such as "Recipe". The **Plural** shows "Recipes" as a hint and uses it if you leave the field empty.
3. Pick an icon, add properties, and click **Create**.

A type needs a name. With the name empty, the dialog says **Give the type a name** and stays open. Press <kbd>Esc</kbd> to leave without making one.

The new type is listed last under **Types** in the sidebar and in Settings. It is offered everywhere a type is: the **Type** picker, **New** in the slash menu, and **Create** in the link menu.

## Settings › Types

**Settings › Types** lists every type in the sidebar's order. Each row shows the type's icon, its plural, how many pages it has ("1 page", "0 pages") and an **Edit** button that opens **Type settings**. Settings stays open on Types after you save. **New type** sits above the list.

## Templates

A template is a page that new pages of a type start from: its title, properties and body are copied into each new page.

### Make a template

1. Open the type's **Type settings** and click **New template**.
2. A page opens, such as "Book template", with a note: *Template for Books: new ones start as a copy of this page.*
3. Fill it in as you would a page: a title, property values, and a body.

Write `{date}` in a template's title to put the day the page is made there. A title of "Book – {date}" makes "Book – " followed by today's date.

Templates stay out of the way: they aren't in the type's list, the sidebar, or the link menu. Find them in **Type settings** under **Templates**; click one to open it.

### Choose the default

In **Type settings**, click the star beside a template to make it the default, and **Save**. **New** *type* then starts from it. Click the star again to have no default.

To start from another template, click the arrow next to **New** *type* and pick it.

A daily note template works the same way: when you open a day that has no note yet, the note starts from the template. It is stored only once you edit it.
## Settings › Objects

**Settings › Objects** explains everything LeadingLight keeps for you and its agents. For each kind (Project, Task, Agent profile, Agent, Report and more) it says what it is for, who makes it (**Made by**), what can change (**Changes**) and where it shows (**Shows in**). A second group covers what shows on a task and in the Feed.

A kind backed by a type uses the type's current name. If you renamed Task to "To-do", or made your own type with a Done property, the task row reads that way. Click **Show** on a row (with how many there are, such as **Show 2**) to close Settings and open the list.

## Related

- [Properties](/organize/properties)
- [Lists, tables and boards](/organize/views)
- [Objects, types and links](/guide/concepts)
- [Settings reference](/customize/settings)
