# Decisions

Short records of choices that are expensive to reverse. Newest last.

## 1. Editor engine: TipTap v3 (ProseMirror) with our own block UI

We want Notion-style block editing that feels like ours and stays fast. BlockNote
gave us the engine and the look in one package; we did not like the look, and its
UI is hard to reshape. Writing a contenteditable engine from scratch is where
undo, IME input, cross-block selection and paste go wrong for months.

So: ProseMirror through TipTap is the engine. Everything the user sees and touches
is ours: block model and schema, slash menu, selection toolbar, block handle,
styles. Documents are stored as ProseMirror JSON.

## 2. UI kit: COSS UI, used as shipped; lucide icons; system font

COSS UI (shadcn-style components on Base UI, https://coss.com/ui/docs/get-started) is
the one kit. Every control is a COSS component, composed with Base UI's `render` prop,
so radii, borders, shadows and icon sizes match by construction. The app root has
`isolate` and the body `relative`, as COSS's styling guide asks for Base UI portals.
Lucide stays as the one icon set because COSS uses it. The system font (SF Pro on macOS)
replaces Inter as the first choice so the app reads as native; COSS allows custom fonts.

## 3. Storage: SQLite in the app, IndexedDB in the browser

Notes live in SQLite through `tauri-plugin-sql`. The schema is object-first
(`object_types` + `objects` with a JSON `properties` column) so Capacities-style
types arrive as migrations, not rewrites. In a plain browser (dev and QA) the same
store interface is backed by IndexedDB, one record per page; localStorage capped all
pages together near 5 MB, so one big image stopped every save. Pages from the
localStorage build move over once. Nothing in the app knows which store it is.

Saves wait 500 ms after the last edit, then flush early on blur, hide, ⌘S and window
close. ⌘Q closes the window rather than ending the app at once, so it saves too. A
browser save is one committed write with no read first, because a read's answer never
comes back while the page unloads. A failed save shows a toast; the text stays.
Pages from the BlockNote build are converted to the current shape when read. A page holding
blocks this version doesn't know opens read-only, showing what it can, and its body is never
saved from the editor, so an older build can't wipe a newer page.

## 4. Testing: Gherkin is the contract, QA runs in the Berth browser

`features/*.feature` describe behavior before it is built. A QA subagent drives the
browser build in the worktree's Berth agent browser and reports; the user can watch
it live in Shipyard. Playwright headless covers the smoke, the gallery and regression
specs. Nothing drives the native window.

## 5. Window: overlay title bar, sidebar-08 layout

On macOS the title bar is an overlay with the traffic lights inset, so the sidebar
runs to the top edge like Notes or Craft. The shell is shadcn's sidebar-08 block
(sidebar plus an inset, rounded page panel), using the official Base UI version's
higher-order files (app-sidebar, nav-projects, the page layout) on COSS's primitives.
Installing the block itself would replace COSS's primitives with shadcn's. Two marked edits to
COSS's sidebar: ⌘\ toggles it (⌘B is bold in the editor), and the cookie write is
skipped where the webview has no cookieStore. The sidebar is fixed at 256 px, like
sidebar-08; drag-to-resize was dropped with the switch.
Each open page is its own card in the inset's place, with the inset's look and its own
header, 8 px apart, so pages side by side read as separate pages rather than one split
panel. The page column starts at the left, not centred.

Native-only behaviour (SQLite, files, traffic-light room) checks the app identifier,
not just for Tauri, because Shipyard's preview pane is also a Tauri webview.

The traffic lights are centred on the page panel's header line, 26 pt down as in Apple Notes,
with the header 36 px tall (sidebar-08's 64 px left too much empty bar above the lights).
AppKit puts a light's centre 2 px above `trafficLightPosition.y`, measured offscreen, so y is 28.

## 6. Shipyard is vendored, verbatim, and synced from upstream

Shipyard (cosscom/shipyard, MIT) is the same stack as ours (Tauri 2, React 19, COSS UI)
and has themes, Settings, a type scale and grid, a shortcuts table with a Mac menu bar,
and an agent conversation UI we want. Rewriting them would cost months and lose the
fixes upstream keeps shipping. So its `app/src`, scripts, perf and plugin sources live
under `vendor/shipyard` unchanged, mirroring upstream's paths; `UPSTREAM.json` records
the commit and `scripts/sync-shipyard.sh` applies upstream's diff with a 3-way merge.
Nothing in there is edited: our code imports it (`@/` is the vendored tree's alias, `~/`
is ours) and overrides by alias (the shortcuts table, the theme palettes in
`packages/themes`) or CSS. Its `index.css` is the
Tailwind root, with the system font put back after it. The agent code runs on its mock
fixtures (`__BERTH_DEMO__`) until LeadingLight has an agent backend. What was chosen to
wire in, and what was left out, is in `docs/SHIPYARD.md`.

## 7. Claude through the Claude Code on this Mac, driven as a subprocess

The AI answers through the Claude Code the person installed and signed into, so the
app holds no key and the subscription pays. Rust spawns that binary as `claude -p`
speaking stream-json, with no tools, our own system prompt and an empty settings
list, and drops any API key from the child's environment so the sign-in wins (synara
does the same through the Agent SDK). The SDK is a typed wrapper over this very
protocol; using it in a Tauri app would mean shipping a JavaScript runtime as a
sidecar, so the protocol is spoken directly. The browser build has a stand-in that
streams a fixed answer, so the panel can be tried and tested without Claude Code.
Anthropic's terms allow this for one's own login; shipping it to others would need
their approval.

## 8. One kind of object; types and properties are data

Capacities builds its basic types into the app and gives each custom type its own
properties. A plain page can have none, and a single page can't have one of its own. We keep
one kind of object, the page. A type is a bundle the user edits, and any page can add any
property beyond its type's. Property definitions are shared by the whole space, as in
Obsidian, so lists can sort and group across types. Tags, collections and daily notes are
pages with a type and a relation, not special code. No saved queries.

## 9. Links are ids in the body; backlinks are a search

A link stores only the page's id, so it follows renames and icon changes. Backlinks are found by
searching stored pages for that id rather than kept in a links table, so nothing can fall out of
step. A change to another page (linking a mention, merging a tag) goes through that page's editor
when it is open, so its pane never saves its own copy over the change. Every page's summary and
properties stay in memory, which is what lists, cards and the link menu read.
