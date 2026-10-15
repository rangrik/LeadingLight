# LeadingLight

A quiet, local-only desktop writing workspace, built on [Tolaria](https://github.com/refactoringhq/tolaria) and Tauri.

Your pages are Markdown files in a folder you control. LeadingLight has its own app identity and
settings. It disables telemetry, automatic updates, cloud AI, remote templates and note sync.
The application source is public; your notes are not part of this repository.

The first milestone adds two independently editable pages side by side or stacked, with
resizable panes and restored workspace state. See [the product plan](docs/leadinglight/PRODUCT.md)
and [the fork architecture](docs/leadinglight/ARCHITECTURE.md) for scope and maintenance.
The [verification record](docs/leadinglight/VERIFICATION.md) documents tested behavior and limits.

## Start writing

Open LeadingLight and choose **Create local workspace** for a fresh folder, or **Open a folder**
for existing Markdown. Create a page with **New page** or `⌘N`. Use **Split right** or **Stack
pages**, then choose a page in the other pane's searchable title control. Drag a note directly
from **All Notes** to an edge of the page area to open it beside or above your current page.
Drop in the center of a pane to open it there. Drag a page title to rearrange the split;
the preview shows where it will land. Each pane stays editable.
Drag the divider to resize; double-click it to return to equal sizes. Closing a pane keeps its
page available when you reopen the split.

`⌘P` finds a page, `⌘S` saves immediately, and `⌘⌥1` / `⌘⌥2` focuses either pane. On Windows
and Linux, use Ctrl instead of Command. Rich text and Markdown shortcuts use the inherited
editor; the Markdown files remain readable in other tools.

The initial release uses one workspace window, with two page panes and guarded switching
between local folders. Combined multi-workspace views and separate editing windows are held
until they share the same document ownership and save guarantees.

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev          # Browser fixture preview, not the native persistence check
pnpm tauri dev    # Native local application
CARGO_BUILD_JOBS=2 pnpm tauri build --debug --bundles app # Local macOS app bundle
```

Use one shared dependency install and one Rust target directory. Native builds run with at most
two Cargo jobs. Project instructions and local checks are documented in [AGENTS.md](AGENTS.md).
Tauri is current stable for this milestone. Compatible packages were refreshed; editor patches
and major-version migration holds are listed explicitly in [dependency status](docs/leadinglight/DEPENDENCIES.md).

## Attribution

LeadingLight is an independent fork of Tolaria by Luca Rossi and contributors. It retains the
AGPL-3.0-or-later license. LeadingLight's page-and-light mark is its own identity; interface icons use Phosphor. Capacities and
Notion are interaction references; LeadingLight is not affiliated with either product.

---

The original upstream README follows for reference. Its cloud/AI integrations and release links
describe Tolaria and do not define LeadingLight's enabled behavior.

![Latest stable](https://img.shields.io/github/v/release/refactoringhq/tolaria?display_name=tag) [![Codecov](https://codecov.io/gh/refactoringhq/tolaria/graph/badge.svg?branch=main)](https://codecov.io/gh/refactoringhq/tolaria) [![CodeScene Hotspot Code Health](https://codescene.io/projects/76865/status-badges/hotspot-code-health)](https://codescene.io/projects/76865) [![Codacy Badge](https://app.codacy.com/project/badge/Grade/fa3cdc28aefa460591c74aa262530708)](https://app.codacy.com/gh/refactoringhq/tolaria/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)

# 💧 Tolaria

Tolaria is a desktop app for macOS, Windows, and Linux for managing **markdown knowledge bases**. People use it for a variety of use cases:

* Operate second brains and personal knowledge
* Organize company docs as context for AI
* Store OpenClaw/assistants memory and procedures

Personally, I use it to **run my life** (hey 👋 [Luca here](http://x.com/lucaronin)). I have a massive workspace of 10,000+ notes, which are the result of my [Refactoring](https://refactoring.fm/) work + a ton of personal journaling and *second braining*.

<img width="1000" height="656" alt="1776506856823-CleanShot_2026-04-18_at_12 06 57_2x" src="https://github.com/user-attachments/assets/8aeafb0a-b236-43c2-a083-ec111f903c38" />

## Sponsors

Tolaria is supported by a small panel of tools that help keep the project healthy, tested, and ready for AI-assisted development. I use these tools every day.

<table>
  <tr>
    <td align="center" width="25%">
      <a href="https://codacy.com/tolaria?utm_source=tolaria&utm_medium=github&utm_campaign=refactoring">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/refactoringhq/tolaria/main/site/public/landing/sponsors/codacy-light.svg">
          <img src="https://raw.githubusercontent.com/refactoringhq/tolaria/main/site/public/landing/sponsors/codacy-dark.svg" alt="Codacy" height="32">
        </picture>
      </a>
    </td>
    <td align="center" width="25%">
      <a href="https://codescene.com/?utm_source=tolaria&utm_medium=github&utm_campaign=refactoring">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/refactoringhq/tolaria/main/site/public/landing/sponsors/codescene-light.svg">
          <img src="https://raw.githubusercontent.com/refactoringhq/tolaria/main/site/public/landing/sponsors/codescene-dark.svg" alt="CodeScene" height="32">
        </picture>
      </a>
    </td>
    <td align="center" width="25%">
      <a href="https://circleci.com/?utm_source=tolaria&utm_medium=github&utm_campaign=refactoring">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/refactoringhq/tolaria/main/site/public/landing/sponsors/circleci-light.svg">
          <img src="https://raw.githubusercontent.com/refactoringhq/tolaria/main/site/public/landing/sponsors/circleci-dark.svg" alt="CircleCI" height="32">
        </picture>
      </a>
    </td>
    <td align="center" width="25%">
      <a href="https://getunblocked.com/?utm_source=tolaria&utm_medium=github&utm_campaign=refactoring">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/refactoringhq/tolaria/main/site/public/landing/sponsors/unblocked-light.svg">
          <img src="https://raw.githubusercontent.com/refactoringhq/tolaria/main/site/public/landing/sponsors/unblocked-dark.svg" alt="Unblocked" height="32">
        </picture>
      </a>
    </td>
  </tr>
</table>

## Walkthroughs

You can find some Loom walkthroughs below — they are short and to the point:
- [How I Organize My Own Tolaria Workspace](https://www.loom.com/share/bb3aaffa238b4be0bd62e4464bca2528)
- [My Inbox Workflow](https://www.loom.com/share/dffda263317b4fa8b47b59cdf9330571)
- [How I Save Web Resources to Tolaria](https://www.loom.com/share/8a3c1776f801402ebbf4d7b0f31e9882)

## Principles

- 📑 **Files-first** — Your notes are plain markdown files. They're portable, work with any editor, and require no export step. Your data belongs to you, not to any app.
- 🔌 **Git-first** — Every vault is a git repository. You get full version history, the ability to use any git remote, and zero dependency on Tolaria servers.
- 🛜 **Offline-first, zero lock-in** — No accounts, no subscriptions, no cloud dependencies. Your vault works completely offline and always will. If you stop using Tolaria, you lose nothing.
- 🔬 **Open source** — Tolaria is free and open source. I built this for [myself](https://x.com/lucaronin) and for sharing it with others.
- 📋 **Standards-based** — Notes are markdown files with YAML frontmatter. No proprietary formats, no locked-in data. Everything works with standard tools if you decide to move away from Tolaria.
- 🔍 **Types as lenses, not schemas** — Types in Tolaria are navigation aids, not enforcement mechanisms. There's no required fields, no validation, just helpful categories for finding notes.
- 🪄**AI-first but not AI-only** — A vault of files works very well with AI agents, but you are free to use whatever you want. We support Claude Code, Codex CLI, and Gemini CLI setup paths, but you can edit the vault with any AI you want. We provide an AGENTS file for your agents to figure out.
- ⌨️ **Keyboard-first** — Tolaria is designed for power-users who want to use keyboard as much as possible. A lot of how we designed the Editor and the Command Palette is based on this.
- 💪 **Built from real use** — Tolaria was created for manage my personal vault of 10,000+ notes, and I use it every day. Every feature exists because it solved a real problem.

## Installation

### Homebrew

Install via Homebrew on macOS:

```batch
brew install --cask tolaria
```

### Download from releases

Download the [latest release here](https://refactoringhq.github.io/tolaria/download/) for macOS, Windows, or Linux. Windows installers are Authenticode-signed; company-managed devices may still require IT approval of the Tolaria publisher before first install.

## Getting started

When you open Tolaria for the first time you get the chance of cloning the [getting started vault](https://github.com/refactoringhq/tolaria-getting-started) — which gives you a walkthrough of the whole app.

The public user docs live in [`site/`](site/) and are published to GitHub Pages. Start with [Install Tolaria](site/start/install.md), then [First Launch](site/start/first-launch.md).

## Open source and local setup

Tolaria is open source and built with Tauri, React, and TypeScript. If you want to run or contribute to the app locally, here is [how to get started](https://github.com/refactoringhq/tolaria/blob/main/docs/GETTING-STARTED.md). You can also find the gist below 👇

### Prerequisites

- Node.js 20+
- pnpm 8+
- Rust stable
- macOS or Linux for development

#### Linux system dependencies

Tauri 2 on Linux requires WebKit2GTK 4.1 and GTK 3:

- Arch / Manjaro:
  ```bash
  sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
    appmenu-gtk-module libappindicator-gtk3 librsvg
  ```
- Debian / Ubuntu (22.04+):
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    libsoup-3.0-dev patchelf
  ```
- Fedora 38+:
  ```bash
  sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
    libappindicator-gtk3-devel librsvg2-devel
  ```

The bundled MCP server still spawns the system `node` binary at runtime on Linux, so install Node from your distro package manager if you want the external AI tooling flow.

### Quick start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` for the browser-based mock mode, or run the native desktop app with:

```bash
pnpm tauri dev
```

## Tech Docs

- 📐 [ARCHITECTURE.md](docs/ARCHITECTURE.md) — System design, tech stack, data flow
- 🧩 [ABSTRACTIONS.md](docs/ABSTRACTIONS.md) — Core abstractions and models
- 🚀 [GETTING-STARTED.md](docs/GETTING-STARTED.md) — How to navigate the codebase
- 📚 [ADRs](docs/adr) — Architecture Decision Records

## Security

If you believe you have found a security issue, please report it privately as described in [SECURITY.md](./SECURITY.md).

## License

Tolaria is licensed under AGPL-3.0-or-later. The Tolaria name and logo remain covered by the project’s trademark policy.
