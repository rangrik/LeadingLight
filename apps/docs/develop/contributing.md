---
title: Contributing
description: How a change to LeadingLight gets built, the design rules it follows, and where to report a problem.
---

# Contributing

Thank you for helping with LeadingLight. This page covers how a change is made, the rules the app's design and code follow, and where to report problems. To get the code running first, see [Build from source](/develop/).

## Report a problem or ask for something

Open an issue at [github.com/rangrik/LeadingLight/issues](https://github.com/rangrik/LeadingLight/issues). It helps to include:

- what you did, what you expected, and what happened instead
- whether it was the Mac app, the iPad app or a browser
- the build, from **Settings › About**

LeadingLight is in early development, so expect rough edges. Known limits are listed in [FAQ and known limits](/guide/faq).

## How a change gets built

1. **Write the spec first.** Add or update the Gherkin in `features/`. Use concrete steps and concrete expectations, and cover the failure cases too. The specs are the contract for what the app does.
2. **Build it.**
3. **Typecheck and try it.** Run `pnpm typecheck`, then try the change yourself in the browser build (`pnpm --filter @leadinglight/desktop dev`).
4. **Check every scenario.** Walk through each scenario of the spec in the browser build and note pass or fail, with screenshots, plus anything that looks off. Do every step the way a person will: if the spec says Shift-click a row, Shift-click it.
5. **Fix what you found**, and check the failed scenarios again.
6. **Try the Mac app** if part of the change can't be judged in a browser, such as the menu bar, global keys, the capture panel, or anything WebKit does differently from Chromium. `pnpm install:dev-app` installs a separate copy with its own data.
7. **Write down what you put off.** Anything left for later goes in `docs/DEFERRED.md`, with the date, why not now, and what would bring it back.

The Playwright checks in `apps/desktop/qa` (`pnpm qa`) cover the quick smoke test, the gallery screenshots and regressions. They never drive the native window.

### Things worth testing

- **A long page.** Try 2000 paragraphs and check that typing still keeps up.
- **Text that gets cut off.** Whatever shares a row with text that ends in an ellipsis should take only the room left, not shrink beside it.
- **After merging main**, run the change's scenarios again. A merge without conflicts can still be wrong.

## Design rules

- **It should feel like an Apple app**: calm, uniform, nothing decorative. When unsure, remove.
- **Typography** is the system font, SF Pro on macOS. Editor sizes live in `packages/editor/src/editor.css`.
- **Icons** are lucide only, 16 px in rows and toolbars.
- **No focus rings or outlines** on buttons, rows or menu items. Text fields keep a soft ring.
- **Colours come from theme tokens** in `packages/ui/src/styles/globals.css`. No hardcoded hex in app code. Light and dark follow the system.
- **Motion** is 150–200 ms, ease-out, and only on changes of state: hover, open, collapse.
- **Use COSS's components as shipped.** Every control, list, table, menu, tooltip, dialog and form part comes from `packages/ui`, put together the way COSS's own examples do. Add a missing one with `cd packages/ui && pnpm dlx shadcn@latest add @coss/<name>`. Where COSS has none, copy shadcn's Base UI version into `packages/ui` and list your changes at its top.
- **Choose the control by what it means.** A switch turns one thing on, checkboxes choose any of several, a segmented control or radio group picks one of a few, and a tooltip explains. Never use the browser's `title` attribute for a tooltip.
- **Pixel alignment is part of correctness.** Icons centred in their buttons, text baselines lined up across a row, one gutter width, one row height, one radius. Zoom into screenshots; an "almost" is a bug.

Never edit `vendor/shipyard`. It is synced from upstream; override it from LeadingLight's own code instead.

## Rules for code

- **Comments** stay under two lines, in simple words, and say only why.
- **Tests go at critical seams.** Before adding one, name the seam it guards and the failure it catches. A test must not dwarf the thing it tests, and coverage alone is not a reason to add one.
- **Write plain English**, in code and in docs. If a word needs a definition, use a simpler word.
- **Watch the diff size.** Removing code is the goal; every added line needs a reason.
- **Decision records and plans stay short.** If your change makes a choice that is expensive to reverse, add a short record to `docs/DECISIONS.md`.
- **Use conventional commit titles**, and the same for squash-merged pull requests: `feat:` for a feature, `fix:` for a fix, `perf:` for a speed-up. Release notes and version numbers are made from them, so leave version numbers to the release bot. See [Releases](/develop/releases).

## Related

- [Build from source](/develop/)
- [Architecture](/develop/architecture)
- [Releases](/develop/releases)
