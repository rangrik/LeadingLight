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
    And the release contains a DMG, an app ZIP and SHA-256 checksums
    And the app includes berthd, tmux, the transcription helper and license notices
    And its bundle version matches the release tag
    And unsigned builds are clearly marked as previews

  Scenario: Stop an incomplete release
    Given a check, runtime build, bundle check or upload fails
    When the release workflow finishes
    Then the release remains a draft and no incomplete release is published
    And a maintainer can retry the draft by its version tag
    And a retry cannot replace files in a published release

  Scenario: Untrusted contributions
    Given a pull request comes from a fork
    When checks run
    Then they have read-only repository access and no signing secrets
    And only the main branch can prepare or publish releases
