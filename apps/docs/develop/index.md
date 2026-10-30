---
title: Build from source
description: Set up the LeadingLight repository, run the app and its checks, and build the Mac app, the iPad app and these docs.
---

# Build from source

LeadingLight is open source under the MIT license. This page shows how to get the code running on your own machine: the Mac app, the browser build, the iPad target, and the optional cloud and image services.

The code is at [github.com/rangrik/LeadingLight](https://github.com/rangrik/LeadingLight).

## What you need

- **Node 22** or later
- **pnpm 10**
- **Rust**, the stable toolchain (through rustup)
- **An Apple Silicon Mac** to build and run the Mac app. The bundled helpers are built for Apple Silicon only.
- **Xcode and CocoaPods**, only for the iPad target

## Get started

```sh
git clone https://github.com/rangrik/LeadingLight.git
cd LeadingLight
pnpm install
pnpm runtime:build   # prepare the bundled helpers, on an Apple Silicon Mac
pnpm dev             # run the desktop app
```

pnpm workspaces handle the JavaScript side, and a Cargo workspace at the root handles Rust.

`pnpm runtime:build` builds the project runtime and the copy of tmux the app ships with. Project chats run their agents in them.

## Run the app

| Command | What it does |
| --- | --- |
| `pnpm dev` | Opens the desktop app in its own window, storing notes in SQLite. |
| `pnpm --filter @leadinglight/desktop dev` | Runs only the web interface, at http://127.0.0.1:1420, storing notes in your browser's IndexedDB. |
| `pnpm build` | Bundles the desktop app. |

The browser build is the quickest way to work on the interface, and it is what the automated checks use. Things only the Mac app has, such as the menu bar, global keys like <kbd>⌃⌥I</kbd>, the capture panel over other apps and SQLite storage, need `pnpm dev`. Where the app needs Claude Code, the browser build answers with a stand-in that speaks the same protocol, so you can try the Ask panel without it.

## Check your work

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | Type-checks every package. |
| `pnpm qa` | Runs the Playwright checks in headless Chromium, against the browser build on port 1420. |
| `pnpm check:themes` | Checks that every built-in theme keeps its text readable. |

`pnpm qa` uses the browser build already running on port 1420, or starts one. If port 1420 belongs to another checkout, run the checks on another port with `QA_PORT=<port> pnpm qa`.

## Install the Mac app

| Command | What it does |
| --- | --- |
| `pnpm install:app` | Builds the Mac app and puts it in `/Applications`. It refuses while LeadingLight is running, so quit it first. |
| `pnpm install:dev-app` | Installs a separate "LeadingLight Dev" copy for this checkout, with its own data, so your own notes are never touched. `pnpm install:dev-app --remove` takes it and its data away again. |

A global key such as <kbd>⌃⌥I</kbd> belongs to whichever copy of the app started first, so quit the other copy when you test one.

## Build for iPad

The iPad app shares the desktop app's editor, page model, themes and local SQLite store. You need a Mac with Xcode, CocoaPods, pnpm and rustup.

| Command | What it does |
| --- | --- |
| `pnpm ios:init` | Generates the Xcode project. Run it once, and again after you update the checkout. |
| `pnpm ios:build` | Builds an unsigned archive for a device. It needs signing before it can be installed. |
| `pnpm ios:build:sim` | Builds for the simulator, which needs a simulator runtime that matches Xcode's SDK. |

The target needs iPadOS 16.4 or later. No signing team, certificate or profile is stored in the repository; choose your own in Xcode. Signing, installing on a device and TestFlight are covered in [docs/IPAD.md](https://github.com/rangrik/LeadingLight/blob/main/docs/IPAD.md).

## Run the cloud service locally

Accounts, encrypted sync and pairing a browser with a Mac use an optional service in `apps/cloud`. Notes work without it. To run it on your machine:

1. Start its database with Docker Compose, from `apps/cloud/compose.yaml`.
2. Copy `.env.example` to `apps/cloud/.env`. Fill in a long random secret for sign-in, your own Google or GitHub OAuth client, and the app's local address.
3. Run `pnpm --filter @leadinglight/cloud migrate`, then `pnpm --filter @leadinglight/cloud dev`.
4. Run the browser build on the port you chose, for example `pnpm --filter @leadinglight/desktop dev --port 1431`. It forwards `/api` to the service.

Register your OAuth callbacks at your local address, under `/api/auth/callback/google` and `/api/auth/callback/github`. New accounts are private by default: add your account's id to the list of allowed users in `.env`. Never put a provider secret in a `VITE_` variable. The full steps are in [apps/cloud/README.md](https://github.com/rangrik/LeadingLight/blob/main/apps/cloud/README.md).

## Use your own image service

Unsplash covers come through a small shared service in `apps/image-service`. It never receives your notes. The app uses the shared service unless you build it with your own:

```sh
# apps/desktop/.env.local
VITE_IMAGE_SERVICE_URL=https://your-image-service.example.com
```

The service holds the Unsplash key on its side, never in the app. See [apps/image-service/README.md](https://github.com/rangrik/LeadingLight/blob/main/apps/image-service/README.md) to deploy one.

## Run these docs

This site lives in `apps/docs`.

| Command | What it does |
| --- | --- |
| `pnpm --filter @leadinglight/docs dev` | Serves the docs at http://127.0.0.1:1440, updating as you edit. |
| `pnpm --filter @leadinglight/docs build` | Builds the static site. |

## Related

- [Architecture](/develop/architecture)
- [Contributing](/develop/contributing)
- [Releases](/develop/releases)
- [Install](/guide/install)
