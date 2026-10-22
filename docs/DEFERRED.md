# Deferred

Issues and features we chose not to do yet: when, why not now, and what would bring each back.
When one is picked up, move it out of this file and into the plan or the change that does it.

| Date | Item | Why not now | Revisit when |
|---|---|---|---|
| 2026-10-22 | Virtualized or paged editing for very long pages | A keystroke on a 2000-paragraph page takes 8–11 ms (the first about 13 ms), inside a 16 ms frame. Rendering part of a page needs a new editor architecture and tends to break browser find, cross-block selection and copy. | Someone finds typing slow. To check: fill a page with 2000 paragraphs (`__editor.commands.setContent`), type 30 keys, time each from keydown to its transaction; the budget is 16 ms. |
| 2026-10-22 | Block actions: turn into, colours, highlights | Left out of the block set on request; selecting blocks came first. | After M2, or when asked. |
| 2026-10-22 | Math blocks | Left out of the block set on request. | When asked. |
| 2026-10-22 | M2: object types with properties (text, date, number, select, relation), a type picker on create, a property header above the body | Put off to start using the page editor first. Needs the first two or three real types (e.g. Person, Book, Meeting) to shape the design. | When M2 starts. |
| 2026-10-22 | M2: `@` mentions of objects, with backlinks | Builds on object types. | With M2. |
| 2026-10-22 | M2: daily notes | Builds on object types. | With M2. |
| 2026-10-22 | Object blocks | Need object types, which arrive in M2. | With M2. |
| 2026-10-22 | Mermaid diagrams in code blocks | A large extra dependency for a niche use. | When asked. |
| 2026-10-22 | Highlight blocks from reading integrations | There are no integrations to bring highlights in. | When an integration is built. |
| 2026-10-22 | Width options for columns and groups | Equal widths cover the common case. | When asked. |
| 2026-10-22 | Drag-to-resize sidebar | sidebar-08 has a fixed 256 px sidebar; dropped when we moved to it. | When asked. |
| 2026-10-22 | Chromium drops a media block's selection when it sits between two media blocks | The Mac app (WebKit) keeps it. Chromium has no caret spot between two non-editable blocks, so on page refocus it moves the caret to the page start. Only DevTools-driven input (the QA harness) triggers it reliably. A fix exists (about 30 lines plus a test, uncommitted in the worktree `.claude/worktrees/agent-a9523810594569085` of the main checkout), but it rests on a timing guess. | We ship a Chromium-based build, such as Windows, where Tauri uses WebView2. |
| 2026-10-22 | Own handles for list items inside columns | A handle beside an item in column 2 would sit over column 1's text; hovering by height alone also picked the wrong column (QA R10-1). The columns block keeps one handle. | Column gaps wide enough for a handle, and column-aware hovering. |
| 2026-10-22 | A file card that shows its file is missing | Images, video and audio learn this for free from a failed load; a file card would need a disk check per card. In the app, clicking a card whose file was moved or deleted does nothing. | Someone hits a dead file card. |
