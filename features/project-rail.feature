Feature: Project rail
  A slim column at the window's far left, beside the sidebar, holds All and one button for each
  project that isn't done. Choosing a project narrows the sidebar to that project and gives the
  page area that project's own panes and tabs, so going back to a project puts you where you left
  it. All is the sidebar as it always was.

  Names used below:
  - rail: navigation "Projects", 44 px wide, left of the sidebar, the sidebar's colour, a hairline
    on its right like the bar's on its left
  - rail button: a 32 px rounded square in the rail, named by its project (or "All")
  - state dot: the 6 px dot at a rail button's top right corner
  - a project's pages: pages whose Project property (any relation to projects) points at it, and
    pages its own body links to
  - the demo: the browser build opened at "/?mac&demo" in an empty space

  Background:
    Given the app is open in a browser at 1280x800 with the demo

  Scenario: The rail lists All and the projects not done
    Then the rail shows, top to bottom, "All" with a layers icon, "LeadingLight" with its purple
      sun icon, and "Home office" as the letter "H" on a purple band
    And "All" is marked current: the sidebar-accent background
    And the top of "All" is level with the top of the logo tile in the sidebar header, below the
      traffic lights' row
    And the rail has a hairline on its right and nothing at its bottom; Settings stays in the sidebar
    When I set the Status of "Home office" to Done
    Then "Home office" leaves the rail

  Scenario: Hovering a project says how it is going
    When I hover "LeadingLight" in the rail
    Then a tooltip on its right reads "LeadingLight ⌘2" and under it "2 need you"
    And the button has an amber state dot, because the pricing agent asks a question
    When I hover "Home office"
    Then the tooltip reads "Home office ⌘3" and "quiet", and it has no state dot

  Scenario: A project with only an agent at work reads "working"
    Given the pricing question is answered and the audit is accepted
    When I hover "LeadingLight" in the rail
    Then the tooltip's second line reads "working" and the state dot is gone

  Scenario: Choosing a project scopes the sidebar
    When I click "LeadingLight" in the rail
    Then it is marked current and "All" is not
    And the sidebar header reads "LeadingLight" over "LeadingLight" (the project's name under the mark)
    And the sidebar starts with "Overview" and "Chat", then Today, Calendar and Browser
    And Types lists only Pages, People, Meetings and Tasks, each with a muted count (1, 1, 1, 7)
    And Recent lists only LeadingLight's pages: the four tasks at work, "Design review with Sam",
      "Sam Rivera" and "Pricing notes"; no book, no daily note, no other project
    When I click "Overview"
    Then the LeadingLight project page opens
    When I click "Chat"
    Then LeadingLight's chat opens

  Scenario: A project with no linked folder has no Chat row
    When I click "Home office" in the rail
    Then the sidebar starts with "Overview" alone, then Today
    And Types lists Pages (1) and Tasks (1), and Recent lists "Desk measurements"

  Scenario: A type row opens its list filtered to the project
    Given "LeadingLight" is chosen in the rail
    When I click "Tasks" in the sidebar
    Then the Tasks list opens showing the 7 tasks of LeadingLight, and not "Read chapter 3 of
      Thinking in Systems"
    And under its title a chip reads "LeadingLight" with the project's icon
    When I remove the chip
    Then the same list shows every task

  Scenario: Each project keeps its own panes and tabs
    Given "All" is chosen and "Notes on Thinking in Systems" is open
    When I click "LeadingLight" in the rail for the first time
    Then the LeadingLight project page opens alone
    When I open "Fix the tab row overflow" beside it
    And I click "All" in the rail
    Then "Notes on Thinking in Systems" is open alone again, as I left it
    When I press ⌘2
    Then LeadingLight comes back with its project page and "Fix the tab row overflow" side by side
    When I reload the page
    Then LeadingLight is still chosen, with the same two panes

  Scenario: Keys pick All and the projects in order
    When I press ⌘3
    Then "Home office" is chosen
    When I press ⌘1
    Then "All" is chosen
    When I press ⌘5, with only two projects on the rail
    Then nothing changes
    And Settings › Shortcuts lists "All, then each project on the rail" with the keys ⌘1–9, which
      can't be changed

  Scenario: All is today's sidebar
    Given "LeadingLight" was chosen
    When I click "All" in the rail
    Then the sidebar header reads "LeadingLight" over "Notes"
    And there is no "Overview" row, Types lists every type without counts, and Recent mixes every
      project's pages as before

  Scenario: A chosen project that is deleted or done falls back to All
    Given "Home office" is chosen
    When I delete the "Home office" page
    Then "All" is chosen and its panes come back

  Scenario: The rail hides with the sidebar
    When I press ⌘\
    Then the sidebar and the rail slide away together and the card takes the full width
    When I press ⌘\ again
    Then both come back, the rail at the far left
    And in a browser window narrower than 768 px, where the sidebar is a sheet, there is no rail

  Scenario: An empty space has only All
    Given an empty space opened without the demo
    Then the rail holds only "All", marked current
    And ⌘2 does nothing
