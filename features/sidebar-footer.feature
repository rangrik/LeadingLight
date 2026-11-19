Feature: A quiet sidebar footer
  The bottom of the sidebar is two lines: how much of each plan is used, then one row of icon
  buttons. Each icon names itself in a tooltip, so the footer stays short without losing words.

  Names used below:
  - the usage line: button "Usage" (see usage.feature)
  - the toolbar: the row of icon buttons under it

  Scenario: Two lines on the Mac
    Given the sidebar is 256 px wide
    Then the footer is the usage line, then the toolbar, and nothing else
    And the toolbar has Notes and Browser as one two-icon segmented control, then Remote work, on the left
    And Account and sync, then Settings, sit at the right end
    And the mode control and each button are 28 px tall with 16 px icons centred, all on one line
    And the first icon starts where "Claude" starts, and the gear ends where "4%" ends
    And the footer is 88 px tall, where it was 218 px

  Scenario: Each icon says what it is
    When I hover each toolbar control
    Then its tooltip reads "Notes · ⌥⌘B", "Browser · ⌥⌘B", "Remote work", "Account and sync" and "Settings · ⌘,"
    And a screen reader hears the same names
    And no control relies on the browser's title tooltip
    When I close Remote work and focus returns to its icon with its tooltip showing
    Then a click on the usage line still opens the usage card

  Scenario: Switching mode from the toolbar
    When I click the Browser icon
    Then Browser is the selected segment and the sidebar header reads "Browser"
    When I press ⌥⌘B
    Then Notes is selected again and the header reads "Notes"

  Scenario: The buttons still open their places
    When I click Settings
    Then Settings opens
    When I click Account and sync
    Then Settings opens on Account and devices
    When I click Remote work
    Then the Remote work window opens

  Scenario: Remote work only where it works
    Given remote work is not available here
    Then the toolbar has no Remote work button and leaves no gap for it

  Scenario: Narrow and wide sidebars
    When I drag the sidebar to 200 px, then to 400 px
    Then the toolbar stays one row, its right pair stays at the right edge
    And nothing in the footer is cut off or wraps

  Scenario: iPad
    Given the iPad layout
    Then the toolbar shows Remote work on the left and Account and sync and Settings on the right
    And there is no mode control and no usage line
    And each button can be tapped across 44 px without overlapping its neighbour's

  Scenario: Toasts never cover the footer
    Given the sidebar is open
    When a toast appears, such as "Codex update available"
    Then it fits over the sidebar, just above the footer, and covers no page
    And every footer control, and the page beside it, can still be clicked while it shows
    When the sidebar is hidden
    Then toasts return to the window's bottom left corner
