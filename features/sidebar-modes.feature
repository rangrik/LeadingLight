Feature: One sidebar for notes and browsing
  Notes and Browser share a sidebar. Its mode does not decide which panes are open.

  Scenario: A quiet notes sidebar
    Given I have saved pages and pinned pages
    Then Notes shows search, New page, shortcuts, Pinned and Library
    And there is no Recent list or mode dropdown
    When I open Library
    Then I can find every listed page, browse its type, pin it, rename it or delete it
    When I search for a page that is not pinned
    Then I can open it from the sidebar
    And a search with no matches says so

  Scenario: Change mode without changing panes
    Given I am editing a note beside a browser page
    When I choose Browser in the sidebar footer or press Option Command B
    Then the sidebar shows my pinned sites and tabs
    And both panes, my edits and the keyboard's pane stay as they were
    When I swipe horizontally over the sidebar
    Then its mode changes once per gesture
    And vertical scrolling, a small diagonal movement and pinching do not change mode
    And shortcuts do not change mode behind a dialog or Settings

  Scenario: Open beside from either mode
    Given a note is open
    When I Shift-click a browser tab or choose Open beside from its menu
    Then the browser opens beside my note
    When I choose another browser tab
    Then only the browser pane changes
    When I switch to Notes and choose another note
    Then only the notes pane changes
    And I can resize the divider and close either pane
    And opening Browser beside again focuses the existing browser pane

  Scenario: One available sidebar toggle
    Given two panes are open and the sidebar is visible
    Then only the sidebar has a sidebar toggle
    When I hide the sidebar
    Then only the first pane has a sidebar toggle
    And the hidden sidebar cannot receive keyboard focus
    When I show it again
    Then only the sidebar has a sidebar toggle

  Scenario: Keep the workspace after restarting
    Given a note is beside a browser page and the sidebar is in Notes mode
    When I restart
    Then both panes return with the same note and browser tab
    And the sidebar stays in Notes mode
    And my edits and pinned pages remain

  Scenario: The keyboard follows the pane
    Given a note is beside a native browser page
    When I click in the note and press Command W
    Then its pane tab closes and the browser tab remains
    When I click the native browser page and press Command L
    Then its address opens for editing
    And browser shortcuts act on the browser regardless of sidebar mode
    When I open Settings or a dialog over the native page
    Then it cannot cover the app's controls

  Scenario: Empty and narrow workspaces
    Given the last browser tab is closed
    Then its pane offers New tab
    When I use a narrow window or collapse a pane
    Then the browser view stays inside its visible pane
    And a hidden browser pane cannot cover a note
    And both modes remain reachable in the sidebar sheet
