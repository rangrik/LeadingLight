# Releases

[GitHub Releases](https://github.com/rangrik/LeadingLight/releases) hosts the app.
GitHub Actions builds on a fresh Apple Silicon Mac; standard hosted runners are
free for this public repository. No personal access token or paid service is needed.

## Normal release

1. Use conventional titles for commits on `main` (or squash-merged PR titles):
   `feat: add calendar view`, `fix: preserve cover position`, `perf: speed up search`.
   Features bump minor, fixes bump patch. `feat!: change storage format` marks a
   breaking change; below 1.0 that bumps minor, then major from 1.0 onward.
2. **Prepare release** runs checks and maintains one release PR with version changes
   and grouped release notes. Review the release section of the PR description;
   edit it and `CHANGELOG.md` together when users need more context. The PR
   description becomes the GitHub release notes. Non-conventional titles do not
   produce release notes. Documentation and CI changes appear when a release is due.
3. Approve and run **Checks** on the bot's PR when GitHub requests approval, or run
   **Checks** manually on its branch. Merge the release PR once those checks pass.
   The workflow creates a tag and draft, validates
   that exact commit, then builds and checks the app. It uploads a DMG, ZIP and
   `SHA256SUMS.txt` before publishing. Until every step succeeds, the draft stays private.

Release Please updates `version.txt`, the Rust package and `Cargo.lock`, plus the desktop
`package.json`, Tauri config and release manifest. Do not bump them separately.
To request a specific version, add `Release-As: 0.3.0` to a conventional commit body.

The built-in GitHub token cannot trigger another workflow through a bot-created
PR or release. Publication therefore runs as a reusable job in the same workflow.
Bot-created release PR checks may need manual approval or dispatch; merge validation runs
before any release is created, and the exact release commit is checked again.
You can also run **Checks** manually on the release PR's branch before merging.

## Retry a failed release

Open Actions → **Publish release** → **Run workflow**, choose `main`, disable
**rehearsal** and enter the existing draft tag (for example `v0.2.0`). This rebuilds its exact commit, replaces
only draft assets, and publishes on success. A published version cannot be overwritten.
While a draft is unfinished, **Prepare release** stops instead of starting another.
The draft must contain only the three generated assets; remove any unrelated
manually added file before retrying.

If the tagged source is broken, delete only its draft release in GitHub Releases
(keep its tag), merge a `fix:` commit, and run **Prepare release** for the next version.
The retained tag gives the release bot a baseline. Never move or reuse a published tag.
For a failure in workflow infrastructure, fix the workflow on `main` and retry;
the app source remains the draft's pinned commit.

To test packaging before a release, run **Publish release** on `main` with
**rehearsal** enabled and the tag blank. It builds and verifies the same downloads,
stores them as workflow artifacts for seven days, and publishes nothing.

## Downloads and signing

Current downloads are **unsigned previews**, ad-hoc signed but without Developer ID
signing or Apple notarization. macOS may block them or require approval in Privacy &
Security. They are marked as prereleases and never promoted to GitHub's latest stable.
Download from the release's **Assets** section. Quit LeadingLight before replacing
the app; its data remains in the user's application data directory.

Only Apple Silicon is supported by the pinned runtime build. The app requires
macOS 13 or later; on-device transcription needs macOS 26. Intel builds and in-app
automatic updates are not part of this workflow.

For Developer ID distribution, add signing and notarization to the macOS job once
an Apple Developer membership and certificate are available. Never commit a signing
key or put it in a PR; use GitHub Actions secrets. See
[Tauri's signing instructions](https://v2.tauri.app/distribute/sign/macos/).

## Maintenance

Actions are pinned to commit hashes; Dependabot proposes weekly updates. Node and
Rust versions are pinned in the workflows. Runtime sources and checksums stay in
`runtime/*/UPSTREAM.json`. Update these deliberately and test a complete release.
PR checks have read-only permissions and no release secrets. Publication accepts
only drafts on `main`, with a tag matching a commit in `main` and every app version.
The Vercel key is unrelated to releases and must never enter a desktop build.
