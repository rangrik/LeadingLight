# Plan

## M1 — A sleek page editor (now)

- Our block editor on TipTap: paragraphs, headings 1–3, bullet/numbered/to-do lists,
  quote, code block, divider. Bold, italic, underline, strike, inline code, link, highlight.
- Markdown shortcuts, slash menu, selection toolbar, block handle with drag to reorder.
- App shell: overlay title bar, resizable and collapsible sidebar, light and dark.
- Pages: create, rename by title, switch, delete with confirm, autosave, persistence.
- QA harness: Gherkin in `features/`, Playwright in `apps/desktop/qa`.

## M1.5 — The Capacities block set (built)

Everything in https://docs.capacities.io/reference/blocks except math and object blocks.
See `features/blocks.feature`, `features/selection.feature`, `features/polish.feature`.

- Text: heading 4, small text, toggle, emoji prefix with picker, alphabetical and roman lists.
- Code block: language picker with highlighting, copy, download.
- Table: header row, add/delete rows and columns, resizable columns, Tab between cells.
- Layout: two columns, group (Meta+G on a selection), divider.
- Media: image (file, paste, drop; width presets), video, audio, file card, embed (YouTube and
  other URLs). Files are stored next to the database in the app, as data URLs in the browser.
- Block selection: handle click, shift-click range, Escape, Shift+Arrow, delete, copy, drag, group.
- Pixel precision pass on every block kind.

What this milestone left out is in `DEFERRED.md`.

## M2 — Objects and links (next)

Parity with Capacities' building blocks, on one kind of object: the page. No type is
written into the code. Why: `DECISIONS.md` 6. Reference: https://docs.capacities.io/reference.

Every page
- Icon: any emoji, a lucide icon in a theme colour, an uploaded image, or a sticker.
- Cover: upload, paste, link, a theme colour, or a photo from Unsplash. Drag to reposition.
- Description, tags, aliases, created and updated dates.
- Any property, whatever the page's type.

Properties
- Kinds: text, number, checkbox, date (time and range optional), select (one or many),
  relation (to any page or to one type; one or many; two-way optional), link, file.
- Each property is defined once for the space (name, kind, options), so "Rating" means
  the same on every page that has it.
- Changing a property's kind keeps the old values aside until the user confirms.

Types
- A type is a bundle the user can edit: name, icon, colour, properties, page layout,
  card, default link view and templates. Its pages follow it; one page may add more.
- "Save as type" turns a page's shape into a new type. A page's own property can be added
  to its type. Changing a page's type keeps every value.
- A template is a page marked as one of its type's templates. One is the default.
  `{date}` in a template title becomes the creation date.
- Starter types ship as data: Person, Book, Meeting, Project, Idea and the like.

Links
- `@` and `[[` search titles and aliases and insert a link; "Create …" makes a new page.
- A link on its own line shows as a line, a small card, a wide card, or the page itself,
  editable in place. The type sets the default; each link can change it.
- Links follow renames. A `links` table is rebuilt from the body and properties on save.
- Backlinks sit at the end of every page, grouped by source, each with the line around
  it. Links from properties show the property's name. Unlinked mentions get a Link button.
- Shift-click opens a page in a side panel, up to three stacked.

Lists and cards
- Cards show the properties their type picks; any list can override that.
- Lists of a type, a tag, a relation or backlinks: list, table, gallery or board, with sort
  and group.

Made from the same parts
- Tag: a page of type Tag. `#name` under the title tags the page; in text it links the line.
  A tag's page lists everything tagged. Two tags can be merged.
- Collection: a page whose relation lists its members.
- Daily note: one page per day, a calendar, and date links such as `@today`.

Storage: a `properties` table holds definitions. Values stay in each page's `properties`
JSON; a page's own properties are the values its type doesn't list. A `links` table holds
links. The browser store mirrors both.

Property kinds, list views, page layouts, icon and cover sources, and starter types each
sit in one list, so each can become an extension later.

Order: page header → properties and types → links and backlinks → cards and lists →
tags, daily notes, templates, starter types.

Left out of M2 (see `DEFERRED.md`): queries, block references, images and web links as
pages, the graph, one page open twice.

## M3 — Everyday polish

- Search (⌘K), trash view with restore, images and files, remember window state.
- Keyboard-first: ⌘N new page, ⌘\ sidebar, ⌘1–3 headings, ⌘⇧L to-do.

## Later

- Sync between devices. Mobile.
