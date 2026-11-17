Feature: A shared sidebar for notes and browsing
  The browser-only prototype uses sample notes and simulated websites.
  Sidebar mode and the open panes are separate choices.

  Scenario: Open the prototype with useful sample content
    Given I open /sidebar-prototype.html
    Then Trip to Kyoto is open in the real block editor
    And Notes shows pinned pages, a Library button and a New page button
    And there is no Recent section or Notes/Browser dropdown
    And exactly one sidebar toggle is available, even with two panes
    And the prototype does not read or write my app's notes or browser tabs

  Scenario: One shared sidebar toggle
    Given two panes are open and the sidebar is visible
    Then only the sidebar header offers Hide sidebar
    When I hide the sidebar
    Then only the first pane header offers Toggle Sidebar
    And the hidden sidebar is not keyboard focusable
    When I show it again
    Then only the sidebar header offers Hide sidebar

  Scenario: Switch the shared sidebar without changing the document
    Given Trip to Kyoto is open
    When I press Option Command B
    Then the same sidebar shows pinned websites and browser tabs
    And Trip to Kyoto stays open
    When I swipe horizontally back over the sidebar
    Then the sidebar shows Notes again
    And vertical scrolling, a small diagonal movement and a pinch do not switch modes
    And one continuous swipe changes the mode only once

  Scenario: Write beside a browser tab
    Given Trip to Kyoto is open
    When I change the sidebar to Browser
    And I Shift-click Kyoto city guide
    Then Trip to Kyoto is on the left and Kyoto city guide is on the right
    When I edit the note and switch sidebar modes
    Then both panes and my text remain
    When I select another browser tab without Shift
    Then only the browser pane changes
    When I select Reading list in Notes
    Then only the notes pane changes

  Scenario: Discover split view without a modifier key
    Given Trip to Kyoto is open
    When I choose Open beside from a browser row's menu
    Then a browser pane opens beside the note
    And I can resize the split with the divider or its arrow keys
    When I close either pane
    Then the other pane fills the available space

  Scenario: Create, find and pin notes
    When I create a new page and write a title and a paragraph
    Then the new page is editable and visible in Library
    When I pin it from its page toolbar
    Then it appears in Pinned
    And searching the sidebar finds it
    When I reload the prototype
    Then my sample notes and pane arrangement remain
    And text typed just before the reload remains, even before the save delay ends

  Scenario: Browse simulated pages
    When I open a new browser tab and choose a sample website
    Then its local sample content opens
    And links between sample pages support back and forward
    When I enter an unknown address
    Then I see that this prototype only simulates the sample websites
    And no external website or account is contacted

  Scenario: Recover from an empty or narrow workspace
    When I close the last browser tab
    Then I can open a new tab from the empty browser pane
    When I use a narrow window with two panes
    Then each pane remains reachable and the sidebar can collapse
    When I reset the demo from Settings and account
    Then the original sample data returns
