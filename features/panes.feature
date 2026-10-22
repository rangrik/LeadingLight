Feature: Pages side by side
  Drag a page from the sidebar onto the open page to see both at once. The edge you let go
  near decides where it goes: left, right, top or bottom half of the page under the pointer.
  Every open page is its own card on the stage, 8 px from its neighbours and from the window's
  edges. Drag a page's breadcrumb in its card header to move it, and the gap between two cards to
  resize them. A page is open in one place at most. Taken from Shipyard's split panes, pages only.

  Names used below:
  - sidebar row: button in navigation "Pages", named by the page's title
  - pane: the card of one open page, a region named by its page's title, with rounded corners
  - card header: the bar at the top of a card with the page's breadcrumb (its parent, icon and
    title); the first card's also has "Toggle Sidebar"; while two or more pages are open each
    also has a "Close page" button
  - gap: the 8 px space between two cards, where the stage's colour shows
  - page area: the stage holding the cards

  Background:
    Given the app is open in a browser at 1280x800
    And I have created pages titled "A", "B" and "C", and "A" is open

  Scenario: Dragging a page to the right edge opens it beside
    When I press on the sidebar row "B" and move the pointer over the right quarter of "A"
    Then a dashed card fills the right half of the page area, labelled "Open on the right · B",
      where B's card will be: rounded, 8 px from A's side and from the stage's edges
    When I let go
    Then "A" is a card on the left half of the page area and "B" a card on the right half
    And each card has its own header with its breadcrumb, and an 8 px gap runs between them
    And only A's header has "Toggle Sidebar"
    And in a card too narrow for its breadcrumb, the header stays one line: the title ends in "…"
    And below 768 px, where cards lose their corners and shadow, the gap still shows the stage's colour
    And "B" is focused: its sidebar row is marked current and its header's title is in the
      regular text colour, A's muted

  Scenario Outline: Each edge puts the page on that side
    When I drag the sidebar row "B" near the <edge> edge of "A" and let go
    Then "B" takes the <half> half of the page area and "A" the other half

    Examples:
      | edge   | half   |
      | left   | left   |
      | top    | top    |
      | bottom | bottom |

  Scenario: Splitting a pane that is already split
    Given "A" is on the left and "B" on the right
    When I drag the sidebar row "C" near the bottom edge of "B" and let go
    Then "A" fills the left half, "B" the top right quarter and "C" the bottom right quarter

  Scenario: A click on a sidebar row still opens the page
    When I click the sidebar row "B" without moving the pointer
    Then "B" replaces "A" and nothing splits

  Scenario: Escape cancels a drag
    When I drag the sidebar row "B" over "A" and press Escape before letting go
    Then the dashed card goes away, and letting go changes nothing

  Scenario: Letting go away from the pages changes nothing
    When I drag the sidebar row "B" over "A" and let go over the sidebar
    Then only "A" is open

  Scenario: A page that is open already moves instead of opening twice
    Given "A" is on the left and "B" on the right
    And I have typed "draft" at the end of "A"'s body without waiting
    When I drag the sidebar row "A" near the bottom edge of "B" and let go
    Then "B" fills the top half and "A" the bottom half, and "A" is open only there
    And "A"'s body still ends with "draft", scrolled where it was

  Scenario: Dragging a page by its breadcrumb in the card header moves it
    Given "A" is on the left and "B" on the right
    When I drag the breadcrumb in A's card header near the right edge of "B" and let go
    Then "B" fills the left half and "A" the right half

  Scenario: Dropping a page onto its own pane changes nothing
    Given "A" is on the left and "B" on the right
    When I drag the breadcrumb in A's card header over "A" itself and let go
    Then no dashed card shows, and the layout stays as it was

  Scenario: Clicking a sidebar row while pages are side by side
    Given "A" is on the left, "B" on the right, and "B" is focused
    When I click the sidebar row "C"
    Then "C" replaces "B" on the right and is focused
    When I click the sidebar row "A"
    Then "A" is focused where it is, and nothing else changes

  Scenario: Clicking into a page focuses it
    Given "A" is on the left, "B" on the right, and "B" is focused
    When I click in the body of "A"
    Then the sidebar row "A" is marked current
    And the title in A's card header is in the regular text colour, B's is muted

  Scenario: Resizing two pages
    Given "A" is on the left and "B" on the right
    When I hover the gap between them
    Then a small grip shows in the middle of the gap and the pointer is a resize arrow
    When I drag the gap between them to 30% across the page area
    Then "A" is 30% of the page area wide and "B" 70%, less half the gap each
    When I drag the gap to 2% across
    Then "A" stops at 10% of the page area wide

  Scenario: Closing a page
    Given "A" is on the left and "B" on the right, and I typed "bye" into "B" without waiting
    When I click "Close page" in B's card header
    Then "A" is one card filling the page area, and its header has no "Close page"
    And after a reload "B" still contains "bye"

  Scenario: Deleting a page that is open beside another
    Given "A" is on the left and "B" on the right
    When I delete "B" from the sidebar
    Then "A" fills the page area

  Scenario: Meta+N opens the new page in the focused pane
    Given "A" is on the left, "B" on the right, and "A" is focused
    When I press Meta+N
    Then a new "Untitled" page replaces "A" on the left, with its title field focused

  Scenario: Both pages save their own edits
    Given "A" is on the left and "B" on the right
    When I type "left" into "A"'s body and "right" into "B"'s body and reload at once
    Then "A" contains "left" and not "right", and "B" contains "right" and not "left"

  Scenario: A narrow page keeps room for the block handle
    Given "A", "B" and "C" are side by side in three columns
    When I hover the first line of "C"'s body
    Then its block handle shows whole, centred on the line, inside C's card
