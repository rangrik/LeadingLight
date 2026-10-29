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
hears back when it is saved, and what tail guesses of it. Saving runs in the main window, where the space, the open panes
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

The same box takes a lone web address as a webpage (27), fetched and saved by the main window,
and its mic adds a voice block to the body. The recording runs in the panel's own webview, since
audio only needs the asset store; hiding the panel drops the box, so a recording never runs unseen.

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

The runtime keeps its own things out of the person's folders: a chat's own-branch worktree, its
attachments and each file an agent wrote, kept as the write left it, all live in the runtime's state.
Each agent has a browser tab of its own (its session's name), and a public site opens only once the
person allows it. Agents are told, in one paragraph of their instructions, how to hand work to a
worker, keep one at a check, and use the browser; Shipyard's sessions, notifications and durable
runs do the rest, and a worker started by an agent with full access gets it too. A restart loses no
send: the turn ledger is written before berthd exits.

Since 2026-10-28, Quit stops the runtime when no agent is in a turn and no run is active, since
nothing should keep running for no reason; a turn or run going keeps it, and agents wait in tmux.


## 19. A project's agents reach LeadingLight through the runtime, as tools

A project's agents read its pages and publish to them with LeadingLight's own MCP tools
(`berthd mcp leadinglight`, runtime patch 0030), which the runtime gives every Claude and Codex
session it starts, allowed without asking. A call goes to berthd, which finds the calling session
from the process on the socket's other end (the kernel's word, not the agent's) and hands the call
to the app, which answers from its store: the session's folder names the project, its conversation
the agent. Reads need the app open and say so when it isn't. Writes are kept in the runtime's state
first, with any evidence files copied as they are, and offered to the app until it answers, so one
made while the app is quit appears when it next opens, once.

An agent reads the project page and what it reaches through links a few steps out, never through a
tag or a daily note, which nearly every page shares. Sidenotes are private unless sent as feedback.
The tools add and never change: there is no edit or delete.

## 20. An agent's report is its own page, beside the page it is about

What an agent publishes is a new page of the system type Report (`lib/work.ts`), linked to the page
it is about as its parent, and shown after that page's words, signed and dated. Its agent is an
Agent page, one per runtime conversation, so authorship is a link the person can follow. Nothing
an agent publishes goes into the page's own body, so the person's open editor, its unsaved words,
its cursor and its scroll never meet it, and no autosave can write over either. A report never
changes once published: its page opens read-only, Ask won't change it, and the agent has no tool
that edits or deletes. A correction is a new report. Each publish carries the runtime's call id,
so a retry or a call offered again finds the report it made rather than making another. Agent and
Report are found by type id and marked as made by the app, so New never offers them and a renamed
type keeps working.

Evidence is files, not links to them: the runtime copies each file a publish names (from the
agent's folder or its kept outputs, so a shell command's output counts) when the call is made, and
the app stores it as any page's image or file, inside the report. Its content's hash names the
version reviewed; the folder changing or being cleaned up later leaves it as published. A file that
can't be kept refuses the publish at once, so a report never shows a hole.

## 21. Assigning work starts one agent, named after its Agent page

Assign is the only way work starts: a mention never does. Assigning a task makes its Agent page and
links the task to it before the runtime is asked for anything, and the runtime session is named after
that page. So a second press, a reload or a restart in between finds the conversation by that name
and records it, rather than starting another; one never made is started then. A page that isn't a
task is assigned through a task made for it once, linked to the page and its project. A task is any
type with Done, so a space's own task types work unchanged; assigning adds only a link on the task.
The brief the agent gets is the task as written when it starts.

## 22. A task's state comes from the runtime; only the person marks it done

An assigned task reads Working, Needs your input, Ready for review, Idle or Stopped from the runtime's
sessions for its agent and that agent's workers, the work it waits to hear back from, and its agent's
own last report. Ready for review means the agent given the task published with ready; a worker's
report is read like any other but changes nothing. Done is the task's Done, which only the person sets:
an agent's task tool ticks only subtasks its own team made, and refuses the task it was given.

What the agent says it is doing and its checklist live on its Agent page and change in place; a
count shows only for steps it listed, never a percentage. Workers become Agent pages under the agent
that started them, so they stay listed after the runtime forgets them. The panel under the title
opens its checklist only on a click, and where the browser doesn't anchor scrolling the panel makes
up for its own growth, so updates never move the words being read.

## 23. The Feed is made from the records, not stored

The Feed keeps no items of its own. It follows every Agent page's conversation as an open chat does
(without reading replies as they are written), and lists that conversation's pending requests, tasks
whose agent says they are ready, and agents that stopped short. So an item is one per request or
report, the same after any reconnect, and goes when its record settles. A question is answered
through the chat's own answer path, by the runtime's request id and a command id, so answering it in
the Feed settles the chat's card and the same answer can't be given twice. What a question is about
comes from the agent's context tool, kept on its Agent page and matched by the question's words;
without it, the task stands in and the item says so. Opening it reuses one pane beside the page being
read, so that page stays where it was; a narrow window shows the Feed as a pane instead of a lane.

## 24. Feedback is chosen sidenotes, frozen into one batch, sent once to the task's own agent

A report's words can't change, but it takes sidenotes like any page: its editor drops every change
but adding or taking off a note's mark. On a page whose task has an agent, each note can be ticked
for sending; what is ticked is kept on this Mac per task until sent. Send freezes the ticked notes,
each with the words it is about and its block, and an overall comment, into a Feedback page under
the task, then sends it to that agent's own conversation with the batch's command id as the
message key, so a retry after a lost answer is the same message. A conversation that is gone fails
the send and says so; it never goes to another agent. A note becomes readable to agents only once
sent; the rest stay private.

## 25. A response answers every point of its batch, or says it doesn't

An agent answers a batch with one publish naming the batch. The app builds the response's parts
itself, one per point of the frozen batch: the words the point was about, linked to the note where
it was written and to the batch as sent, then the agent's answer or why there is none. A point the
agent leaves out reads "Not answered", the byline counts what was answered, and the response can't
make the task ready. An answer to another agent's batch, or to a point the batch doesn't have, is
refused. Links use the app's own ll: addresses, which the editor keeps and, in a report, opens on a
plain click. The old notes are done once sent: nothing to close, and the batch keeps what each was
about if the words go.

## 26. Accepting is the person's press, and later work never undoes it

An assigned task is done when the person accepts it, which ticks Done and keeps which report it was
accepted on and when. Done comes first in the task's state, so a report, a worker or a late event
after it changes nothing; what arrives later is shown as new on the task and in the Feed. Unticking
Done reopens it, also only by the person. A task no agent was given keeps its checkbox as before.

## 27. Web sources are saved pages; recordings keep audio before transcription

Save webpage creates an ordinary page with its source address and capture date. Link-only never
fetches the website. Copies become known editor blocks, never live website HTML; downloadable
media uses the existing asset store. Native downloads are bounded, anonymous HTTP requests.

Voice blocks save audio through the same asset store before transcribing. A bundled Swift helper
uses Apple's SpeechAnalyzer on macOS 26+, following MacBud's approach. Recognition stays on the
Mac; Apple may download its speech model. Failed recognition keeps the audio and offers retry.

## 28. Captures stay pages; review state is metadata

The inbox reads capture kind, date and reviewed date from page properties. Reviewing never
moves or deletes a page. Older captures are recognized by their source fields or capture tag;
older saved recordings are discovered once per session. Property changes persist before the
open page is told, so failed saves do not remove a capture from view.

## 29. Tail offers one line; it reads by trigger and remembers in the open

Tail (`docs/TAIL.md`) is a watcher, not a third agent system. It guesses what the person meant
and offers one line with one verb; the nod runs through what exists: a page's open editor (9),
a new page, a property, or Assign (21). So every result stays inside rules already trusted and
the build stays small. It never asks a question: a question costs attention, which is the one
thing it must not spend. It speaks only at a pause, a page opening, a return or a new day, after
Horvitz's rule that an agent acts only when the value beats the cost of interrupting; silence is
the common case, as in heartbeat agents. Lines expire so nothing piles up.

Nothing moves: Today's rows come at open, a page's row sits in the band above the title where
the hover controls already live, and the chip is placed with the sidenote math (11) without the
sidenote's room-making. A chip with no margin room sits after its line's last words, as a
sidenote's number does, or else in the row above the title, rather than narrowing the text.

Context is scoped by the trigger with a budget each, not a dump of the space: the block and the
index for a chip, a digest of changes for the beat, bodies only of what changed and only once per
thread. Sidenotes and pages reached through a tag or a daily note are never read (19), and a
per-type Reads on, after Writing's Use on, is the person's control over what the beat may see,
since the beat reads pages they did not point at.

Memory is three plain things on this Mac: a nod ledger that quiets a kind after three ignores, a
page in sentences about how the person works that tail rewrites and the person can edit, and
short-lived threads. The page is a page because the tool's picture of the person must be theirs
to read and correct, never a hidden profile.

The model is GPT-6.1 Sol at high through the Codex app server, the GPT path Ask already has (7),
with Claude as the switch. The surfaces were built first with word rules in place of the model,
on the branch `worktree-tail-design`, so the feel was judged before anything was spent on it.

## Unsplash covers use a shared service

People should not need a developer account to choose a cover. A small Vercel
Function holds the key, caches searches, and reports selections with signed
tokens. Only its URL ships in the app. Notes stay local and photos load from
Unsplash. Forks can point to their own service with `VITE_IMAGE_SERVICE_URL`.

## GitHub releases are prepared in a PR, then built before publication

Release Please keeps one version across Cargo, Tauri and the desktop package, with
notes from conventional commits. Merging its PR creates a draft; GitHub Actions
checks and builds that exact commit, verifies helpers and licenses, and uploads
downloads before publishing. Failed builds stay drafts and can be retried by tag.
The first distribution is an unsigned Apple Silicon preview, matching the runtime
we can build today. No personal token or signing secret is needed for that path.

## 30. One bar for what wants a glance; tabs inside panes; one box for capture

Agent asks, captures to review, tail's offers and the Ask thread were four surfaces: a lane on the
left, a sidebar row, chips in the text and a card on the right. They are now panels of one strip at
the window's right edge, after the activity bar of code editors rather than Xcode's inspector tabs,
because the person works that way all day. A count sits on an icon only when something waits, so
the strip never pulls the eye for nothing. Tail's offers moved out of the text into the Suggestions
panel: a chip at the line was the right moment but the wrong place to find again, and real use
showed offers going unseen or counted as a no. Tail now reads a block when it is finished, on Enter
or after a full stop and a short quiet, and keeps a fingerprint per wording so nothing is sent twice;
the count rises quietly and the text never moves. Today keeps its rows and gets a once-a-day card for
what earlier days left, with Dismiss all as the pressure valve that keeps a persistent list from
becoming a pile.

Tabs are a layer inside a pane, not a new window model: the split stays the split, a tab keeps its
own back and forward, and the row shows only with two or more tabs so one page looks as it did.
Panes, tabs and the active tab are restored on launch. Quick capture is one box because what comes
in from outside is one habit: words, an address or a voice note all land in Captures, and the box
saves whatever was typed on close so a capture can never be lost.

## 31. The browser shares Chromium with the agent

2026-10-28. Both the person and the agent must operate the same page, including its sign-in and
form state. Extend the bundled MIT Shipyard runtime and its CDP browser, with an additive patch,
instead of introducing a second WebKit browser or an Electron app. The app displays its live
frames and sends input through the existing local runtime transport. Remote website HTML never
enters the notes webview. Agent snapshots, references, screenshots and actions keep working.

Personal tabs use an app-owned persistent profile per workspace; named and unnamed agent tabs
stay isolated. A legacy command without a tab must not inherit personal cookies. Explicit tab
names let an agent work on a personal tab when asked. Website content is
untrusted, and the runtime's network restrictions still apply to manual and agent navigation.
Browser metadata lives on this Mac; profiles and downloads never go in the linked project.

The reference is ChatGPT's documented built-in Browser, not an assumption that its private
implementation is available. Research, exclusions and any remaining gaps live in
`docs/BROWSER-RESEARCH.md`; behavior lives in `features/agent-browser.feature`.

Browser opens from the sidebar without requiring a project: its empty workspace is app-owned.
Ask about page attaches the exact tab to one conversation, including a standalone browser chat.
The attachment is visible and removable, stays in memory, and is never inherited by another chat.
Each sent message freezes its tab context; website titles and text are not agent instructions.

Managed Git checkouts can all be named `LeadingLight`. Embedded runtime worktrees in that layout
get stable path suffixes, and the browser chooses the linked checkout's path before git's main
checkout. Ambiguous names fail rather than opening a different workspace.

The native Edit menu needs an explicit bridge: macOS otherwise handles Undo and Select All in
the local input that forwards typing. Only while the browser page has focus, its six Edit actions
target that tab's input queue. Focus tokens prevent a delayed menu event reaching another tab.

Clear browsing data removes only this workspace's personal profile, tabs and local history after
confirmation. It retains bookmarks and downloaded files, and refuses while agent tabs are open.
Native download saving writes bounded chunks to the chosen file so large downloads stay usable
without granting the frontend broad filesystem access.

Element feedback uses explicit selection on the shared page. The runtime keeps an opaque handle
to that element; bounded metadata and the person's comment accompany the exact tab in chat.
Visual previews accept a small list of CSS properties and keep the original inline styles for
Reset. Leaving the feedback panel ends its previews; Ask copies the comment and chosen styles
to chat first. Navigation invalidates selection, so an old preview cannot change a new page.
Picking suppresses activation and typing but permits scrolling. After the feedback panel changes
the viewport, a handle-based reveal keeps the selected element visible without activating it.
Reset restores the original style attribute when safe, while preserving unrelated page changes.

Personal pages follow the pane's size by default; shrinking a desktop screenshot made text too
small beside a chat. Explicit phone/desktop sizes stay fixed, and agent tabs keep the size the
agent chose until the person opts into the pane's size.
Input waits for a frame at the requested size, so a click cannot use old image coordinates after
the runtime has resized the page.
Two views can share one tab. Only the last browser pane used controls that tab's automatic size;
other views fit its frames. Ownership passes on close, avoiding competing resize requests.
The auto/fixed choice also belongs to the tab, so using another pane cannot cancel phone mode.
It stays in app memory, bounded to 256 recent explicit choices; it is not a saved device profile.
Resize requests run in order per tab. Every view pauses input while they run and waits for a
frame at the final size, including views whose state poll has not caught up yet.
Afterward, a fresh state read resumes following the agent's viewport; an older poll cannot
release the input guard, and an agent changing size again cannot leave the view stuck.

Uploads carry the file chooser's identity, not only its tab name. A navigation or a second chooser
invalidates a delayed file choice so it cannot attach to a different form.

Search words open DuckDuckGo's ordinary results URL, which needs no key or new search service.
The local runtime keeps at most 24 live tabs per workspace. Metadata is bounded (200 bookmarks,
500 history entries and 20 closed tabs); file picks allow 20 files and 32 MiB per pick. Clipboard
text is limited to 64 KiB and rejected rather than truncated. These bounds keep local memory and
IPC predictable; native download saving has no fixed file-size cap.

Navigation belongs to the tab's lifetime, not the HTTP control request's timeout. Chromium's
events determine loading and errors, and Stop cancels even a slow link navigation. Permission
notices describe the current tab's blocked requests; the shared proxy's historical refusals
remain diagnostic data rather than prompts on unrelated pages.
Revocation blocks new network requests, not cached page display. The permissions view says so;
removing cached content and sign-ins remains the separate Clear browsing data action.

## 32. Writing review is quiet, local, and chosen

Grammar help defaults to review on request. Inline underlines are optional. Harper provides
actual suggestions; applying one preserves marks, has its own undo step, and refuses stale
text. Keep wording remembers that occurrence for the current page session, not a universal rule.
A text selection bounds the review; Apply pauses on its result until Next suggestion.
Quiet word counts do not start grammar checks.

Short lessons are authored for named rules, with optional practice. Saved tips store rule ids,
not a mistake history. Dictionary words stay on this device. Listening uses only local English
system voices. Neither the checker nor practice assigns a score or claims someone has learned
something. See WRITING-COACH.md for the scenarios and questions to test with the writer.

## iPad uses the same editor and store

The iPad app is a Tauri iOS target of the existing React app. Pages keep the same schema
and TipTap content, with SQLite and files on each device. Native storage and Mac capabilities
are separate checks: an iPad must never start a CLI, reserve traffic-light space, or show a
browser agent stand-in as a real answer.

Attached files use iOS Quick Look through a small native plugin. It accepts only an asset
filename, checks the resolved path stays inside the app's assets, and leaves the file unchanged.

Account sync belongs to the existing cloud work in the “Compare versioning options” chat
(worktree `c7fe`, checked 2026-10-28). Its web service is already deployed; native account
handoff and portable attachments are still pending there. The iPad target does not invent a
second sync service or imply that local Mac data has moved. See `docs/IPAD.md`.
