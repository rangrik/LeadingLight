---
title: Install
description: Download the LeadingLight preview for an Apple Silicon Mac, allow it to open, and update it later.
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

## Allow the app to open

The previews are not signed with an Apple Developer ID or notarized by Apple, so the first time you open LeadingLight macOS says it can't check it.

1. Open LeadingLight once and dismiss the message.
2. Open **System Settings › Privacy & Security**.
3. Scroll to **Security**. Beside the note about LeadingLight, click **Open Anyway**, then confirm with your password or Touch ID.

LeadingLight opens, and macOS remembers your choice.

::: details macOS says the app "is damaged and can't be opened"
This can happen with unsigned downloads. It means macOS has marked the download as from the internet and refuses it without offering **Open Anyway**. Only if you trust the build you downloaded from the official releases page, you can remove that mark from this one app in Terminal:

```sh
xattr -dr com.apple.quarantine /Applications/LeadingLight.app
```

Then open LeadingLight again.
:::

## The first time you open it

LeadingLight starts with an empty space and a sidebar of starter types: Pages, Tags, Daily notes, People, Books, Meetings, Projects, Tasks, Ideas and Collections. Click **New page** to write your first page, or follow [Your first ten minutes](/guide/first-steps).

macOS may ask for permissions later, only when you use a feature that needs one: the microphone for a voice note, or speech recognition for its transcript.

## Update to a new version

The app doesn't update itself yet.

1. Quit LeadingLight (<kbd>⌘Q</kbd>).
2. Download the new release and drag it into **Applications**, replacing the old app.
3. Open it. You may need to allow it once more in **Privacy & Security**.

Your notes are kept in the app's data folder, not inside the app, so replacing the app leaves them as they were. What changed in each version is in the [changelog](https://github.com/rangrik/LeadingLight/blob/main/CHANGELOG.md).

## Where your notes are

Everything you write is in a single SQLite file, `leadinglight.db`, in `~/Library/Application Support/com.leadinglight.app/`, with images and files you add stored next to it. To back up your notes, quit LeadingLight and copy that folder. Page history lives in the same store. See [Your data and privacy](/guide/privacy).

## Uninstall

Quit LeadingLight and move it from Applications to the Trash. To remove your notes too, delete `~/Library/Application Support/com.leadinglight.app/`. This can't be undone.

## Other ways to run it

- **Build it yourself** on a Mac with Node, pnpm and Rust: see [Build from source](/develop/).
- **iPad:** see [LeadingLight on iPad](/sync/ipad).
