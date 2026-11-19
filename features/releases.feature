Feature: Versioned GitHub releases
  Releases are built from an exact commit and stay drafts until the downloads are complete.

  Scenario: Prepare the next version
    Given a feature or fix reaches main with a conventional commit title
    When GitHub checks pass
    Then a release pull request updates the changelog and the desktop, Tauri and Cargo versions together
    And features bump the minor version and fixes bump the patch version
    And changes below version 1.0 keep breaking changes within version 0

  Scenario: Publish a release
    Given the release pull request has been merged
    When the checks and Apple Silicon build pass
    Then GitHub publishes a versioned release with the reviewed release notes
    And the release contains a DMG, an app ZIP, the update archive with its manifest, and SHA-256 checksums
    And the update archive verifies with the update key the app carries
    And the app includes berthd, tmux, the transcription helper and license notices
    And its bundle version matches the release tag
    And the app and the disk image are signed with a Developer ID, notarized by Apple and carry the ticket
    And the release is a normal release, marked as GitHub's latest

  Scenario: Attach the iPhone and iPad build
    Given the release pull request has been merged
    When the checks, the Apple Silicon build and the iOS build pass
    Then the iOS build is signed Ad Hoc for the registered devices and carries the release's version
    And its build number is the UTC minute it was built, so each build is newer than the last
    And the release carries the build and the manifest its install link reads
    And nothing goes to TestFlight or App Store Connect

  Scenario: Keep recordings from both release checks
    Given a merged release runs checks before preparation and again for the exact release commit
    When both passes upload their browser videos and reports
    Then artifact names identify the initial pass, the pinned release commit and the run attempt
    And rerunning the workflow keeps the earlier attempt's recordings

  Scenario: Browser dependencies bypass the slow regional mirror
    Given the Ubuntu runner lists the slow AWS package mirror before Ubuntu's main archive
    When release checks install Chromium and WebKit dependencies
    Then the AWS mirror is removed from the runner's mirror list
    And Ubuntu's main archive and security fallback remain available
    And both browsers still run the recorded feature checks

  Scenario: A signing secret is missing
    Given the Developer ID certificate or the App Store Connect key is not in the repository's secrets
    When the Apple Silicon build reaches signing
    Then it stops and points to docs/RELEASING.md
    And nothing unsigned is published
    And a missing iOS certificate or profile stops the iOS build the same way

  Scenario: Stop an incomplete release
    Given a check, runtime build, signing, notarization, bundle check or upload fails
    When the release workflow finishes
    Then the release remains a draft and no incomplete release is published
    And a maintainer can retry the draft by its version tag
    And a retry cannot replace files in a published release

  Scenario: Deploy the matching cloud before publishing the app
    Given a reviewed release has passed checks and both app builds
    When the release workflow runs on main
    Then it deploys the release's exact commit to the existing cloud project
    And Vercel runs the database migration before serving the new cloud code
    And the workflow checks native publishing and the public reader on the production address
    And that check sends no real account credential or page content
    And only after the cloud check passes are the app downloads published
    And production release workflows run one at a time

  Scenario: A cloud deployment fails
    Given a release's app downloads have been built
    When the deployment credential is missing, the cloud build fails, or the live check fails
    Then the release stays a draft and the installed app is not offered that release
    And retrying the draft deploys the same release commit with the current deployment tools
    And running the live check through a symlink still performs it

  Scenario: Rehearse a build
    Given I run Publish release on main or on a branch with rehearsal enabled
    When checks, signing and packaging pass
    Then the workflow stores the same signed downloads as build artifacts
    And it creates no tag or GitHub release
    And it neither reads the production deployment credential nor deploys the cloud

  Scenario: A branch cannot publish
    Given I run Publish release on a branch with rehearsal disabled
    Then nothing is built and nothing is published

  Scenario: Untrusted contributions
    Given a pull request comes from a fork
    When checks run
    Then they have read-only repository access and no signing secrets
    And the cloud deployment credential is restricted to main
    And only the main branch can prepare or publish releases
