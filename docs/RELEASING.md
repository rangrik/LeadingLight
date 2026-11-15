# Releases

[GitHub Releases](https://github.com/rangrik/LeadingLight/releases) hosts the app.
GitHub Actions builds on a fresh Apple Silicon Mac; standard hosted runners are
free for this public repository. No personal access token or paid service is needed;
the Mac build is signed with the Apple secrets listed under Downloads and signing.

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
   that exact commit, then builds, signs, notarizes and checks the app. It uploads a DMG, a ZIP, the
   update archive with `latest.json`, and `SHA256SUMS.txt`, sends the iPhone and iPad build
   to TestFlight, and then publishes. Until every step succeeds, the draft stays private.

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
The draft must contain only the five generated assets; remove any unrelated
manually added file before retrying.

If the tagged source is broken, delete only its draft release in GitHub Releases
(keep its tag), merge a `fix:` commit, and run **Prepare release** for the next version.
The retained tag gives the release bot a baseline. Never move or reuse a published tag.
For a failure in workflow infrastructure, fix the workflow on `main` and retry;
the app source remains the draft's pinned commit.

To test packaging before a release, run **Publish release** with **rehearsal**
enabled and the tag blank, on `main` or on a branch
(`gh workflow run publish.yml --ref my-branch`). It builds, signs and verifies the same
downloads, stores them as workflow artifacts for seven days, and publishes nothing.
Only `main` can publish.

## Downloads and signing

Downloads are signed with a Developer ID and notarized by Apple. The app and the disk
image both carry Apple's ticket, so they open on a Mac that is offline. Releases are
normal releases and the newest is GitHub's latest; 0.2.0 was an unsigned preview.
Download from the release's **Assets** section. Quit LeadingLight before replacing
the app; its data remains in the user's application data directory.

Only Apple Silicon is supported by the pinned runtime build. The app requires
macOS 13 or later; on-device transcription needs macOS 26. Intel builds are not part of
this workflow.

The macOS job needs these repository secrets. Only the Apple account holder can make
them. Add each with `gh secret set NAME`; never put one in a commit, a PR or a chat.

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | The Developer ID Application certificate with its key, exported from Keychain Access as `.p12`: `base64 -i file.p12 \| gh secret set APPLE_CERTIFICATE` |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen at that export |
| `APPLE_API_KEY_P8` | An App Store Connect team key with Developer access, for notarization: `gh secret set APPLE_API_KEY_P8 < AuthKey_XXXX.p8` |
| `APPLE_API_KEY` | That key's Key ID |
| `APPLE_API_ISSUER` | The Issuer ID shown above the keys |

A missing secret stops the build before anything is signed. The certificate lasts five
years; after replacing it or the key, set the secrets again and run a rehearsal. The app
is compiled first and signed in a later step, so the secrets never sit beside a
dependency's build script. See
[Tauri's signing instructions](https://v2.tauri.app/distribute/sign/macos/).

A local `pnpm install:app` build stays ad-hoc signed. macOS treats it as a different app
from the signed one, so installing it over a release asks again for the microphone and
the Keychain.

## Updates

The Mac app reads `https://github.com/rangrik/LeadingLight/releases/latest/download/latest.json`
when it opens and every four hours, and offers a newer version with one button. GitHub
serves that address only for a normal release marked latest. The app installs only an
archive signed by the update key, whose public half is `plugins.updater.pubkey` in
`tauri.conf.json`; packaging refuses a release whose archive does not verify with it.

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The update key, made once with `pnpm --filter @leadinglight/desktop tauri signer generate -w ~/.tauri/leadinglight-updater.key`: `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/leadinglight-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password chosen then |

Keep the key and its password somewhere safe outside GitHub. If they are lost, installed
apps refuse every later update, and each needs one reinstall by hand. A dev app
(`pnpm install:dev-app`) has no update address.

## iPhone and iPad

The same release builds the iOS app, signs it for App Store Connect, has Apple validate
it, and uploads it to TestFlight once the Mac build has also passed. Only then is the
GitHub release published. The build number is the UTC minute (`2611142345`), so every
upload is newer than the last. A rehearsal does everything except the upload.

An app there cannot replace itself. After a release has been out 45 minutes, time for
TestFlight to process it, the app says the version is in TestFlight and its button opens
TestFlight, where Update installs it. With TestFlight's automatic updates on, it arrives
by itself. Internal testers need no Apple review. A TestFlight build stops opening 90
days after its upload, so release at least that often.

| Secret | What it is |
| --- | --- |
| `IOS_CERTIFICATE` | The Apple Distribution certificate with its key, exported as `.p12`: `base64 -i file.p12 \| gh secret set IOS_CERTIFICATE` |
| `IOS_CERTIFICATE_PASSWORD` | The password chosen at that export |
| `IOS_MOBILE_PROVISION` | An App Store Connect provisioning profile for `com.leadinglight.app` made with that certificate: `base64 -i file.mobileprovision \| gh secret set IOS_MOBILE_PROVISION` |

The upload uses the App Store Connect key above. The certificate and profile end
together each November; make new ones, set the three secrets again and run a rehearsal.
Once, in App Store Connect: create the app record for `com.leadinglight.app`, answer the
export compliance questions for the first build, and make an internal testing group with
automatic distribution. `docs/IPAD.md` has the local steps.

## Maintenance

Actions are pinned to commit hashes; Dependabot proposes weekly updates. Node and
Rust versions are pinned in the workflows. Runtime sources and checksums stay in
`runtime/*/UPSTREAM.json`. Update these deliberately and test a complete release.
PR checks have read-only permissions and no release secrets. Publication accepts
only drafts on `main`, with a tag matching a commit in `main` and every app version.
The Vercel key is unrelated to releases and must never enter a desktop build.
