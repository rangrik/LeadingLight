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

- `object_types`: id, name, icon, and a JSON `properties` schema. V1 seeds one type, `page`.
- `objects`: type, title, `content` (the editor document as JSON), `properties` (JSON values),
  and a `deleted_at` for trash.

Adding richer kinds later (Person, Book, Meeting, daily notes) means new rows in
`object_types` plus UI, not new tables. Links between objects (mentions, embeds,
backlinks) will be a `links` table filled from the editor content on save.

## Adding COSS UI components

Run shadcn from `packages/ui` so components land in the shared package:

```sh
cd packages/ui && pnpm dlx shadcn@latest add @coss/<component>
```

Apps import them as `@leadinglight/ui/components/<name>`.
