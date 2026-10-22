Feature: Block editor
  The body of a page is a block editor. Each top-level element is a block.
  Block kinds in M1: paragraph, heading 1–3, bullet list, numbered list, to-do list,
  quote, code block, divider. Inline: bold, italic, underline, strikethrough, code,
  link, highlight.

  Names used below:
  - body: textbox "Page body" (the contenteditable element)
  - slash menu: listbox "Insert block"; items are options named like "Heading 1"
  - selection toolbar: toolbar "Text formatting" with buttons "Bold", "Italic",
    "Underline", "Strikethrough", "Code", "Highlight", "Link"
  - block handle: buttons "Add block" and "Drag to move" to the left of the hovered block

  Background:
    Given the app is open in a browser with one page open and an empty body

  Scenario: Typing creates paragraphs
    When I type "Hello" then press Enter then type "World"
    Then the body has two paragraphs: "Hello" and "World"

  Scenario: Placeholder shows only on the current empty block
    When I type "One" and press Enter
    Then the new empty block shows "Type '/' for commands"
    When I press ArrowUp
    Then no placeholder text is visible anywhere
    When I select a block below an empty line, with the handle or with Escape
    Then the empty line shows no placeholder

  Scenario Outline: Markdown shortcuts at the start of a block
    When I type "<shortcut>" followed by a space and then "text"
    Then the block becomes a <kind> containing "text"

    Examples:
      | shortcut | kind          |
      | #        | heading 1     |
      | ##       | heading 2     |
      | ###      | heading 3     |
      | -        | bullet list   |
      | 1.       | numbered list |
      | []       | to-do item    |
      | >        | quote         |

  Scenario: Three backticks start a code block
    When I type "```" and press Enter and type "let x = 1"
    Then the block is a code block containing "let x = 1"
    And pressing Enter inside it adds a new line, not a new paragraph

  Scenario: Three dashes insert a divider
    When I type "---"
    Then a divider block is inserted and the cursor is in an empty paragraph below it

  Scenario: Slash menu opens, filters, and applies
    When I type "/"
    Then the slash menu is shown with "Text" as the first highlighted item
    When I type "head"
    Then the menu shows only the heading items, "Heading 1" highlighted
    When I press ArrowDown and then Enter
    Then the "/head" text is removed and the block is a heading 2
    And the slash menu is closed

  Scenario: Slash menu closes on Escape and leaves text alone
    When I type "/qu"
    And I press Escape
    Then the slash menu is closed
    And the body still contains "/qu"
    And no block is selected
    When I press Backspace three times
    Then only the "/qu" text is gone and every other block is still there

  Scenario: Slash menu keeps filtering across a space
    When I type "/heading 2"
    Then the slash menu shows only "Heading 2"
    When I type " more words that match nothing"
    Then the slash menu is closed

  Scenario: Slash menu shows nothing for an unknown query
    When I type "/zzzz"
    Then the slash menu shows "No results"

  Scenario: Slash menu shows all block kinds
    When I type "/"
    Then the slash menu lists every kind in the sections and order given in blocks.feature

  Scenario: A name beats a keyword in the slash menu
    When I type "/columns" and press Enter
    Then a Columns block is inserted, not a table
    When I type "/todo" in a new block
    Then the slash menu shows "To-do list"

  Scenario: Selection toolbar appears on a text selection
    Given the body contains "Select some words"
    When I select the word "some"
    Then the selection toolbar is shown near the selection
    When I click "Bold"
    Then "some" is bold and the "Bold" button is shown as active
    When I click elsewhere so nothing is selected
    Then the selection toolbar is hidden

  Scenario: Keyboard shortcuts format text and never touch the sidebar
    Given the body contains "shortcuts"
    When I select "shortcuts" and press Meta+B, Meta+I, Meta+U
    Then "shortcuts" is bold, italic and underlined
    And the sidebar is still open

  Scenario: Adding and removing a link
    Given the body contains "docs"
    When I select "docs" and click "Link" in the selection toolbar
    And I type "https://example.com" into the "Link URL" field and press Enter
    Then "docs" is a link to "https://example.com"
    When I select "docs" again, click "Link", type "hello world" and press Enter
    Then the "Link URL" field is marked invalid and "docs" still links to "https://example.com"
    And while the field has focus, "docs" still shows as selected
    When I press Escape in the field
    Then the field closes, "docs" is still selected and typing goes into the page
    When I select "docs" again and click "Link" and then "Remove link"
    Then "docs" is no longer a link

  Scenario: Undo and redo
    When I type "first" then press Meta+Z
    Then the body is empty
    When I press Meta+Shift+Z
    Then the body contains "first"

  Scenario: To-do checkbox toggles and persists
    When I type "[]" then a space then "Buy milk"
    And I click the checkbox of that to-do item
    Then the item is checked
    When I wait 1 second and reload the browser
    Then the item is still checked

  Scenario: There is always an empty block to click into at the end
    When I type "# Title" and press nothing else
    Then clicking in the space below the heading places the cursor in an empty paragraph

  Scenario: Block handle appears on hover
    Given the body contains two paragraphs "one" and "two"
    When I hover the paragraph "two"
    Then the "Add block" and "Drag to move" buttons are shown next to "two"
    When I move the mouse away from the editor
    Then the handle is hidden

  Scenario: Add block inserts a new block below and opens the slash menu
    Given the body contains two paragraphs "one" and "two"
    When I hover "one" and click "Add block"
    Then a new block is inserted between "one" and "two" with "/" typed in it
    And the slash menu is open

  Scenario: Dragging the handle moves the block
    Given the body contains paragraphs "one", "two", "three"
    When I drag the handle of "three" to above "one"
    Then the paragraphs are in the order "three", "one", "two"

  Scenario: A drag drops where the line shows, decided by height alone
    Given the body contains paragraphs "one", "two", "three"
    When I drag the handle of "three" over the top half of "one", anywhere along its width
    Then a horizontal line shows above "one"
    And dropping puts "three" above "one"
    When I drag the handle of "one" over the bottom half of "two", at its far right
    Then the line shows below "two" and dropping puts "one" below "two"
    And no text caret-style drop marker appears while dragging a block

  Scenario: Dropping a file shows the same line
    When I drag an image file from outside over the bottom half of "two"
    Then the line shows below "two"
    And dropping inserts the image there

  Scenario: Pasting plain text with several lines creates several blocks
    When I paste "line a\nline b"
    Then the body has two paragraphs "line a" and "line b"

  Scenario: Typing is fast in a long document
    Given the body contains 300 paragraphs
    When I type 50 characters at the end
    Then each keystroke renders within 50 ms (no visible lag, no dropped characters)

  Scenario: Body content survives a reload exactly
    Given the body contains a heading "H", a bullet item "b", a to-do "t", a quote "q", a code block "c" and a divider
    When I wait 1 second and reload the browser
    Then the body contains the same blocks in the same order
