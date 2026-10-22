# Shipyard, vendored

A verbatim copy of parts of [cosscom/shipyard](https://github.com/cosscom/shipyard)
(MIT, `LICENSE`; its own third-party notices in `THIRD_PARTY_NOTICES.md` and
`THIRD_PARTY_THEMES.md`). `UPSTREAM.json` says which commit and which paths.
Upstream's layout is kept (`app/src`, `packages/plugin-sdk`), so a diff of
upstream applies here as it is.

## Rules

- Nothing in `vendor/shipyard` is edited by hand. A change we need goes in our
  own code, or upstream. If a patch is ever unavoidable, mark it with a
  `LeadingLight:` comment and list it here.
- `scripts/sync-shipyard.sh [ref]` pulls upstream's changes in with a 3-way
  merge and updates `UPSTREAM.json`. Then `pnpm install` and `pnpm typecheck`.
- `plugins/` is here as source only, so upstream's tests in `app/src` resolve;
  nothing builds or loads the plugins.
- `app/src-tauri/src/menu.rs` lives at `apps/desktop/src-tauri/src/menu.rs`
  instead (`UPSTREAM.json` "moved"), so its `include_str!` of the shortcuts
  table reaches ours. The sync script re-roots its diff.

## How LeadingLight uses it

- `vendor/shipyard/app` is the workspace package `@leadinglight/shipyard`; its
  `package.json` is ours, with upstream's dependencies. `pnpm --filter
  @leadinglight/shipyard typecheck` checks the whole vendored tree on its own.
- In `apps/desktop`, the alias `@/` means this tree's `src/` (upstream's own
  alias, so files import each other unchanged) and `~/` means our `src/`.
  Two exceptions, aliased to our own files in upstream's shape:
  `@/lib/shortcuts.json` to `apps/desktop/src/lib/shortcuts.json`, and
  `@/themes/builtin` to `packages/themes/src/builtin.ts` (our palettes; the
  theme engine here reads them unchanged).
- `src/index.css` is the app's Tailwind root; `apps/desktop/src/styles.css`
  imports it and overrides the fonts after it.
- `apps/desktop/public/builtin-plugins/index.json` is an empty list, so the
  plugin host finds no built-in plugins instead of a 404.
- `__BERTH_DEMO__` is defined true in our Vite config: the agent code runs on
  its mock fixtures, as Shipyard's live demo does, until LeadingLight has an
  agent backend of its own.

Local patches: none.
