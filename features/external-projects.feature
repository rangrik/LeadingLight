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

  # A GitHub checkout (slice 6)

  Scenario: Clone a repository and link it
    When I press Link folder, choose GitHub, enter "octocat/Hello-World" and Clone
    Then git's progress shows under the field while it clones into "~/Developer/Hello-World"
    And the page is linked to the new checkout, and its chat works there

  Scenario: A private repository, through this Mac's own Git sign-in
    Given git on this Mac can reach a private repository of mine (its credential helper or SSH)
    When I clone it the same way
    Then it clones and links without asking me for a password in LeadingLight

  Scenario: Cancel a clone
    When I press Cancel while a large repository is cloning
    Then the clone stops, and no half-made folder is left in "~/Developer"

  Scenario: The checkout is already there
    Given "~/Developer/Hello-World" exists, with files I changed and haven't committed
    When I clone "octocat/Hello-World" into "~/Developer"
    Then it says the folder is already there and offers Link it
    When I press Link it
    Then the page is linked to that checkout, and my changed files are as they were

  Scenario: A wrong repository says why
    When I clone "octocat/no-such-repository-here"
    Then it says git couldn't find it, and nothing is made or linked

