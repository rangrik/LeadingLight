Feature: App shell
  The window uses the sidebar-08 layout built from COSS UI: a sidebar on the left with the
  app's name at the top and the page list below it, and on the right a stage where each open
  page is a card with rounded corners (one card fills it; see panes.feature for more). On macOS the title bar is an overlay; in a browser
  there is no title bar.

  Names used below:
  - card header: the bar at the top of a page's card
  - "Toggle Sidebar": in the app, in the title bar just right of the traffic lights, as in the
    Claude app; in a browser (no traffic lights), at the left of the first card's header
  - sidebar edge: the 8 px gap between the sidebar and the first card
  - the app's chrome in a browser: open the app with "?mac" to lay it out as the Mac app does
  - breadcrumb: navigation "breadcrumb" in a card header
  - sidebar page list: navigation "Pages"

  Background:
    Given the app is open in a browser at 1280x800

  # Native only (checked by measuring AppKit's button frames, not by driving the window):
  # the traffic lights' centre is 26 pt below the window's top, on the card header's middle
  # line, as in Apple Notes; with the sidebar open, the logo tile starts 15 pt below them.

  Scenario: Layout
    Then the sidebar is 256 px wide and shows "LeadingLight" at its top
    And the page's card has rounded corners and an 8 px gap to the window's top, right and bottom edges
    And the sidebar's background colour shows in that gap
    And in a browser the card header is 64 px tall, level with the sidebar's logo row
    And the page's title and body start at the card's left, after the 64 px gutter, not centred:
      a wide window leaves the room on the right
    # In the app it is 36 px, level with the traffic lights (see the native note above).

  Scenario: The card header shows where you are
    Given I have created a page titled "Trip to Kyoto"
    Then the breadcrumb reads "Pages" then "Trip to Kyoto"
    When I change the title to "Trip to Osaka"
    Then the breadcrumb and the sidebar row read "Trip to Osaka" right away, before any save

  Scenario: Sidebar collapses and expands from the button
    When I click "Toggle Sidebar"
    Then the sidebar slides away and the card takes the full width, keeping its 8 px gap on every side
    When I click "Toggle Sidebar" again
    Then the sidebar is shown again at 256 px

  Scenario: The sidebar button sits beside the traffic lights in the app
    Given the app's chrome ("?mac")
    Then "Toggle Sidebar" is 32 px square, its centre 26 px below the window's top (level with the
      traffic lights) and its left edge 86 px from the window's left, 8 px after the lights
    And it isn't in any card's header
    When I click it
    Then the sidebar slides away and the button stays exactly where it was
    And the first card's breadcrumb starts 12 px after the button
    When I click it again
    Then the sidebar is back and the button still hasn't moved

  Scenario: Resizing the sidebar
    When I hover the sidebar edge
    Then a small grip shows in it and the pointer is a resize arrow
    When I drag the sidebar edge 100 px to the right
    Then the sidebar is 356 px wide and the cards move with it, 8 px from it
    When I drag it far to the left, then far to the right
    Then it stops at 200 px, then at 400 px
    And after a reload it is still 400 px wide, and Settings' sidebar is as wide
    And collapsing and expanding it brings it back at 400 px

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
