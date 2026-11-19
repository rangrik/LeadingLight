Feature: One sidebar for notes and browsing
  Pages and browser tabs share one sidebar. There is no mode to switch: what I click opens in
  its own pane, and the rest of the sidebar stays as it was.

  Names used below:
  - Pinned: navigation "Pinned", holding list "Pinned sites" (tiles) above the pinned pages
  - Tabs: list "Tabs", under the row "New tab"; "Saved" and "History" are icons beside its label

  Scenario: Notes and tabs in one list
    Given I am in the Mac app with two pinned pages, one pinned site and two open tabs
    Then the sidebar reads, top to bottom: Search library, New page with its type picker,
      Today, Calendar and Mail, Pinned, Tabs
    And Pinned shows the site's tile above the two pages
    And Tabs shows Saved and History beside its label, then New tab, then the two tabs
    And there is no Notes or Browser switch, and the header reads "Notes"
    And swiping sideways over the sidebar changes nothing

  Scenario: Go between a note and a website
    Given the note "Kyoto research" and the tab "Walking-guide" are open
    When I click "Walking-guide" under Tabs
    Then its page shows and Pinned still lists my pages
    When I click a pinned page
    Then the note shows and Tabs still lists "Walking-guide"
    And my edits are as I left them

  Scenario: Open a new tab
    Given no tab is open
    Then Tabs shows only the New tab row
    When I click New tab
    Then the command bar opens with the cursor in it
    When I type an address and press Return
    Then its tab is listed under New tab and its page shows

  Scenario: Pin a site
    When I choose Pin from a tab's menu
    Then its tile joins Pinned, above the pinned pages, and its row leaves Tabs
    When I choose Unpin from the tile's menu
    Then its row is back under Tabs

  Scenario: Saved and History
    When I point at the two icons beside Tabs
    Then their tooltips read "Saved" and "History"
    When I click Saved
    Then the browser pane lists my saved pages and the icon stays lit
    When I click Saved again
    Then the pane shows the tab I was on

  Scenario: Open beside
    Given a note is open
    When I Shift-click a browser tab or choose Open beside from its menu
    Then the browser opens beside my note
    When I choose another browser tab
    Then only the browser pane changes
    When I choose another note
    Then only the notes pane changes
    And I can resize the divider and close either pane
    And opening Browser beside again focuses the existing browser pane

  Scenario: ⌥⌘B opens the browser
    Given a note has the keyboard and a tab is open in another pane
    When I press ⌥⌘B
    Then the browser pane has the keyboard and the note is unchanged
    And with no tab open, the command bar opens instead
    And the key does nothing behind a dialog or Settings

  Scenario: One available sidebar toggle
    Given two panes are open and the sidebar is visible
    Then only the sidebar has a sidebar toggle
    When I hide the sidebar
    Then only the first pane has a sidebar toggle
    And the hidden sidebar cannot receive keyboard focus
    When I show it again
    Then only the sidebar has a sidebar toggle

  Scenario: Keep the workspace after restarting
    Given a note is beside a browser page
    When I restart
    Then both panes return with the same note and browser tab
    And the sidebar lists the same pinned pages, pinned sites and tabs
    And a mode saved by an older version is ignored

  Scenario: The keyboard follows the pane
    Given a note is beside a native browser page
    When I click in the note and press Command W
    Then its pane tab closes and the browser tab remains
    When I click the native browser page and press Command L
    Then its address opens for editing
    When I open Settings or a dialog over the native page
    Then it cannot cover the app's controls

  Scenario: Long lists
    Given 30 pinned pages and 30 open tabs
    Then Pinned, Tabs and Agents scroll as one list
    And Search library, New page, the shortcuts, the usage line and the toolbar stay in place

  Scenario: Empty and narrow workspaces
    Given the last browser tab is closed
    Then its pane offers New tab
    When I use a narrow window or collapse a pane
    Then the browser view stays inside its visible pane
    And a hidden browser pane cannot cover a note
    And the sidebar sheet shows the same Pinned and Tabs

  Scenario: Where there is no native browser
    Given I am in the browser build
    Then the sidebar shows Open browser in place of Tabs
    And on iPad it shows neither
