# What to take from Shipyard

## Status, 2026-10-22

Chosen and done: Shipyard's app source is vendored whole under `vendor/shipyard`
(docs/DECISIONS.md, 6). Wired into the app: the 23 themes (palettes now ours in `packages/themes`, engine
Shipyard's; code-block tokens follow them), Settings in our own shell (our Appearance section; Shortcuts and About on
Shipyard's), text size and zoom,
stillness, the shortcuts table driving the Mac menu bar, and the mock agent
connection. Vendored and building but not mounted: the conversation UI, the agent
plumbing, the perf scripts. Left out on purpose: the standalone demo harness, the
Playwright suite, the Rust agent and browser code, plugins (source only).
What is still open is in `docs/DEFERRED.md`.

Research, 2026-10-22, against cosscom/shipyard at v0.3.30 (commit ea12159), MIT.
Paths below are in that repo. Shipyard is a Tauri 2 + React 19 + COSS UI app, so
its tokens, components and conventions drop into ours with little change.

## 1. Themes: copy as they are

23 themes: 4 of Shipyard's own (Shipyard Dark, Shipyard Light, Midnight, Paper) and
19 ports of VS Code themes (Dracula, One Dark Pro, One Light, Catppuccin Mocha and
Latte, Tokyo Night, Nord, GitHub Dark, Dark Dimmed and Light, Gruvbox Dark and
Light, Solarized Dark and Light, Rosé Pine and Dawn, Night Owl and Light, Kanagawa
Wave). Every one is MIT and already nudged to 4.5:1 text contrast.

Files to copy from `app/src/themes/`:

- `builtin.ts`, `vscode.ts`: the palettes. A `Theme` is `{ id, name, appearance,
  colors, terminal, syntax? }` (`packages/plugin-sdk/src/types.ts:644`).
- `apply.ts`: writes the theme's colours as inline custom properties on `<html>`
  over the COSS tokens, then toggles `.dark` and `color-scheme`. Our
  `packages/ui/src/styles/globals.css` uses the same token names, so no component
  changes.
- `color.ts`, `contrast.ts`, `contrast.test.ts`: WCAG contrast, OKLab distance,
  `readable()`, and a node test that fails the build when a theme's text falls
  under 4.5:1. Add it as `pnpm check:themes`.
- `THIRD_PARTY_THEMES.md`: the upstream notices. MIT asks us to keep them, plus
  Shipyard's own (Copyright 2026 Sean Brydon), in a `THIRD_PARTY_NOTICES.md`.

Changes for us: drop `tones.ts` and the `--wt-*` and `--terminal-background`
variables (worktree and terminal things). Keep the `terminal` palette: map it onto
our code block's highlight.js classes (keyword to magenta, string to green, number
to yellow, title to blue, type to cyan, comment to brightBlack), run each through
`readable()` against the code block's background, and the hardcoded
`--color-violet-700` lines in `packages/editor/src/editor.css` go away. Replace
`useSystemTheme` in `App.tsx` with `useThemes`, `useActiveTheme` and `useApplyTheme`
from `app/src/hooks/use-theme.ts`. Later: user themes as JSON files in the app's
support folder, as Shipyard reads `~/.berth/themes`.

## 2. Appearance settings: copy the content, choose our container

Shipyard's Settings (`app/src/views/settings/`) is a view that takes the sidebar's
place, with a nav of 14 sections and Esc to go back. We need three sections to
start: General, Appearance, AI. Two containers fit a notes app: Shipyard's page
swap, or a COSS Dialog with the nav down its left side, opened with ⌘, (the
Notion, Linear and Capacities shape). Recommendation: the dialog.

Copy regardless of container:

- `rows.tsx`: `SettingsPage`, `SettingsGroup`, `SettingsRow`. A row wires its label
  and description to its control with `aria-labelledby` and `aria-describedby`, so
  a switch reads as "Play a sound, on". Plus `Code` and `Value` chips.
- `controls.tsx`: `Segmented` and `Stepper`. Ours sit on COSS's `segmented-control`
  and `number-field`, which we already have.
- `find.tsx`: "Find a setting", a word index that opens the right section.
- `appearance-section.tsx` and `theme-preview.tsx`: the theme grid. Groups (Ours,
  Light, Dark), a row of four each plus the chosen one, "Show 12 more", a search,
  and a card that draws the theme in its own colours with six dots for the palette.
  Redraw the card as a sidebar beside a page with a heading and two lines, not a
  terminal.

What applies from the section itself:

| Row | Shipyard | Ours |
|---|---|---|
| Light, Dark, Match system | yes | yes |
| Theme by day and when it's dark | yes | yes |
| Text size: Small, Default, Large; ⌘+ ⌘− ⌘0 | root font size, everything in rem | yes, once the editor's 16px becomes rem |
| Density: compact, comfortable | row-height tokens | our sidebar rows and lists |
| Chat width: Narrow to Full | the chat column | Page width, for the 760px editor column |
| Sidebar layout, header picture, chat background | yes | no |

Prefs: `app/src/lib/prefs.ts` is a zustand store saved to localStorage through two
helpers that never throw (`lib/storage.ts`). The same shape serves us: `themeId`,
`systemThemes`, `uiFontSize`, `density`, `pageWidth`.

## 3. Worth stealing beyond the ask

- **A type scale and a layout grid, enforced by script.** `index.css` names every
  text size by role (`text-page-title` to `text-tag`) and every edge by token
  (`h-bar`, `px-edge`, `pl-lane`, `px-page`). `scripts/check-type.mjs` fails on a
  raw `text-sm` or `text-[11px]`; `check-grid.mjs` fails on a pixel gutter or a bar
  of its own height. This is our "one gutter width, one row height" rule as a
  check instead of a reminder. `lib/utils.ts` teaches `cn()` the scale so sizes
  merge with colours.
- **`check-titles.mjs` and `components/tip.tsx`**: no `title=` on anything
  interactive; one Tooltip that shows on hover and on focus.
- **`components/sidebar/ink.ts`**: the sidebar's text and icons as one grey family
  at four strengths, built from the theme's foreground and muted text so it reads
  in every theme.
- **`lib/still.ts` and the reduced-motion block in `index.css`**: animations hold
  still when the window is in the background or macOS asks for less motion.
- **`lib/shortcuts.json`**: one table drives the key handler, the Keyboard
  shortcuts sheet, Settings › Shortcuts and the native menu bar (`src-tauri/src/
  menu.rs`), with a rule never to give ⌘C ⌘V ⌘A ⌘F a menu accelerator. Our ⌘N,
  ⌘S and ⌘\ are hardcoded in `App.tsx`; this is M3's keyboard milestone.
- **Command palette** (`components/command-palette.tsx`): themes are items, and
  arrowing over one previews it live, put back on Esc. For our ⌘K.
- **Playwright specs**: `a11y.spec.ts` (axe over every screen), `grid.spec.ts`,
  `page-gutters.spec.ts`, `look.spec.ts` (a gallery of Settings and themes),
  `motion.spec.ts`.
- **Tauri config**: a real CSP (ours is `null`), `zoomHotkeysEnabled: false` so
  ⌘+ is ours, and `dragDropEnabled: false`. Tauri's own drag handler swallows the
  webview's HTML5 drop events on macOS; nothing in our code handles Tauri's drop
  event, so check that dropping an image works in the native app, not only at
  :1420.
- **Markdown for replies**: `lib/markdown-html.ts` (micromark, GFM, math, HTML
  escaped) and `components/conversation/markdown.tsx` (Copy per code block,
  theme-coloured code). For rendering an AI answer.
- Shipyard's Notes plugin is a textarea saved to a file. Nothing to take.

## 4. Bringing in agents

### What Shipyard does

It never holds an API key. It launches the CLIs the person already signed into:
Claude Code as `claude -p --input-format stream-json --output-format stream-json
--verbose --include-partial-messages --permission-mode <mode>
--permission-prompt-tool stdio`, sending each prompt as a JSON line
`{"type":"user","message":{"role":"user","content":...}}` and reading text deltas,
tool calls and permission requests back (`internal/box/claudedriver.go`); Codex as
`codex app-server` (JSON-RPC over stdio, `codexdriver.go`); OpenCode, Gemini CLI
and Cursor Agent over the Agent Client Protocol (`acpdriver.go`); and `codex
exec` for one-shot generation. A Go "agent host" keeps each process alive in tmux
and logs every event so the app can reconnect. Its design doc
(`design/structured-agents/plan.md`) surveys the field: Vibe Kanban and Sculptor
speak raw stream-json, t3code, Paseo and Superset use the Agent SDK, everyone
drives Codex through app-server.

Two cautions. The host, tmux and reconnect machinery exist because Shipyard's
agents outlive the laptop; a notes app needs none of it. And Anthropic's Agent SDK
page says third-party products may not offer claude.ai login or rate limits without
approval; Shipyard relies on a support article that allows running the person's own
unmodified `claude` binary. Fine for a personal tool, not something to ship.

### Options for us

| | A. Messages API, your key | B. Your installed CLIs | C. Claude Agent SDK | D. ACP |
|---|---|---|---|---|
| Needs | an API key (Anthropic, OpenAI) | `claude` or `codex` signed in | Node sidecar, API key | an ACP agent |
| First token | under a second | 1 to 3 s process start, more without `--bare` | as B | as B |
| Billing | per token | subscription | per token | varies |
| Fit for "ask about this selection" | best | ok | overkill (file tools, agent loop) | no |

Recommendation: A for the feature, with one small interface (`ask(provider,
model, system, messages) -> stream of text`) and two providers behind it, the
official `@anthropic-ai/sdk` and `openai` packages. The call runs on the Rust side
as a Tauri command that streams chunks to the webview over a channel, and the key
lives in the macOS Keychain through the `keyring` crate, so neither ever sits in
the webview. The browser build (QA) gets a fake provider so scenarios run without a
key. B can join later as a third provider ("Use my Claude Code / Codex login")
behind the same interface; the flags above are the recipe. Default model Claude
Opus 5.5 at low effort, with a model picker in Settings › AI.

### The feature: Ask about this

Copy the mechanics of `components/conversation/selection-actions.tsx`: a bar by the
selection with a field "Ask … about this…" and a quiet second action; the CSS
Highlight API keeps the words marked while typing; placed above the first line or
below the last, following scroll, gone on Esc or when the selection goes.
`lib/chat-quote.ts` has `quoted()` for the Markdown quote.

Mobbin's patterns agree: Mistral Le Chat puts "Ask about this" first in the
selection toolbar; Evernote, Strut and Fabric put an AI menu in it; Matter sends the
selection to a notebook on the right; Skiff opens a composer under the selection.

Our shape: a sparkle "Ask" button in `packages/editor/src/selection-toolbar.tsx`,
which swaps the toolbar for a field the way the link editor does. The answer streams
into a side panel (COSS Sheet or an aside next to the page) with the quoted words at
the top, rendered as Markdown, and Insert below, Replace and Copy. The thread
continues there. Context is the selection, the page title and the surrounding
blocks. Nothing lands in the page unless inserted. ⌘J opens it, as Notion does.

## 5. Order

1. Themes, `check:themes`, notices.
2. Settings container, Appearance (theme, light and dark, text size, page width,
   density), prefs.
3. Type scale, grid tokens and the three check scripts.
4. Settings › AI (provider, key, model), the Rust `ask` command, the selection
   bar and the answer panel.

Gherkin first for each, per CLAUDE.md. Decisions to take before 2 and 4: dialog or
page swap for Settings; API key or own CLI as the first provider.
