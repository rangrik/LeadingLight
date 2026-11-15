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

  Scenario: Rehearse a build
    Given I run Publish release on main or on a branch with rehearsal enabled
    When checks, signing and packaging pass
    Then the workflow stores the same signed downloads as build artifacts
    And it creates no tag or GitHub release

  Scenario: A branch cannot publish
    Given I run Publish release on a branch with rehearsal disabled
    Then nothing is built and nothing is published

  Scenario: Untrusted contributions
    Given a pull request comes from a fork
    When checks run
    Then they have read-only repository access and no signing secrets
    And only the main branch can prepare or publish releases
