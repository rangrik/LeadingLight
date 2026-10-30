---
title: Releases
description: Where LeadingLight's downloads live, what each release contains, how to check a download, and how releases are made.
---

# Releases

Every version of LeadingLight is published on GitHub, built from an exact commit by GitHub Actions. This page explains what a release contains, how to check that a download is intact, and how a release is made.

## Where to download

Downloads live on the [GitHub Releases page](https://github.com/rangrik/LeadingLight/releases). Open a release and look in its **Assets** section. What changed in each version is in the [changelog](https://github.com/rangrik/LeadingLight/blob/main/CHANGELOG.md), and in each release's notes.

For step-by-step installation, see [Install](/guide/install).

## What a release contains

Each release has exactly three files:

| File | What it is for |
| --- | --- |
| `LeadingLight_<version>_macos-arm64.dmg` | The disk image. Use this to install. |
| `LeadingLight_<version>_macos-arm64.app.zip` | The same app bundle, as a ZIP. |
| `SHA256SUMS.txt` | The SHA-256 checksum of each of the other two files. |

The app inside carries everything it needs to run, including the project runtime, tmux, the transcription helper and their license notices. Its version matches the release's tag.

## Check a download

A checksum tells you the file you downloaded is exactly the one that was built. Download `SHA256SUMS.txt` into the same folder as the DMG or ZIP, then in Terminal:

```sh
cd ~/Downloads
shasum -a 256 LeadingLight_0.2.0_macos-arm64.dmg
cat SHA256SUMS.txt
```

Use the file name of the version you downloaded. The long string `shasum` prints must match the one beside that file's name in `SHA256SUMS.txt`. If you downloaded both the DMG and the ZIP, you can check both in one step:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

Each file should be reported as `OK`.

## Before you install

- **Apple Silicon only.** Releases are built for M-series Macs. There are no Intel builds.
- **macOS 13 or later.** Voice transcription on the device needs macOS 26.
- **Unsigned previews.** The app is ad-hoc signed, without an Apple Developer ID or Apple's notarization. macOS may block it the first time, or ask you to allow it in **System Settings › Privacy & Security**. Every release is marked as a prerelease on GitHub, never as the latest stable one.
- **No automatic updates.** To update, quit LeadingLight, then replace the app with the new one. Your notes stay where they are, in the app's data folder.

## How releases are made

Releases come from the history of `main`, with no hand-edited version numbers.

1. **Conventional commit titles.** Each change on `main` has a title such as `feat: add calendar view`, `fix: preserve cover position` or `perf: speed up search`. A feature bumps the minor version and a fix bumps the patch version. `feat!:` marks a breaking change; below 1.0 that bumps the minor version too. Titles that don't follow this form don't appear in the release notes.
2. **A release pull request.** Release Please keeps one open pull request for the next version. It updates the changelog and every version number together (the desktop app, the Tauri config and the Rust package), and its description becomes the release notes, so a maintainer can review and edit them there.
3. **Build.** When that pull request is merged and its checks pass, the workflow tags the commit and makes a private draft release. It checks that exact commit again, builds the app on a fresh Apple Silicon Mac, and verifies the downloads.
4. **Publish.** It uploads the DMG, the ZIP and `SHA256SUMS.txt`, checks that each uploaded file matches, and only then publishes the release.

If any step fails, the release stays a private draft, and nothing incomplete is published. A maintainer can retry the draft by its tag; a published release can never have its files replaced. A maintainer can also rehearse a build: it makes the same downloads and keeps them as workflow artifacts for seven days, without tagging or publishing anything.

Pull requests from forks run their checks with read-only access and no release secrets, and only `main` can prepare or publish a release.

The maintainer's full steps are in [docs/RELEASING.md](https://github.com/rangrik/LeadingLight/blob/main/docs/RELEASING.md).

## Related

- [Install](/guide/install)
- [Build from source](/develop/)
- [Contributing](/develop/contributing)
- [FAQ and known limits](/guide/faq)
