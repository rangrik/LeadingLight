Feature: The sidebar leads with work
  The sidebar reads Today, then Projects (the work in progress), then Pinned, a folded Library
  that holds Calendar, Browser and the type rows, and Recent. Recent lists every page, so it goes
  last: under it the Library would be out of reach. A project's row says whether it needs you;
  its chevron unfolds what is going on in it.

  Names used below:
  - the demo: the browser build opened at "/?mac&demo" (apps/desktop/qa/demo/seed.js)
  - a project's pages: pages that name it in a relation property whose type is Project (a
    meeting's Project, a task's Project), or that its own page links to; tasks, tags and daily
    notes aside
  - its tasks at work: its top-level tasks with an agent or a started subtask, not done (the same
    tasks as the Work table on the project page)
  - needing you: the Feed's questions, approvals and work ready for review for that project
  - state dot: amber needs your input, green ready for review, blue working (as on task rows)

  Background:
    Given the app is open in a browser at 1280x900

  Scenario: The order of the sidebar
    Given the demo
    Then the sidebar reads, top to bottom: "Today", "Projects", "Pinned" (while a page is pinned),
      "Library", "Recent"
    And "Calendar", "Browser" and the type rows are not shown until "Library" is unfolded
    And the first Recent row is in view without scrolling, with "LeadingLight" unfolded too

  Scenario: One row per project that is not done
    Given the demo
    Then "Projects" lists "LeadingLight" then "Home office", each with its own icon
    And the last row is "All projects"
    When I set Home office's Status to "Done"
    Then "Home office" leaves "Projects"
    And clicking "All projects" opens the Projects list, which still shows "Home office"

  Scenario: What needs you comes first
    Given the demo
    Then "LeadingLight" shows "2" and an amber dot at its right: the pricing question and the
      empty-states audit ready for review
    And hovering the dot shows "Needs your input"
    And "Home office" shows no count and no dot
    And "LeadingLight" is above "Home office" even when Home office was edited last

  Scenario: The dot is the most urgent state
    Given a project whose only task at work is working
    Then its row shows a blue dot and no count
    When its agent publishes a report marked ready
    Then the dot turns green and the count shows "1"
    When another of its tasks asks a question
    Then the dot turns amber and the count shows "2"

  Scenario: Projects with nothing for you go by their last edit
    Given two projects with nothing needing you, "A" edited yesterday and "B" two days ago
    When I edit a meeting whose Project is "B"
    Then "B" moves above "A"

  Scenario: Opening a project
    Given the demo
    When I click "LeadingLight" in Projects
    Then the LeadingLight page opens in the focused card and its row reads as current
    When I Shift-click "Home office"
    Then Home office opens in a card beside it
    When I drag "Home office" to the right edge of the stage
    Then it opens in a new pane there

  Scenario: Unfolding a project
    Given the demo
    When I click the chevron left of "LeadingLight"
    Then the chevron turns down and under the row, on the same tree as Recent's children, are
      its tasks at work, most urgent first, then its three latest pages, newest first:
      | Write the pricing page copy | amber dot |
      | Audit the empty states      | green dot |
      | Fix the tab row overflow    | blue dot  |
      | Design review with Sam      |           |
      | Pricing notes               |           |
      | Sam Rivera                  |           |
    And the done task "Rename Pages to Notes in the sidebar" and the unassigned
      "Call Sam about the invoice before Friday" are not among them
    When I click "Fix the tab row overflow"
    Then the task opens and its sub-row reads as current; LeadingLight's page is not opened
    When I click the chevron again
    Then the rows fold away

  Scenario: Only the three most recent pages
    Given a project with five pages related to it
    When I unfold it
    Then only the three most recently edited of them are listed, newest first

  Scenario: A project with nothing in it yet
    Given the demo
    When I unfold "Home office"
    Then it shows "Nothing here yet" in muted text, which does nothing when clicked

  Scenario: Unfolded rows are remembered
    Given the demo with "LeadingLight" unfolded
    When I reload the page
    Then "LeadingLight" is still unfolded and "Home office" is still folded

  Scenario: The Library folds
    Given the demo, opened for the first time
    Then "Library" is folded, its chevron pointing right
    When I click "Library"
    Then Calendar, Browser and the type rows show under it, its chevron pointing down
    And dragging "Books" to a pane edge, Shift-clicking "Tasks" and clicking "Calendar" work as before
    When I reload the page
    Then "Library" is still unfolded
    When I fold it and reload
    Then it is folded

  Scenario: An empty space
    Given a space with no pages
    Then there is no "Projects" group
    And "Library" is unfolded, showing Calendar, Browser and every type
    When I make a project from the Projects list
    Then "Projects" appears with its row, and "Library" stays unfolded under the pointer
    When I reload the page
    Then "Library" starts folded, as I never chose

  Scenario: What stays the same
    Given the demo
    Then Meta+Backslash still hides and shows the sidebar
    And Pinned and Recent rows keep their menus (Rename, Pin, Copy link, Delete) and renaming
    And the Settings row and the usage footer are where they were
