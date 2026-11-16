---
title: Install
description: Download the LeadingLight preview for an Apple Silicon Mac, open it, and update it later.
---

# Install

LeadingLight is downloaded from its GitHub releases. Each release is a preview build for Apple Silicon Macs.

## Before you start

- **A Mac with Apple Silicon** (an M-series chip). There are no Intel builds.
- **macOS 13 Ventura or later.** Transcribing voice notes on your Mac needs macOS 26.
- **Optional, for the AI features:** [Claude Code](https://claude.com/code) or the [Codex CLI](https://developers.openai.com/codex/cli), installed and signed in. Notes work without either. See [AI and agents](/ai/).

## Download and install

1. Open the [releases page](https://github.com/rangrik/LeadingLight/releases) and choose the newest release.
2. Under **Assets**, download `LeadingLight_<version>_macos-arm64.dmg`. (The `.app.zip` holds the same app.)
3. Open the DMG and drag **LeadingLight** into **Applications**.
4. Open LeadingLight from Applications.

If you want to be sure the file is intact, compare its checksum with the release's `SHA256SUMS.txt`. See [Check a download](/develop/releases#check-a-download).

## Open it

LeadingLight is signed with an Apple Developer ID and notarized by Apple. The first time you open it, macOS asks whether to open an app downloaded from the internet. Click **Open**.

## The first time you open it

LeadingLight starts with an empty space and a sidebar of starter types: Pages, Notebooks, Tags, Daily notes, People, Books, Meetings, Projects, Tasks, Ideas and Collections. Click **New page** to write your first page, or follow [Your first ten minutes](/guide/first-steps).

macOS may ask for permissions later, only when you use a feature that needs one: the microphone for a voice note, or speech recognition for its transcript.

## Update to a new version

LeadingLight looks for a newer release when it opens and every four hours. When one is ready, a toast says so, such as "LeadingLight 0.6.0 is ready". Click **Update and restart**. It downloads the update, checks that it is LeadingLight's, installs it and reopens. Nothing is downloaded before you click.

- **Later** hides the toast for that version, even after you quit and reopen. **Settings › About** still offers **Update and restart**, and a newer version brings the toast back.
- To look yourself, open **Settings › About** and click **Check for updates**. It says **Up to date**, or **Couldn't check for updates** when you are offline.
- If the update can't be installed, a toast says "Couldn't update LeadingLight", with the reason and **Download**, which opens the release page. The app you have keeps running, unchanged.

A dev app (`pnpm install:dev-app`) and the web app never offer an update.

Version 0.2.0 can't update itself. Replace it once by hand: quit LeadingLight, download the newest release and drag it into **Applications** over the old app.

Your notes are kept in the app's data folder, not inside the app, so replacing the app leaves them as they were. What changed in each version is in the [changelog](https://github.com/rangrik/LeadingLight/blob/main/CHANGELOG.md).

## Where your notes are

Everything you write is in a single SQLite file, `leadinglight.db`, in `~/Library/Application Support/com.leadinglight.app/`, with the images and files you add in an `assets` folder beside it. To back up your notes, quit LeadingLight and copy that folder. Page history lives in the same store. See [Your data and privacy](/guide/privacy).

## Uninstall

Quit LeadingLight and move it from Applications to the Trash. To remove your notes too, delete `~/Library/Application Support/com.leadinglight.app/`. This can't be undone.

## Other ways to run it

- **Build it yourself** on a Mac with Node, pnpm and Rust: see [Build from source](/develop/).
- **iPhone and iPad:** each release also carries an iPhone and iPad build. It installs only on
  devices registered to the project, never through the App Store or TestFlight, and then updates
  itself. See [LeadingLight on iPad](/sync/ipad#how-to-get-it) and
  [LeadingLight on iPhone](/sync/iphone#get-the-app).
