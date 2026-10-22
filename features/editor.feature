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

  Scenario: Clicking blank page space opens a line, when no block is active
    Given the body holds a heading "Plan" and a paragraph "Notes"
    And the cursor is not in the body (I clicked the sidebar)
    When I click the blank space below "Notes"
    Then a new empty paragraph follows "Notes" with the cursor in it
    When I click into the sidebar and then the blank space below again
    Then no second paragraph is added: the cursor goes into the empty one
    When I click the side margin beside "Plan"
    Then the cursor is in "Plan" and no block is added
    When the cursor is in "Notes" and I click the blank space below
    Then the click only takes the cursor away and adds nothing
    When I click blank space beside or above the title
    Then the cursor is at the end of the title and nothing is added
    When I click the gap just above the body, under the properties
    Then the cursor is at the start of "Plan" and nothing is added
    When I click beside a property row, or level with the backlinks or "Created this day"
    Then nothing happens: the cursor doesn't move and nothing is added
    When I click the side margin beside a to-do, a toggle title, a table row or a group's text
    Then the cursor goes into the line at that height, not the next block
    And beside a table row or columns, a left-margin click goes to the first cell's start and a
      right-margin click to the last cell's end
    And this holds for a click anywhere in the block's height, its top and bottom padding included
    When the link field is open and I click blank space
    Then the field closes, the text stays selected and nothing is added
    And on a read-only page a blank click below the title changes nothing and holds no focus
    # Clicks at the title's height still go to the title, which stays editable (R6-2).

  Scenario: Clicking anywhere on an empty page starts its first line
    Given a new page with an empty body and the cursor in the title
    When I click the blank space far below the body
    Then the cursor is in the body's first line and the body still has one block

  Scenario: A new line starts without the previous line's formatting
    When I press Meta+B, type "bold" and press Enter, then type "plain"
    Then "bold" is bold and "plain" is not
    When I press Meta+I, type "lean" and press Enter in a bullet item, then type "next"
    Then "next" is not italic
    And the same holds in to-do items and after Shift+Enter

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

  Scenario: Dragging with a real mouse, in the browser and in the app
    # Synthetic drag events skip the browser's own drag start, so this needs a real pointer
    # (Playwright's mouse). In the app, Tauri must leave drags to the page (dragDropEnabled false).
    Given the body has paragraphs "one", "two" and "three"
    When I press the mouse on the handle of "three", move it above "one" and release
    Then the body reads "three", "one", "two"
    And dropping an image file from Finder onto the page in the app inserts it

  Scenario: Each list item is a block with its own handle
    Given a to-do list "a", "b", "c" and a bullet list "x" with a nested item "y"
    When I hover "b"
    Then the handle sits beside "b", centred on its line, 8 px left of the list
    When I hover "y"
    Then the handle sits beside "y", 8 px left of the nested list
    When I click the handle beside "b"
    Then only "b" is selected, tinted from its checkbox to the end of the line
    When I shift-click the handle beside "c"
    Then "b" and "c" are selected
    When I press Escape in "a"
    Then only "a" is selected
    When I press Backspace
    Then the list reads "b", "c"
    When I drag "c" above "b" with the handle
    Then the list reads "c", "b"
    When I drag "x" by its handle into the gap between two top-level blocks
    Then "x" becomes its own one-item bullet list there, keeping its nested "y"
    And a bullet item dropped on a numbered list (or a to-do on a bullet list) lands beside that
      list as its own list, keeping its kind
    And while dragging, no drop line shows where the drop would change nothing
    When I hover a list item inside a group, a toggle or a quote
    Then that item gets its own handle too, in the page's gutter (clear of the quote bar and the
      group border); a list inside a quote keeps its 24 px marker indent
    # Inside columns the columns block keeps the handle: a handle for column 2 would sit over
    # column 1 (see docs/DEFERRED.md).
    When "b" is selected and I press Shift+ArrowDown past the list's last item
    Then the whole top-level block holding the list is selected; the next press adds the block after it
    And dropping a list's first or last item at that list's own outer edge changes nothing
    And deleting a quote's only list item removes the quote and puts the cursor at the start of
      the next block
    When I press Escape twice on an item that has nested items
    Then the cursor is at the end of that item's own text
    When I copy selected items as plain text
    Then the text has one line per item, with no blank lines
    When I click "Add block" beside "c"
    Then a new empty to-do follows "c" with the cursor in it

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
