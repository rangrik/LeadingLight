Feature: App shell
  The window uses the sidebar-08 layout built from COSS UI: a sidebar on the left with the
  app's name at the top and the page list below it, and the open page in an inset panel
  with rounded corners on the right. On macOS the title bar is an overlay; in a browser
  there is no title bar.

  Names used below:
  - "Toggle Sidebar" button at the left of the panel header
  - breadcrumb: navigation "breadcrumb" in the panel header
  - sidebar page list: navigation "Pages"

  Background:
    Given the app is open in a browser at 1280x800

  # Native only (checked by measuring AppKit's button frames, not by driving the window):
  # the traffic lights are centred on the panel header's middle line, and with the sidebar
  # open, the sidebar's name row starts below them.

  Scenario: Layout
    Then the sidebar is 256 px wide and shows "LeadingLight" at its top
    And the page panel has rounded corners and an 8 px gap to the window's top, right and bottom edges
    And the sidebar's background colour shows in that gap

  Scenario: The panel header shows where you are
    Given I have created a page titled "Trip to Kyoto"
    Then the breadcrumb reads "Pages" then "Trip to Kyoto"
    When I change the title to "Trip to Osaka"
    Then the breadcrumb and the sidebar row read "Trip to Osaka" right away, before any save

  Scenario: Sidebar collapses and expands from the button
    When I click "Toggle Sidebar"
    Then the sidebar slides away and the panel takes the full width, keeping its 8 px gap on every side
    When I click "Toggle Sidebar" again
    Then the sidebar is shown again at 256 px

  Scenario: Sidebar collapses and expands with Meta+Backslash
    When I press Meta+\
    Then the sidebar is hidden
    When I press Meta+\
    Then the sidebar is shown

  Scenario: Meta+B bolds text and never touches the sidebar
    Given the body contains "word"
    When I select "word" and press Meta+B
    Then "word" is bold
    And the sidebar is still open

  Scenario: Sidebar state survives a reload
    When I click "Toggle Sidebar" and reload the browser
    Then the sidebar is still hidden

  Scenario: Dark mode follows the system
    Given the browser prefers a dark color scheme
    Then the page background is dark and the text is light
    And the sidebar, the panel, the editor, menus and toolbars all use dark colours

  Scenario: No focus rings on buttons
    When I click "New page" in the sidebar
    Then the "New page" button has no visible outline or ring

  Scenario: Meta+N creates a page
    When I press Meta+N
    Then a new page named "Untitled" is listed and open
