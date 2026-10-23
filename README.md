# LeadingLight

A space for life in general. This is the main monorepo.

## Layout

- `apps/desktop`: the desktop app (Tauri 2 + React + Vite)
- `packages/ui`: shared UI, built on [COSS UI](https://coss.com/ui/docs/get-started)
- `packages/editor`: the block editor (TipTap/ProseMirror with our own UI)
- More apps (website, docs) will go in `apps/`.

pnpm workspaces handle the JS side. A Cargo workspace (root `Cargo.toml`) handles Rust.

## Getting started

Needs Node 22+, pnpm 10, and Rust (stable).

```sh
pnpm install
pnpm dev        # run the desktop app
pnpm build      # bundle the desktop app
pnpm typecheck
```

## Data model

Notes live in a local SQLite file (`leadinglight.db` in the app data dir) via
`tauri-plugin-sql`. Schema changes are migrations in `apps/desktop/src-tauri/migrations`.

Everything is an **object** of a **type**, in the spirit of Capacities:

- `objects`: type, title, `content` (the editor document as JSON), `properties` (JSON values,
  keyed by property id, plus the page's icon, cover and description), and a `deleted_at` for trash.
- `object_types`: name, plural, icon, the ordered property ids in `properties`, and `settings`
  (colour, card, link view, default template, list view). Starter types are seeded as data.
- `property_defs`: each property once for the whole space: name, kind and options.

A page's own properties are the values its type doesn't list. Backlinks are found by searching
stored pages for a page's id, so there is no links table. In a plain browser the same data lives
in IndexedDB.

## Adding COSS UI components

Run shadcn from `packages/ui` so components land in the shared package:

```sh
cd packages/ui && pnpm dlx shadcn@latest add @coss/<component>
```

Apps import them as `@leadinglight/ui/components/<name>`.
