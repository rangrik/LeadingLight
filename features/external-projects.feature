Feature: A page linked to a folder
  Any page can be linked to a folder on this Mac: the page holds the project's thinking, the
  folder its files. Linking never copies, moves or writes anything in the folder. The page keeps
  its link by its own id, so a renamed page stays linked; the folder is known by its identity,
  not its path, so another path to the same folder (a link to it, another letter case) is the
  same folder. The project runtime (features/project-runtime.feature) checks the folder.

  Names used below:
  - "Link folder": the button among Add icon, Add cover and Add description above a page's title,
    shown on hover
  - the folder row: under the page's title, the linked folder's name and path, with a ··· menu
  - "~/LL QA/My Project": a folder holding notes.txt ("hello") and data/totals.csv

  Background:
    Given a page "Research" and a page "Other"

  Scenario: Link a folder to a page
    When I press "Link folder" on "Research"
    Then a dialog "Link a folder" opens with a path field, and in the app a Choose… button
    When I enter "~/LL QA/My Project" and press "Link folder"
    Then the dialog closes
    And "Research" shows the folder row "My Project" with its path
    And "~/LL QA/My Project" holds exactly what it held: notes.txt and data/totals.csv, unchanged

  Scenario: A path that is no folder
    When I link "Research" to "~/LL QA/Not There"
    Then the dialog stays open and says "No folder at ~/LL QA/Not There"
    And nothing is linked

  Scenario: The same folder by another path is not linked twice
    Given "Research" is linked to "~/LL QA/My Project"
    And "~/LL QA/Alias" is a link to "~/LL QA/My Project"
    When I link "Other" to "~/LL QA/Alias"
    Then the dialog says "That folder is already linked to Research", with Open Research
    And "Other" has no folder row

  Scenario: A link survives a reload, and a renamed page keeps it
    Given "Research" is linked to "~/LL QA/My Project"
    When I rename the page "Research notes" and reload
    Then "Research notes" still shows the folder row "My Project"

  Scenario: A moved folder is found again
    Given "Research" is linked to "~/LL QA/My Project"
    When the folder is renamed on disk to "~/LL QA/My Project 2"
    And I open "Research"
    Then the folder row says "Folder not found" with the old path, and Relink…
    When I press Relink… and enter "~/LL QA/My Project 2"
    Then it says "Same folder, moved" and the row shows "My Project 2" with its new path
    And anything kept for the page under its link is still there

  Scenario: Relinking to a different folder asks first
    Given "Research" is linked to "~/LL QA/My Project"
    When I relink it to "~/LL QA/Elsewhere"
    Then it says "This is a different folder from the one linked before" with "Link anyway"
    When I press "Link anyway"
    Then the row shows "Elsewhere"

  Scenario: Unlinking leaves the folder alone
    Given "Research" is linked to "~/LL QA/My Project"
    When I choose Unlink from the folder row's ··· menu
    Then the folder row is gone, the page is unchanged, and the folder holds what it held
