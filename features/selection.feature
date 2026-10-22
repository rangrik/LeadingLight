Feature: Selecting blocks
  One or more whole blocks can be selected, then deleted, copied, moved or grouped.
  A selected block is shown with a soft tinted background, not the browser's text highlight.

  Names used below:
  - block handle: button "Drag to move" next to the hovered block
  - body: textbox "Page body"

  Background:
    Given the app is open in a browser with one page open
    And the body contains paragraphs "one", "two", "three", "four"

  Scenario: Clicking the handle selects that block
    When I hover "two" and click "Drag to move"
    Then the block "two" is selected and no other block is
    And the block has the selected tint

  Scenario: Shift-clicking another handle selects the range
    When I hover "two" and click "Drag to move"
    And I hover "four" and shift-click "Drag to move"
    Then the blocks "two", "three" and "four" are selected

  Scenario: Escape selects the current block
    When I click into "three" and press Escape
    Then the block "three" is selected
    When I press Escape again
    Then the cursor is back inside "three"

  Scenario: Shift+Arrow extends a block selection
    When I click into "two" and press Escape
    And I press Shift+ArrowDown
    Then the blocks "two" and "three" are selected
    When I press Shift+ArrowUp
    Then only "two" is selected
    When I press Shift+ArrowUp again
    Then the blocks "one" and "two" are selected

  Scenario: Deleting a selection removes all selected blocks
    When I select the blocks "two" and "three"
    And I press Backspace
    Then the body contains "one" and "four" only

  Scenario: Copy and paste of selected blocks
    When I select the blocks "two" and "three" and press Meta+C
    And I click into "four", move to its end, press Enter and press Meta+V
    Then the body contains "one", "two", "three", "four", "two", "three" in that order

  Scenario: Dragging a selection moves all of it
    When I select the blocks "three" and "four"
    And I drag the handle of "three" to above "one"
    Then the paragraphs are in the order "three", "four", "one", "two"

  Scenario: Typing while blocks are selected changes nothing
    When I select the block "two" and type "x"
    Then the body still contains "one", "two", "three", "four" unchanged

  Scenario: Meta+A selects every block
    When I click into "two" and press Meta+A
    Then every block shows the selected tint, in light and in dark mode
    And on a page with headings, a quote, a divider and media, the tint is one unbroken shape
    When I press Backspace
    Then the body is one empty paragraph with the cursor in it
    When the cursor is in a code block and I press Meta+A
    Then only the code is selected
    When I press Meta+A again
    Then every block shows the selected tint

  Scenario: Clicking elsewhere clears the selection
    When I select the block "two"
    And I click into "four"
    Then no block is selected and the cursor is in "four"
