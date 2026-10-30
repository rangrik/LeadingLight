---
title: Architecture
description: How the LeadingLight repository is laid out, what it is built with, how notes are stored, and how agents and sync work.
---

# Architecture

This page is a map of the LeadingLight code: where things live, what they are built on, and the few ideas that shape the rest. Why each choice was made is in [docs/DECISIONS.md](https://github.com/rangrik/LeadingLight/blob/main/docs/DECISIONS.md).

## Repository layout

| Path | What is in it |
| --- | --- |
| `apps/desktop` | The app. `src/` is the React interface; `src-tauri/` is the Rust side. |
| `apps/desktop/src-tauri` | The window, the SQLite migrations (`migrations/`), the Mac menu bar, `agent.rs`, which drives the installed Claude Code for Ask, and `capture.rs`, the <kbd>⌃⌥I</kbd> idea capture panel. `capture.html` and `src/capture.tsx` are that panel's page. |
| `apps/cloud` | The optional service for accounts, encrypted sync and pairing a browser with a Mac. |
| `apps/image-service` | A small service that searches Unsplash for covers. It never receives notes. |
| `apps/landing-pages` | Three landing page concepts. |
| `apps/docs` | This documentation site. |
| `packages/ui` | The shared UI components, from COSS UI. Imported as `@leadinglight/ui/components/<name>`. |
| `packages/editor` | The block editor, built on TipTap and ProseMirror. Imported as `@leadinglight/editor/editor`. |
| `packages/themes` | The 23 theme palettes and the contrast check that keeps them readable. |
| `vendor/shipyard` | Shipyard's app source, copied verbatim. See [Shipyard inside](#shipyard-inside). |
| `runtime/` | The pinned sources and patches for the helpers the app ships: the project runtime (`runtime/shipyard`) and tmux (`runtime/tmux`). |
| `features/` | Gherkin specs. They are the contract for what the app does. |
| `docs/` | Decisions, the plan, what is put off (`DEFERRED.md`), releasing, iPad and sync notes. |

pnpm workspaces hold the JavaScript packages; a Cargo workspace at the root holds the Rust.

## The stack

- **Tauri 2** for the Mac and iPad apps: a Rust core with the system's web view.
- **React 19**, built with **Vite**, styled with **Tailwind 4**.
- **TipTap** on **ProseMirror** for the editor engine. Everything you see and touch in the editor (the block model, slash menu, selection toolbar, block handle) is LeadingLight's own. Pages are stored as ProseMirror JSON.
- **COSS UI**, shadcn-style components on **Base UI**, as the one component kit, used as shipped.
- **lucide** as the one icon set, and the system font (SF Pro on macOS).

The same React app runs in three places: the Mac app, the iPad app and a plain browser. Code that needs to know whether it is in the Mac app asks one place, `isNative` in `apps/desktop/src/lib/platform.ts`.

## Data model

Everything is an **object** of a **type**, in the spirit of Capacities. There is one kind of object, the page; no type is written into the code.

| Table | What it holds |
| --- | --- |
| `objects` | Each page: its type, title, `content` (the editor document as JSON), `properties` (JSON values keyed by property id, plus the page's icon, cover and description) and a `deleted_at` for the trash. |
| `object_types` | Each type: name, plural, icon, its ordered property ids, and `settings` (colour, card, link view, default template, list view). The starter types are seeded as data. |
| `property_defs` | Each property, once for the whole space: name, kind and options. |

A page's own properties are the values its type doesn't list. Tags, collections and daily notes are pages with a type and a relation, not special code.

**Storage.** In the app, notes live in a local SQLite file (`leadinglight.db` in the app's data folder), through `tauri-plugin-sql`. Schema changes are migrations in `apps/desktop/src-tauri/migrations`. In a plain browser the same store interface is backed by IndexedDB, one record per page. Nothing else in the app knows which store it is using. Saves wait half a second after the last edit, and flush early when the window loses focus or closes.

**Links and backlinks.** A link stores only the page's id, so it follows renames. Backlinks are found by searching stored pages for that id, so there is no links table to keep in step.

## How agents run

LeadingLight holds no model API keys. Agents run through the command-line tools the person has installed and signed into on their Mac.

- **Ask on a page.** Each turn, the Rust side starts the installed Claude Code (`claude -p`) as a subprocess, speaking stream-json both ways, and resumes it for follow-ups. GPT models go through Codex the same way, one `codex app-server` per turn. The page tools (read, search, edit, insert, rewrite, create) are answered by the web view, so every change goes through the page's open editor. Access maps to the tool's own permission modes.
- **Project chats.** Agents that keep working while the window is closed run in the app's own copy of the project runtime, `berthd`, built from Shipyard at a pinned commit with a short patch series in `runtime/shipyard`. It has its own state folder, socket and tmux server, so it never touches the person's own. The app is its client: the runtime owns the agent processes, their questions and approvals, turns and history; LeadingLight owns the link between a project page and its folder, and the reports the person keeps.
- **From a browser.** A signed-in browser can pair with a Mac and use its page agents through an encrypted relay. The Mac runs the same processes; the relay sees only encrypted messages.

The browser build has a stand-in that plays the same protocol as Claude Code, so the Ask panel can be tried and tested without it.

## Sync

Sync is optional and off until you set it up. Each device keeps its full local store, and changes travel as an encrypted journal: compressed, chunked entries, encrypted with AES-GCM on the device. The hosted service stores only that ciphertext. The recovery key that unlocks it stays on your devices and never reaches the service.

Devices can reconnect at different times. If two offline devices change the same page, both versions are kept; it is not live, character-by-character merging. Attachments travel inside the encrypted journal. Linked project folders stay on the Mac. Native apps join an account by approval in a signed-in browser, which encrypts the recovery key for that device.

## Shipyard inside

Shipyard (MIT) is built on the same stack and already had themes, Settings, a shortcuts table with a Mac menu bar, and an agent conversation interface. Its app source lives in `vendor/shipyard`, unchanged, and is synced from upstream with `pnpm sync:shipyard`, which applies upstream's changes with a three-way merge. Nothing in that folder is edited. LeadingLight's code imports it and overrides it by alias (the shortcuts table, the theme palettes) or by CSS. In `apps/desktop`, `@/` points to the vendored tree and `~/` to LeadingLight's own `src/`.

## Key decisions

Each has a short record in [docs/DECISIONS.md](https://github.com/rangrik/LeadingLight/blob/main/docs/DECISIONS.md).

- **TipTap for the engine, our own block UI.** Writing an editor engine from scratch is where undo, input methods and paste go wrong.
- **COSS UI as shipped, lucide, the system font.** One kit, so every control matches by construction.
- **SQLite in the app, IndexedDB in the browser.** One store interface; the schema is object-first, so new kinds of data arrive as migrations.
- **Gherkin is the contract.** Specs in `features/` describe behaviour before it is built, and checks run against the browser build.
- **Shipyard is vendored verbatim.** Its fixes keep coming from upstream; ours sit beside it.
- **Agents through the person's own Claude Code or Codex.** The app holds no key, and the person's own plan pays.
- **One kind of object; types and properties are data.** Any page can have any property, and properties are shared by the whole space.
- **Links are ids; backlinks are a search.** Nothing can fall out of step.
- **Changed shortcuts are written into the shortcuts table**, so the menu bar and every hint follow.
- **Project agents run in a pinned runtime the app starts**, so they keep working while the window is closed.
- **Sync is an encrypted journal.** The service stores only ciphertext and never sees the recovery key.
- **The iPad app is the same React app and store**, with Mac-only abilities checked separately.

## Related

- [Build from source](/develop/)
- [Contributing](/develop/contributing)
- [Objects, types and links](/guide/concepts)
- [Accounts and encrypted sync](/sync/)
- [Your data and privacy](/guide/privacy)
