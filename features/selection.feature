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
    And the block menu is open (features/block-menu.feature)

  Scenario: Shift-clicking another handle selects the range
    When I hover "two", click "Drag to move" and press Escape to close the block menu
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

  Scenario: Clicking text after a selected recording accepts the next key
    Given a recording block is selected above a transcript paragraph
    When I click the paragraph and immediately type " Edited later."
    Then the words are inserted at the clicked cursor position
    And the recording stays intact and is no longer selected

  Scenario: Pressing a handle again and again shows one steady highlight
    When I click the handle of "two" five times, slowly and quickly, and hold the last press
    Then "two" shows only the block tint the whole time: no text highlight appears on press,
      and nothing flickers between clicks
    And with "Link" open on a text selection, that selection stays visible while I type the URL,
      in the system's selection colour and as tall as the line, like a normal selection
    When I click into the title while blocks are selected
    Then the blocks are no longer selected, so only the title's own selection shows
    When I drag a block to the end of the page
    Then only that block is selected afterwards, not the empty line kept below it

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
