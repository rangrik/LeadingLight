Feature: Block menu
  Like Notion's, each block has a menu of actions. It is a COSS Menu, opened by clicking or
  right-clicking the block handle, by right-clicking selected blocks, or with Meta+/. It acts on
  every selected block, and Turn into changes each one on its own, in one undo step.

  Names used below:
  - block handle: button "Drag to move" next to the hovered block
  - block menu: menu "Block" with "Turn into" (a submenu), "Duplicate" (⌘D) and "Delete" (⌫)
  - turn-into kinds: Text, Small text, Heading 1–4, Quote, Toggle, Bullet list, Numbered list,
    Alphabetical list, Roman list, To-do list, Code block

  Background:
    Given the app is open in a browser with one page open
    And the body contains paragraphs "one", "two", "three", "four"

  Scenario: Clicking the handle opens the menu beside it
    When I hover "two" and click "Drag to move"
    Then "two" is selected and the block menu opens to the left of the handle, its top level with it
    And the handle stays where it is, pressed, while I move the mouse over other blocks
    When I press Escape
    Then the menu closes and "two" is still selected
    When I press Escape again
    Then the cursor is back inside "two"

  Scenario: Turn into another kind
    When I open the block menu on "two" and hover "Turn into"
    Then the submenu lists the turn-into kinds, with a check beside "Text"
    When I click "Heading 1"
    Then "two" is a heading 1, the menu is closed and the cursor is at the end of "two"
    When I press Meta+Z
    Then "two" is a paragraph again, selected, with no formatting toolbar

  Scenario: Turn several blocks into a list, and an item back into text
    When I select "two" and "three" and open the block menu on "three"
    And I pick "Turn into" then "Bullet list"
    Then "two" and "three" are the items of one bullet list
    When I open the block menu on the item "two" and pick "Turn into" then "Text"
    Then "two" is a paragraph followed by a bullet list holding "three"
    When I select "three" and "four" and pick "Turn into" then "Alphabetical list"
    Then they are one list marked "a." and "b."
    When I select "one" and "two" and pick "Turn into" then "Quote"
    Then each is its own quote

  Scenario: Toggles keep their text both ways
    When I open the block menu on "two" and pick "Turn into" then "Toggle"
    Then "two" is the title of a closed toggle and the cursor is at the end of "two"
    When I open it, type "inside" on its empty line, open the block menu on the toggle and pick
      "Turn into" then "Heading 1"
    Then the body reads "one", heading "two", then "inside", "three", "four" as paragraphs

  Scenario: Duplicate
    When I open the block menu on "two" and click "Duplicate"
    Then the body reads "one", "two", "two", "three", "four" and only the second "two" is selected
    When I press Meta+D
    Then the body reads "one", "two", "two", "two", "three", "four"
    When I click into "four" and press Meta+D
    Then the body ends "four", "four" and the cursor is still in the first "four"

  Scenario: Delete
    When I open the block menu on "two" and click "Delete"
    Then the body reads "one", "three", "four" and the cursor is at the start of "three"

  Scenario: Right-click on selected blocks
    When I select "two" and "three" and right-click on "three"
    Then the block menu opens at the pointer, not the browser's menu, and both blocks stay selected
    When I click "Delete"
    Then the body reads "one", "four"
    When I right-click on the text of "one", which is not selected
    Then the block menu does not open

  Scenario: Meta+/ opens the menu from the keyboard
    When I click into "three" and press Meta+/
    Then "three" is selected and the block menu opens beside its handle
    When I press ArrowDown until "Duplicate" is highlighted and press Enter
    Then "three" is duplicated

  Scenario: Blocks that can't change kind have no "Turn into"
    Given the body also holds a divider, an image, a table and columns
    When I open the block menu on each of them
    Then it shows "Duplicate" and "Delete" only
    And when a divider is selected together with "one", the menu shows no "Turn into"

  Scenario: Selected blocks act together
    When I select "two" and "three" and click the handle of "three"
    Then both stay selected and the menu acts on both
    When I press Escape, hover "four" and shift-click its handle
    Then "two", "three" and "four" are selected and no menu opens
