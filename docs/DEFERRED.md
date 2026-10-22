# Deferred

Issues and features we chose not to do yet: when, why not now, and what would bring each back.
When one is picked up, move it out of this file and into the plan or the change that does it.

| Date | Item | Why not now | Revisit when |
|---|---|---|---|
| 2026-10-22 | Virtualized or paged editing for very long pages | A keystroke on a 2000-paragraph page takes 8–11 ms (the first about 13 ms), inside a 16 ms frame. Rendering part of a page needs a new editor architecture and tends to break browser find, cross-block selection and copy. | Someone finds typing slow. To check: fill a page with 2000 paragraphs (`__editor.commands.setContent`), type 30 keys, time each from keydown to its transaction; the budget is 16 ms. |
| 2026-10-22 | Block actions: turn into, colours, highlights | Left out of the block set on request; selecting blocks came first. | After M2, or when asked. |
| 2026-10-22 | Math blocks | Left out of the block set on request. | When asked. |
| 2026-10-22 | Queries: saved, rule-based lists of pages | Left out of M2 on request. Lists of a type, a tag, a relation or backlinks, with sort and group, cover most uses. | A list someone needs can't be built without a saved rule. |
| 2026-10-22 | Block references (`((`) and tags on single blocks | Every block needs a lasting id, and editing one block in several pages at once is the hardest part of ProseMirror. | After M2's links and backlinks ship. |
| 2026-10-22 | Images, web links, PDFs and audio as pages | They fit the page model as pages whose main property is the file or link, but each needs its own preview, fetch or reader work. | After M2. |
| 2026-10-22 | Graph view | Needs the links table first, and shows little until there are many links. | After M2, when asked. |
| 2026-10-22 | Side-by-side pages kept after a reload or restart | Asked for the simplest form; a reload opens one page, as before. | Someone misses their layout after a restart. |
| 2026-10-22 | Splitting, moving or resizing panes from the keyboard or a menu, and dropping on a page's middle | Dragging covers the ask; Shipyard's swap-on-middle and split commands were left out, and dividers can't take focus. | When asked, or with the command palette. |
| 2026-10-22 | Editing a page where it is embedded | An embed is read-only: two editors on one page need shared editing state, as below. Its title opens the page itself. | With one page open in two places. |
| 2026-10-22 | One page open in two places at once | Two editors on one page need shared editing state. Capacities doesn't allow it either. | When asked. |
| 2026-10-22 | Stickers as page icons and in pages | Waiting to hear what "stickers" should be; a free set like Microsoft's 3D emoji is the guess. | When that's settled. |
| 2026-10-22 | Unsplash covers | Needs an Unsplash developer key, and Unsplash photos must load from Unsplash, so they won't show offline. | When there's a key and offline covers are accepted. |
| 2026-10-22 | Emoji skin tones | Not asked for; every emoji shows in its default tone. | When asked. |
| 2026-10-22 | Editing values inside lists, and dragging cards between board columns | Lists show values; changing one opens the page. Editing in cells means a second editor for every kind. | Someone fills in many pages of a type at once. |
| 2026-10-22 | Starting a page from a template with a slash command | "New" with its template menu covers it; the slash menu would need to create and link in one step. | When asked. |
| 2026-10-22 | Editing a two-way relation from the other side | The other side shows the linked pages read only; adding one there would write to another page. | When asked. |
| 2026-10-22 | Deleting a property everywhere | Removing it from a page or a type covers tidying up, and its values stay stored either way. | Someone wants unused properties gone from the "Add property" list. |
| 2026-10-22 | Mermaid diagrams in code blocks | A large extra dependency for a niche use. | When asked. |
| 2026-10-22 | Highlight blocks from reading integrations | There are no integrations to bring highlights in. | When an integration is built. |
| 2026-10-22 | Width options for columns and groups | Equal widths cover the common case. | When asked. |
| 2026-10-22 | Drag-to-resize sidebar | sidebar-08 has a fixed 256 px sidebar; dropped when we moved to it. | When asked. |
| 2026-10-22 | Chromium drops a media block's selection when it sits between two media blocks | The Mac app (WebKit) keeps it. Chromium has no caret spot between two non-editable blocks, so on page refocus it moves the caret to the page start. Only DevTools-driven input (the QA harness) triggers it reliably. A fix exists (about 30 lines plus a test, uncommitted in the worktree `.claude/worktrees/agent-a9523810594569085` of the main checkout), but it rests on a timing guess. | We ship a Chromium-based build, such as Windows, where Tauri uses WebView2. |
| 2026-10-22 | A file card that shows its file is missing | Images, video and audio learn this for free from a failed load; a file card would need a disk check per card. In the app, clicking a card whose file was moved or deleted does nothing. | Someone hits a dead file card. |
