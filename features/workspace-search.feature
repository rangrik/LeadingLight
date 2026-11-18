Feature: One search for the workspace
  Search and Library share one keyboard-first window, available from either sidebar mode.

  Scenario: Recent work is visible without remembering its type
    Given I have older pages, a new Book and an edited Meeting
    When I press Command+K from Notes or Browser
    Then Search library opens with the most recently changed pages first
    And I can browse every saved page, including daily notes and unpinned pages
    And reloading keeps the new Book and edited Meeting in the results

  Scenario: Find a page by its title, text or type
    When I search for words in a page title or body
    Then matching pages appear with their type
    And an older search finishing late cannot replace the current results
    When I search for "meeting"
    Then I can open Meetings, a matching meeting, or create a new Meeting
    And a failed body search explains the failure while title search still works

  Scenario: A large library stays quick to browse
    Given I have 2000 saved pages
    When I browse all pages or search for a word in every page
    Then at most 100 page results are drawn at once
    And I can go to the next or previous 100 results
    And each list opens at its first result with keyboard focus in search
    And changing the query searches the whole library from the first result

  Scenario: Create any user type without hunting through Library
    When I choose New page's type picker or the Create category in Search library
    Then I can choose any user-created or built-in user type
    And creating a Book uses its default template in a new note tab
    And creating a daily note opens today's note without duplicating it
    And today's note is ready to type in when it opens
    And a failed creation keeps the picker open with an error and allows retry
    And changing the query clears the old creation error
    And a successful pin retry clears its error

  Scenario: Jump between notes and websites while keeping a split
    Given a note and a browser tab are open side by side
    When I open a note result in Search library
    Then Notes is selected in the sidebar and the browser pane stays open
    When I open a browser-tab result
    Then Browser is selected in the sidebar and the note pane stays open
    And Shift+Enter or Shift-click on a page result opens it beside the current pane
    And an inactive note tab in this pane moves into the new pane instead of merely becoming active

  Scenario: New follows the focused pane
    Given the sidebar mode differs from the pane I last clicked
    When I press Command+N in a note pane
    Then a new page opens in a new note tab and the previous page is kept
    When I press Command+N in the browser pane
    Then the new browser-tab address picker opens without creating a note
    And the sidebar stays in its chosen mode
    And Command+T continues to open a tab
    And holding the shortcut or pressing it behind a dialog does not create extra pages

  Scenario: Search is reachable without the sidebar
    Given the sidebar is hidden
    When I press Command+K or invoke Search library from the native menu
    Then the same search window opens and takes keyboard focus
    And Command+K replaces an open browser address picker with Search library
    And native browser content is hidden while the search window is open
    When I press Escape
    Then the search closes and focus returns to the previous pane
    And the writing cursor stays at the same position, including after a mouse click
    And search shortcuts remain configurable in Settings

  Scenario: Reopening search immediately keeps typing out of the selected note
    Given a note named "Field guide" contains "Original text"
    When I open "Field guide" from search and immediately press Command+K again
    And I type "cedar" without clicking the search field
    Then the search field contains "cedar" and keeps keyboard focus
    And the note still contains exactly "Original text" after I close search and reload

  Scenario: Narrow a search from the first screen
    Given a page and an open website both match "Kyoto"
    When I type "Kyoto" in Search library and select Pages
    Then only matching pages appear and the search field still contains "Kyoto"
    When I select Tabs and then All
    Then I can find the website in Tabs and both results in All without retyping
    And all categories fit in a window 320 pixels wide
    And an empty category shows no Return action

  Scenario: Create from the first screen
    When I click New page in Search library
    Then a blank page opens with its title ready to edit
    When my search for "Neighborhood walk" finishes without a match
    Then I can press Return to create a page already titled "Neighborhood walk"
    When I switch to Create with "Kyoto" still in the search field
    Then I can create a page titled "Kyoto" even if other pages matched my search
    When I type "new meeting Friday review" in search and press Return
    Then a Meeting titled "Friday review" opens with its body ready to edit
    And a saved page containing those search words cannot take precedence over the creation command
    When I search for a saved page named "New"
    Then that page is selected first and I can pin it

  Scenario: Recognize and choose a type
    Given I have a custom type named "Field trip"
    When I open the Create category
    Then I can select a type by its name and icon, grouped by purpose
    And Field trip appears under My types
    And create actions are never marked as the currently open page
    When I type "new field trip Spring walk" and press Return
    Then a Field trip titled "Spring walk" opens using its type's template
