# Plan

## M1 — A sleek page editor (now)

- Our block editor on TipTap: paragraphs, headings 1–3, bullet/numbered/to-do lists,
  quote, code block, divider. Bold, italic, underline, strike, inline code, link, highlight.
- Markdown shortcuts, slash menu, selection toolbar, block handle with drag to reorder.
- App shell: overlay title bar, resizable and collapsible sidebar, light and dark.
- Pages: create, rename by title, switch, delete with confirm, autosave, persistence.
- QA harness: Gherkin in `features/`, Playwright in `apps/desktop/qa`.

## M1.5 — The Capacities block set (next)

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

Shipyard's app is vendored (`vendor/shipyard`, `docs/SHIPYARD.md`). Done: themes,
Settings, shortcuts and the menu bar, zoom, stillness, the mock agent connection.

- Our own Settings container and copy; agent sections out.
- An agents area on the conversation UI, on mock data first, then a backend.
- Ask about a selection: a provider behind one `ask` interface (Settings › AI).

## M2 — Objects (deferred, see `DEFERRED.md`)

- Object types with properties (text, date, number, select, relation). A type picker
  on create. A property header above the body.
- Inline mentions of objects (`@`), with backlinks stored in a `links` table.
- Daily notes.

## M3 — Everyday polish

- Search (⌘K), trash view with restore, images and files, remember window state.
- Keyboard-first: ⌘N new page, ⌘\ sidebar, ⌘1–3 headings, ⌘⇧L to-do.

## Later

- Sync between devices. Mobile.
