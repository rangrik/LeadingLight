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
- Block menu from the handle, a right-click or ⌘/: turn into, duplicate, delete.
- Pixel precision pass on every block kind.

What this milestone left out is in `DEFERRED.md`.

## M1.75 — Shipyard inside (now)

Shipyard's app is vendored (`vendor/shipyard`, `docs/SHIPYARD.md`). Done: themes (ours
in `packages/themes`), Settings in our shell, shortcuts and the menu bar, zoom,
stillness, the mock agent connection, and Ask about this: a bar beside the selected words
and a panel in the note that ask Claude through the Claude Code sign-in on this Mac, with a
composer that mentions agents and pages (`features/ask.feature`, `features/composer.feature`).

- Claude on every page (built, `features/ask.feature`): the Ask button and ⌘J, threads kept per
  page, page tools behind Ask for approval, Approve for me or Full access, Plan mode, and the
  model and effort picker, after synara. Claude through Claude Code, GPT through Codex.
- Keeping Claude Code and Codex up to date from the app, and how much of each plan is left at
  the bottom of the sidebar (`features/cli-updates.feature`, `features/usage.feature`).
- An agents area on the conversation UI, on mock data first, then a backend.
- The designer's pass on Settings and the agent panel (the brief).

## M2.5 — Writing tools, after iA Writer (built)

The editor aids iA Writer's users love most (https://ia.net/writer/support/editor), from the View
menu, the Writing menu at the panel's top right, and Settings › Writing. See
`features/writing.feature`; why they are built this way is `DECISIONS.md` 12.

- Focus mode (⇧⌘F): the line being written stays in the middle; Sentence or Paragraph dims the rest.
- Syntax highlight (⇧⌘D): nouns, verbs, adjectives, adverbs and conjunctions in the theme's colours.
- Style check (⌥⇧⌘D): fillers, redundancies and clichés struck through, never deleted.
- Grammar check (⇧⌘G): Harper's grammar and spelling mistakes underlined, with its reason.
- Counts (⇧⌘W): beside the page's name, words, reading time, parts of speech, style and grammar,
  for the page or the selection; a click shows every number.
- They work on the types of pages chosen in Settings › Writing › Use on: suggested on for pages
  written in, off for records (people, books, tags, collections).

## M2 — Objects and links (built)

Parity with Capacities' building blocks, on one kind of object: the page. No type is
written into the code. Why: `DECISIONS.md` 8. Reference: https://docs.capacities.io/reference.

Every page
- Icon: any emoji, a lucide icon in a theme colour, or an uploaded image.
- Cover: upload, paste, link, a theme colour, or an Unsplash photo with its credit. Drag to
  reposition. Unsplash needs each person's own free key, and its photos don't show offline.
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
- Links follow renames. Backlinks are found by searching stored pages for the page's id,
  so there is no links table to keep in step.
- Backlinks sit at the end of every page, grouped by source, each with the line around
  it. Links from properties show the property's name. Unlinked mentions get a Link button.
- Shift-click opens a page beside the one in view (see the side-by-side panes).

Lists and cards
- Cards show the properties their type marks "On cards".
- A type's pages and a tag's pages show as a list, table, gallery or board, with sort and
  group, kept per type. Relations show as chips, backlinks with their lines.

Made from the same parts
- Tag: a page of type Tag. "Add tag" above the title tags the page; `#name` in text links the
  line. A tag's page lists everything tagged. Two tags can be merged.
- Collection: a page whose relation lists its members.
- Daily note: one page per day, opened from Today, the previous and next day or a calendar,
  and linked with `@today`. It lists what was made that day.

Storage: a `property_defs` table holds definitions, and types keep their settings in
`object_types`. Values stay in each page's `properties` JSON; a page's own properties are the
values its type doesn't list. The browser store mirrors both.

Property kinds, list views, page layouts, icon and cover sources, and starter types each
sit in one list, so each can become an extension later.

Order: page header → properties and types → links and backlinks → cards and lists →
tags, daily notes, templates, starter types.

Left out of M2 (see `DEFERRED.md`): stickers (waiting on a decision),
queries, block references, images and web links as pages, the graph, one page open twice,
editing an embed in place, editing values inside lists.

## M2.75 — Idea capture (built)

- ⌃⌥I from any app opens a small box; what is typed is an Idea page, shown in Today by the
  day it was made. A non-activating panel in the Mac app, the same box inside the window in a browser
  (features/capture.feature, DECISIONS.md 14).

## M2.8 — Types in Settings, tasks, new pages from "/" (building)

- Settings › Types and Settings › Properties list every one, edit it, and make new ones
  (features/settings-types-properties.feature).
- Tasks: a starter type whose line links have a checkbox (features/tasks.feature, DECISIONS.md 15).
- The slash menu's "New" section makes a page of any type where the cursor is and links it
  (features/new-objects.feature).
- The capture box: the theme, a header bar with a project picker, ⌘↩ saves, ⇧⌘↩ opens beside,
  and ideas show in their day by date instead of a list in the note (features/capture.feature).
- Backlinks in tabs by type (features/links.feature).

## M3 — Everyday polish

- Search (⌘K), trash view with restore, images and files, remember window state.
- Keyboard-first: ⌘N new page, ⌘\ sidebar, ⌘1–3 headings, ⌘⇧L to-do.

## Later

- Sync between devices. Mobile.
