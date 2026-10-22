# LeadingLight

A space for life in general. This is the main monorepo.

## Layout

- `apps/desktop`: the desktop app (Tauri 2 + React + Vite)
- `packages/ui`: shared UI, built on [COSS UI](https://coss.com/ui)
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

## Adding COSS UI components

Run shadcn from `packages/ui` so components land in the shared package:

```sh
cd packages/ui && pnpm dlx shadcn@latest add @coss/<component>
```

Apps import them as `@leadinglight/ui/components/<name>`.
