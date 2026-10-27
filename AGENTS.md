# LeadingLight

A local-first notes app in the spirit of Capacities: every note is an object of
a type, written in a Notion-style block editor. Desktop app on Tauri 2 + React 19
+ Vite + Tailwind 4. macOS first.

## Layout

- `apps/desktop` — the app. `src/` is React, `src-tauri/` is Rust (window, SQLite migrations, the
  menu bar, `agent.rs`, which drives the installed Claude Code for Ask about this, and `capture.rs`,
  the ⌃⌥I idea capture panel). `capture.html` + `src/capture.tsx` is that panel's page.
- `packages/ui` — COSS UI components (shadcn-style, on Base UI). Import as `@leadinglight/ui/components/<name>`.
  Docs: https://coss.com/ui/docs/get-started (setup), https://coss.com/ui/docs/styling (tokens, `isolate`),
  `https://coss.com/ui/docs/components/<name>.md` per component, https://coss.com/ui/llms.txt (index).
  Add one with `cd packages/ui && pnpm dlx shadcn@latest add @coss/<name>`.
- `packages/editor` — our block editor, built on TipTap/ProseMirror. Import as `@leadinglight/editor/editor`.
- `packages/themes` — the 23 theme palettes, ours to edit; `pnpm check:themes` keeps them readable.
- `vendor/shipyard` — Shipyard's app source, verbatim (MIT), synced from upstream with
  `pnpm sync:shipyard`. Never edit it; read `vendor/shipyard/README.md`. In `apps/desktop`,
  `@/` is the vendored tree and `~/` is our own `src/`.
- `features/` — Gherkin specs. This is the contract for what the app does.
- `docs/DECISIONS.md` — why things are the way they are. Read it before touching an architecture piece.
- `docs/PLAN.md` — milestones.
- `docs/DEFERRED.md` — issues and features put off, with the date, why, and what would bring each back.

## Commands

```sh
pnpm install
pnpm dev                                   # Tauri window (SQLite storage)
pnpm --filter @leadinglight/desktop dev    # browser only at :1420 (IndexedDB storage)
pnpm typecheck
pnpm qa                                    # Playwright, headless Chromium, against :1420
QA_PORT=$BERTH_PORT pnpm qa                # in a Berth worktree, when :1420 is another checkout's
pnpm check:themes                          # every built-in theme keeps its contrast
pnpm sync:shipyard [ref]                   # pull Shipyard's changes into vendor/shipyard
pnpm install:app                           # build the Mac app and put it in /Applications
pnpm install:dev-app                       # this worktree's own "LeadingLight Dev <hash>", own data
```

## Design rules

- It should feel like an Apple app: calm, uniform, nothing decorative. When unsure, remove.
- Typography: the system font (SF Pro on macOS). Editor sizes live in `packages/editor/src/editor.css`.
- Icons: lucide only, 16px in rows and toolbars. No second icon set.
- No focus rings or outlines on buttons, rows, menu items. Text fields keep a soft ring.
- Light and dark follow the system. Colors come from theme tokens in `packages/ui/src/styles/globals.css`. No hardcoded hex in app code.
- Motion: 150–200 ms, ease-out, only on state changes (hover, open, collapse).
- Never write a UI component from scratch. Every control, list, table, menu, tooltip, dialog and
  form part is COSS's, as shipped (`packages/ui`; add a missing one with the command above). Put
  them together the way COSS's own examples do: `https://coss.com/ui/r/p-<component>-<n>.json`
  (for example `p-checkbox-group-3`, `p-field-13`). Where COSS has none, copy shadcn's Base UI
  version (`https://ui.shadcn.com/r/styles/base-vega/<name>.json`) into `packages/ui`, point it at
  COSS's primitives, restyle only after copying and only to match, and list the changes at its top.
  Compose with Base UI's `render` prop rather than restyling.
- Choose the control by what it means: a switch turns one thing on, checkboxes choose any of
  several, a segmented control or radio group picks one of a few, a tooltip explains (never the
  browser's `title`). Only when focus must stay in the editor (the slash menu) or the editor
  positions the surface itself, copy the COSS classes (see `surface` in `packages/editor/src/ui.tsx`).
  Edits to files in `packages/ui` stay rare, small, and marked with a `LeadingLight:` comment.
- Before building any block or layout by hand, look for the official one. shadcn serves Base UI
  versions of its blocks (`https://ui.shadcn.com/r/styles/base-vega/<block>.json`); copy their
  higher-order files as-is, point imports at COSS's primitives, and list every change at the top of
  each file. Never install their primitives over COSS's.
- The shell is shadcn's sidebar-08 (base-vega) copied this way: `apps/desktop/src/components/sidebar/`.
  Mobbin is the reference library for patterns.
- Check every bit. Pixel alignment is part of correctness: a block handle centred on the
  block's first line, icons centred in their buttons, text baselines lined up across a row,
  one gutter width, one row height, one radius. Zoom into screenshots; an "almost" is a bug.

## How a change gets built

1. Write or update the Gherkin in `features/` first. Concrete steps, concrete expectations, failure cases too.
2. Build it.
3. Typecheck. Do one short smoke in a headless browser yourself.
4. Hand QA to a subagent: model Sonnet 5.5, effort xhigh. It drives the browser build
   (`pnpm --filter @leadinglight/desktop dev`, port 1420 or `$BERTH_PORT`, bound to 127.0.0.1) in the worktree's
   Berth agent browser (`berthd browser … --tab qa`), which the user can watch live in Shipyard.
   It reports pass/fail per scenario with screenshots, plus anything that looks off. It never
   drives the native Tauri window.
5. Fix what it found. Re-run QA on the failed scenarios.
6. Only if part of the change can't be tested in the browser with full confidence (the menu bar,
   global keys, the capture panel, anything WebKit does differently), also run
   `pnpm install:dev-app`. It installs "LeadingLight Dev <hash>" (a hash of the branch, so it is
   this worktree's) beside the real app, with its own data, so the user's notes are never touched.
   A global key such as ⌃⌥I belongs to whichever app started first; say so in the steps.
   Don't drive it. Give the user numbered steps for exactly what the browser couldn't show, each
   with what they should see, and wait for their report. The browser stays the first way; this
   never replaces it.
7. Anything put off instead of fixed goes in `docs/DEFERRED.md`: date, why not now, and when to revisit.
8. Once the user says it works, or told you to finish without asking, close it out yourself:
   commit; merge main into the branch and run the change's scenarios again (see Traps); merge
   the branch into main in the main checkout (`$BERTH_ROOT_PATH`); there, build the Mac app and
   install it (`pnpm install:app`, which refuses while the app is running: ask the user to quit
   it, never kill it); remove your dev app and its data (`pnpm install:dev-app --remove` in the
   worktree). Then tell the user what to try in the installed app and what to look at. Last,
   clean up: stop the worktree's servers; free and delete the merged branch (`git checkout
   --detach`, then `git -C "$BERTH_ROOT_PATH" branch -d "$BERTH_BRANCH"`); and close the worktree
   with `"$BERTH_HOME/bin/berthd" worktree rm "$BERTH_LOCATION/$BERTH_WORKTREE_NAME"`, which ends
   your session, so send your report before it.

Playwright (`apps/desktop/qa`) stays for the headless smoke, the gallery screenshots and
regression specs. Never automate the native window: no AppleScript, no desktop screenshots.

## Traps

Each of these passed every check here and still failed for the user, or cost hours.

- Test the way the user will. QA once opened two panes by calling `openBeside()`, and the user
  was then told to Shift-click a sidebar row, which did not open a pane. Do every step you give
  the user yourself, the same way, first. The Berth browser can't send modifier clicks or drags;
  use Playwright for those (`click({ modifiers: ["Shift"] })`, `page.mouse`).
- Headless QA can't see the browser's own UI: `title` tooltips, spellcheck underlines, native
  menus. A `title` tooltip also waits 2–4 s on macOS. Never use `title` for UI; use COSS's
  Tooltip (`packages/editor/src/mark-tip.tsx` anchors one to words in the editor).
- After merging main, run all of the change's scenarios again. Main once gave every page its own
  card and header; the counts merged without a conflict and were still wrong in a split.
- Test a long page: 2000 paragraphs (`__editor.commands.setContent`), timing keys against 16 ms.
  Three things made typing slow there: a `:has()` rule on a page-wide container (Chromium
  restyles the whole page on every key), thousands of ProseMirror node decorations (rebuilding
  the set is quadratic), and redrawing inline decorations around the cursor on every key.
- A dev app once ran as the browser build: the app knew itself by the exact identifier
  `com.leadinglight.app`, and the dev app's is `com.leadinglight.dev.<hash>`, so the menu bar,
  global keys and SQLite were never used and the test of them meant nothing. Anything that asks
  "is this the Mac app?" goes through `isNative` (`apps/desktop/src/lib/platform.ts`). Check the
  dev app has room for the traffic lights before handing it over: if it doesn't, it isn't native.
- An ellipsis cuts text on a fraction of a pixel. Whatever shares a row with truncating text
  should take only the room left (`flex: 1 1 0; min-width: 0`), not shrink beside it.

## Rules for any developer (human or agent)

- Comments and docstrings: under 2 lines, simple words, only the "why".
- Tests go at critical seams only. Before adding one, name the seam it guards and the failure it catches.
- A test must not dwarf the thing it tests.
- Never add a test just because a reviewer asked for coverage. Ask what breaks.
- Decision records and plans stay short.
- Write plain English. If a word needs a definition, use a simpler word.
- Watch the diff size. Removing code is the goal; every added line needs a reason.
- Commit only when asked.
- Use conventional commit and squash-PR titles (`feat:`, `fix:`, `perf:`) so release notes and
  version bumps work. Let the release bot change versions; see `docs/RELEASING.md`.
