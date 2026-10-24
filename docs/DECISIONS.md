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
skipped where the webview has no cookieStore. The sidebar starts at sidebar-08's 256 px and
can be dragged from 200 to 400 px by its edge, the gap before the first card. In the app its
button sits beside the traffic lights, as in the Claude app, so it never moves.
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
app holds no key and the subscription pays. Each turn, Rust spawns that binary as `claude -p`
speaking stream-json both ways, resumed for follow-ups, with our system prompt and an empty
settings list, and drops any API key from the child's environment so the sign-in wins (as
synara does). The page tools (read, search, edit, insert, rewrite, create) are an MCP server
the webview answers over Claude Code's control protocol, the way the Agent SDK serves
in-process tools; approvals come back the same way. So Rust only pipes lines, and every change
goes through the page's open editor. A process per turn rather than synara's long-lived one
keeps nothing to leak or fall out of step. Access maps to Claude Code's permission modes:
Ask for approval is `default`, Approve for me is `auto`, Full access is `bypassPermissions`,
Plan mode is `plan`. Reading never asks. The browser build has a stand-in that plays the same
protocol, so the panel and the tools can be tried and tested without Claude Code.
Anthropic's terms allow this for one's own login; shipping it to others would need their approval.

GPT models go through Codex the same way: each turn is one `codex app-server`, resuming its
thread, with the page tools passed as the app server's dynamic tools, which Codex asks the app
to run. So the app gates GPT's page changes itself. The person's Codex MCP servers, hooks,
plugins and shell are switched off for these threads, which keeps them quick and on the notes.
A thread keeps a session for each provider, so switching models and back continues both.

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

## 10. Asking happens by the words; agents are Claude Code's agent files

Selected words get a small bar beside them, after Shipyard's selection actions: a one-line
field that sends at once, and Quote in reply for a longer question in the panel. The panel's
field is COSS's composer laid out after synara's: `@` mentions an agent or another page, `/`
offers things to do with the words, and access, model and effort sit in its footer. Agents are not a
new format: they are Claude Code's agent files (name, description and model in the front
matter, the prompt below), read from `~/.claude/agents` and the app's own agents folder, plus
three that ship with the app. A mentioned agent's model wins for that question. Mentions sit
inline as tokens, as in synara; COSS's composer does that without our own rich-text field.

Claude Code keeps a session's first system prompt and ignores a new one on `--resume`. So
the system prompt holds only the fixed role, and everything that can change between
questions travels in the question itself: the note's text, a mentioned page's text and a
mentioned agent's instructions, each sent again only when it has changed since the thread
last saw it.

The panel is pinned beside the pages by default, a card of their kind, so it never sits on the
words. Unpinned, it floats and snaps to a corner rather than going anywhere, so the page under it
knows where it is and moves its words aside; a top corner starts under the header band.
Pinned, it takes only what the pages beside it don't need (520 px each, 832 with sidenotes);
with less than its 280 px left it floats until there is room, still pinned in the settings,
rather than folding the sidebar for it.

## 11. Sidenotes, thoughts and essays are linked pages

A sidenote's anchor is a `note` mark in the page; its text is a `thought` block in the page's
Thoughts page, so all raw thoughts on a page can be read in one place. An essay is a page too.
The links live in `properties`: the source keeps `thoughts` and `essay` ids, and each child keeps
`parent` and `role`. Text quoted into an essay gets a `cited` mark, and the essay a `cite` chip;
both point at each other with `ll:<page id>#<anchor id>` hrefs, which the app opens itself.
As with links (9), what can't fall out of step is derived: quoted words show as quoted only
while the essay holds their quote, and noted words as noted only while their thought exists.

## 12. Writing tools only decorate, and run on this Mac

Focus mode, Syntax highlight and Style check, after iA Writer, are ProseMirror decorations: they
never enter the page, so nothing stored changes and turning one off leaves no trace. Parts of
speech come from compromise (MIT, English, about 120 kB gzipped), loaded the first time Syntax is
on; no text leaves the Mac. Two choices keep typing within a frame on long pages: edited blocks
are checked again after a 0.4 s pause, not on every key, and Focus mode marks the one top-level
block being written and lets CSS dim the rest, rather than dimming every other block.

Grammar and spelling come from Harper (Apache-2.0), a checker that runs on the device, in a web
worker. It adds about 20 MB to the app, chosen over a few home-made rules because those only catch
slips. Counts beside the page's name count everything, marks shown or not, so the tagger and Harper
load whenever Counts is on. Each block's findings are kept per block node, which an edit leaves
alone unless it touched that block, so counting a long page only redoes what changed.

## 13. The command-line tools are asked, not their secrets read

Claude Code and Codex are found as the person's Terminal finds them: the login shell's PATH,
read once, before the usual install places, so the app updates the copy they actually use. How
each was installed is read from where its file really is, and decides the update command, after
synara: `claude update` for Claude's own installer, npm pinned to that install's prefix, or
`brew upgrade`. Newer versions are looked up where that install updates from (npm, Homebrew);
Claude's own installer updates itself, so it gets a button but never a prompt.
How much of each plan is left comes from the tools themselves: Claude Code's `get_usage` control
request and Codex's app server (`account/rateLimits/read`). synara reads the OAuth tokens from
the Keychain and `~/.codex/auth.json` and calls the usage endpoints; asking the tools means the
app never touches a sign-in secret or refreshes one, for about a second of process start per check.

## 14. Idea capture: a non-activating panel; the box is a view, saving runs in the main window

⌃⌥I must open a box over whatever app is in front without pulling LeadingLight forward, and
closing it must give the keyboard back. A second Tauri window can't do that: showing or
focusing one activates the app, which brings every window of ours to the front. So the capture
window is turned into an `NSPanel` with the non-activating style (`tauri-nspanel`), as
Spotlight, Alfred and Raycast do. A spike proved it against AppKit's own answers: with another
app's window above ours, showing the panel made it the key window while that app stayed
frontmost (menu bar and all), the main window kept its depth in the window stack, and hiding
the panel left the app inactive, the keyboard back in the other app. `NSApp.isActive` reads
true while the panel is key; that is the key-window flag only.

The box's webview is a view and nothing more: it sends what was typed to the main window and
hears back when it is saved. Saving runs in the main window, where the space, the open panes
and `editPage` live, so a daily note open in a pane gets its new line through its own editor
(see 9) and every list already knows the new page. In a browser the same box sits inside the
window and calls the same code directly. For that the main window must exist, so closing it
hides it and the Dock icon brings it back; only Quit ends the app. Transparent windows need
Tauri's `macos-private-api`, which the box's rounded corners rely on. macOS's own window shadow
rings a transparent window with a dark line, so the panel has none and the box draws its own,
in a window a little larger than the box.

The box's body is the block editor itself, not a plain field. In the panel the editor draws
"@" from the panel's own copy of the space, read from the store each time the box shows; the
pages its link menu and project picker make are made by the main window on its behalf, so
there is still one writer and nothing is made twice. Every captured idea is tagged
`in-the-middle`, a tag page made the first time, so a list of what came in on the fly is one
click away.

An idea is not written into the day's note. It shows there because it was made that day
("Created this day"), like any page, so a busy day's note stays the person's own writing.
Bullets an older build added are left alone. ⌘↩ saves and closes; ⇧⌘↩ opens the idea beside
the page in view, never in its place.

## 15. Changed shortcuts are written into the table, kept on this Mac

Settings › Shortcuts can change any key in `lib/shortcuts.json`. Only the changed ones are kept
(localStorage, `ll.shortcuts`), so a new default in the table still reaches the rest. At load
they are written into the table's own objects, which Shipyard's sheet and `keysFor` read, so
its files stay as they are. The key handler, the Mac menu bar (each item's accelerator, set by
`shortcuts_set` in `lib.rs`; `menu.rs` is still Shipyard's) and the global New idea key all
follow. In the Mac app a menu key wins over the editor's, so a key macOS or the editor uses is
refused by name, as is one another shortcut has. While a key is being recorded the menu bar and
the global key are emptied, or ⌘N would make a page instead of being recorded. The sidebar's
own ⌘\ listener in `packages/ui` is gone; the table's handler toggles it like any other key.

## 16. A day not yet written in is a draft

Opening a day (Today, the arrows, the calendar) shows a page that lives only in memory, under
the id it will keep. Its first save stores it (`storeDraft` in `lib/space.ts`), so browsing never
leaves empty notes in Daily notes, and the open editor carries on with nothing remounted. Linking
a day (the "@" menu) stores it at once, its open draft included, so a day is never stored twice.

## 17. Tasks are a type; the checkbox comes from the Done property

A task is a page of the starter type Task, not a tag, because it carries a state, a due date
and a project, which a tag can't. A line link gets a checkbox when its page's type has the
`done` property, rather than when the type is Task, so no type is written into the code (8)
and any type can be ticked off. Ticking writes the page through its open editor (9).

Starter additions reach spaces made before them once: each brings a property of its own, and
a space without that property hasn't had it. Properties can't be deleted, so a type the
person deleted doesn't come back.

## 18. Project agents run in our own pinned berthd; the app is its client

Project chats need agents that keep working while the window is closed, ask and get answers,
and can be resumed. Shipyard's berthd already does this with Claude Code's stream-json and
Codex's app server, under an agent host that outlives berthd. So the app starts its own berthd,
built from Shipyard at a pinned commit with a short patch series (`runtime/shipyard`), with its
own state folder, socket and tmux server, and talks to it as a client. It does not mount
Shipyard's chat. berthd owns the agent processes, their pending questions and approvals, turns,
history, worktrees, browsers and runs. LeadingLight owns the project page's binding to a folder
and the outputs the person keeps. Native session and request IDs stay opaque. Note chats keep
their own runner (7).

A probe on 2026-10-24 (`pnpm runtime:probe`) launched, answered, approved, restarted and resumed
both agents. What it found was patched rather than worked around: berthd would share the
person's tmux server and rewrite their agent hooks on start; the person's Codex auto-review
approved requests unseen, and Codex's questions needed its plan mode; a resumed agent could go
unfollowed, meet "Not initialized", lose its model, or meet its old host still closing. Each fix
was a few lines (about 90 in all), so Shipyard stays the owner
and Paseo's daemon, the fallback, is not needed. Answers are still not keyed by request or
lifecycle and a second click is refused rather than given its receipt; that is slice 4a (done:
each request is named by its process and the agent's id, and answered by command id once).

A plain folder is its own one workspace in the runtime (a patch), so its sessions, ports and
browser work as a checkout's do, without git init. The runtime takes ports from a range of its
own, puts its own berthd first on its agents' PATH, and keeps the browser's downloads and long
snapshots in its state, never in the person's folder.

A project chat runs Claude Code, or Codex for a GPT model, and keeps that agent and model once
started (the runtime can't change a running session's model yet). Access maps to each agent's own
modes: Claude's default, auto and bypassPermissions; Codex's untrusted (asks before each command),
default (works freely inside the folder, asks before leaving it) and bypassPermissions. Access and
Plan mode change a started chat's session; a new chat's choices are its own, not Settings › AI's.
