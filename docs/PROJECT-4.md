# Project 4 — The bar, tabs, and quick capture

2026-10-27. Follows Project 3 (Tail). The user authorized implementation, developer-owned QA, merge and
install. Contracts: `features/bar.feature`, `features/suggestions.feature`, `features/quick-capture.feature`,
`features/tabs.feature`. Why: DECISIONS 30 (written with the last slice).

## The experience

A slim strip at the right edge holds what wants a glance: Suggestions, Feed, Captures, Ask, and Quick
capture at the bottom. Each opens a panel beside the strip; a count sits on an icon only when something
waits. Tail's offers live in the Suggestions panel, read when a block is finished, and never move the
text. Pages open in tabs that can be reordered and dragged between panes, and each tab remembers where it
has been. One box takes an idea, a web address or a recording from anywhere on the Mac.

## Build on what shipped

- Panes (`lib/panes.ts`, `components/pane-area.tsx`, `pane-drag.tsx`): the split, the drop preview, the
  focused page. Tabs are a layer inside a pane; the split stays the split.
- The Feed (`lib/feed.ts`, `components/feed.tsx`), the capture inbox (main's `e30003e`), the agent panel
  (`components/agent-panel.tsx`, `thread-view.tsx`, `composer.tsx`): each becomes a panel of the bar, its
  logic untouched, its mounting moved.
- Tail (`lib/tail.ts`, `lib/tail-prompt.ts`, `lib/tail-memory.ts`, `components/tail.tsx`): the rows, the
  nod and Undo, the ledger, the beat. The chip and its placement go; the triggers change; a fingerprint
  per block wording is new.
- The capture box and panel (`components/capture-box.tsx`, `lib/capture.ts`, `src/capture.tsx`,
  `src-tauri/src/capture.rs`), Save webpage (`lib/web-source.ts`, `components/save-webpage.tsx`), voice
  (`src-tauri/src/voice.rs`, the voice block).
- Shortcuts (`lib/shortcuts.json`, DECISIONS 15): every new key goes in the table.

## Contracts and boundaries

**The strip.** 40 px, the window's right edge, always visible in the Mac app and the browser build.
Icons 16 px lucide in 32 px buttons; one hairline on its left; nothing else drawn. Counts are small
numbers, only when something waits, never on Ask or Quick capture. The panel is 320 px, resizable 280
to 480 by its edge, and pushes the page column; it never overlays words. Below 1000 px the panel is a
pane beside the page, as the Feed was. The Feed lane, the pinned and floating Ask card, and the sidebar
rows New idea, Save webpage and Capture inbox are removed, with their settings.

**Following.** A page coming to the front that has suggestions switches an unpinned panel to
Suggestions; a pinned panel stays. Nothing else switches the panel.

**Suggestions.** Tail reads a block on Enter at its end, on a full stop plus N1 seconds of quiet, or
after N2 seconds of quiet, with N1 = 10 and N2 = 20 by default and both in Settings › AI › Tail. A block
is sent once per wording: the app keeps a fingerprint of each block's words it has sent, per page, and a
block whose words match is never sent again. One turn in flight per page; a block finished meanwhile
waits and goes only if still new. The digest carries the block, its neighbours and the page's summary;
the index of titles once per page thread and then only changes. An offer raises the Suggestions count;
opening the panel marks its rows seen. Rows light their words on hover or selection and nod in place.
No chip of any kind in the text. Today keeps its rows and gains the daily card.

**Tabs.** A pane holds tabs; the tab row shows only with two or more. Click opens in the tab, ⌘-click a
new tab, Shift-click a new pane as now. Drag reorders, drag to another pane moves, drag to an edge
splits. Each tab has its own back and forward history; ⌘[ and ⌘] and two chevrons in the header. ⌘T,
⌘W, ⇧⌘T, ⌃Tab and ⌃⇧Tab as a browser. Panes, tabs, order and the active tab are restored on launch.
Every key checked against the editor's taken list.

**Quick capture.** One global key, ⌃⌥I, and the strip's bottom button. The box's header reads New idea or
Webpage by what the words are; the mic records. Saved things land in Captures with the review tick.

## Small delivery sequence

| Slice | User-visible result | Required behavior to prove |
|---|---|---|
| 1. Tabs and history | Pages in tabs, reorderable, with back and forward | tabs.feature in full; panes.feature still passes; restore on launch |
| 2. The bar shell | The strip with Feed, Captures and Ask as panels, with counts and pin | bar.feature in full; feed.feature, ask.feature and the inbox's scenarios still pass in the bar |
| 3. Suggestions | Tail's offers in the panel, read on finished blocks, never sent twice | suggestions.feature in full; tail.feature updated (chips gone); the stand-in's log proves the fingerprints |
| 4. Quick capture | One box for ideas, addresses and recordings, from anywhere | quick-capture.feature in full; capture.feature, web-sources.feature and voice.feature still pass |

Slices 1 and 2 run in parallel in their own worktrees; 3 and 4 follow 2. Gherkin first; typecheck; one
smoke; QA by a Sonnet subagent in the browser; the native parts (⌃⌥I, the panel, the menu keys) in the
installed app by the person.

## Acceptance and closeout

In the browser: every scenario of the four files, then the earlier files they touch. In the installed
app: a day of use. Then the closeout in CLAUDE.md step 8.
