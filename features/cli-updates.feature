Feature: Keeping Claude Code and Codex up to date
  The app finds the Claude Code and Codex command-line tools on this Mac, as your Terminal does,
  says which version each is and how it was installed, and updates them, after synara. A newer
  version is looked up where that install gets its updates: npm, or Homebrew. Claude Code's own
  installer updates itself, so for it there is only an Update button, never a prompt. In a
  browser build a stand-in plays both tools: Claude Code 2.1.308 from its own installer, and
  Codex 0.153.4 from Homebrew, behind 0.163.0. ?clis=current makes both up to date, ?clis=fail
  makes an update fail.

  Names used below:
  - the update toast: a toast at the bottom right titled "Codex update available"
  - the tools group: group "Command-line tools" in Settings › AI

  Scenario: A newer Codex is found
    Given the app has been open for about 10 seconds
    Then the update toast shows, with a warning icon, the line "Codex has a newer version
      available." and the buttons "Update all", "Review" and "Skip"
    And left alone it goes after 15 seconds, so it never covers the Ask panel for long, and
      shows again at an hourly check, never sooner, even across a relaunch
    When I click "Skip" (or Update all, or Review)
    Then it doesn't show again for Codex 0.163.0, even after a reload
    And a newer Codex than that brings it back
    And updating Codex from Settings takes a toast still showing away

  Scenario: Update all
    Given the update toast shows
    When I click "Update all"
    Then a toast reads "Updating Codex…" with a spinner
    And then "Codex updated", "New sessions use the new version.", and it goes after a few seconds
    And the tools group shows Codex as current

  Scenario: An update fails
    Given ?clis=fail and the update toast shows
    When I click "Update all"
    Then a toast reads "Couldn't update Codex", with the reason and the command to run in Terminal

  Scenario: Review
    When I click "Review" in the update toast
    Then Settings › AI opens on the tools group
    And it lists Claude Code: "2.1.308 · its own installer", with "Updates itself" and an Update button
    And Codex: "0.153.4 · Homebrew", with "0.153.4 → 0.163.0" and an Update button
    And each row's path shows on hover, and its update command under the button's tooltip
    When I click Codex's Update button
    Then it reads "Updating" with a spinner, then the row reads "Current 0.163.0"

  Scenario: Checking can be turned off
    When I turn off "Check for updates" in the tools group
    Then no update toast shows after a reload, and the rows still say what is installed

  Scenario: A tool that isn't installed
    Given Codex is not installed
    Then its row reads "Not installed", with a link to how to install it, and no toast mentions it
