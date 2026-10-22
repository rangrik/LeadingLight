Feature: Everyday situations
  Things people run into in normal use that no single feature covers: losing work,
  old notes, keys that behave unexpectedly, links, and big pages.

  Background:
    Given the app is open in a browser with one page open

  # Not losing work

  Scenario: Leaving or closing right after typing keeps the last edit
    When I type "last words" into the body
    And within 100 ms the page is hidden (tab switched, window closed or reloaded)
    Then after a reload the body contains "last words"

  # Native app only: the browser's own Meta+Q quits the browser.
  Scenario: Quitting with Meta+Q right after typing keeps the last edit
    When I type "last words" into the body and press Meta+Q within 100 ms
    Then the app saves, then quits
    And after reopening the app the body contains "last words"

  Scenario: Meta+S saves straight away and does nothing else
    When I type "saved now" and press Meta+S
    Then the browser's own save dialog does not open
    And the edit is stored without waiting for the autosave delay

  Scenario: A failed save is reported, not swallowed
    Given saving is made to fail
    When I type "will fail"
    Then a toast says the changes couldn't be saved
    And the text stays on the page

  Scenario: Large images don't break saving in the browser build
    When I add a 6 MB image to a page and then edit another page
    Then both pages save and survive a reload

  Scenario: A page with blocks this version doesn't know is kept safe
    Given a stored page whose body holds a block type this version doesn't have
    When I open it
    Then an alert says this page has blocks this version can't show
    And the blocks this version knows are shown
    And the body is read-only, with no block handle, drop line, media controls, emoji picker or language picker
    And the title can still be renamed, since that can't lose the body
    And nothing done on the page changes what is stored for its body

  Scenario: Pages written by the first editor still open with their content
    Given a stored page whose body is in the old BlockNote format with a paragraph,
      a heading, a bullet item, a checked to-do and bold text
    When I open it
    Then the body shows the same paragraph, heading, bullet item, checked to-do and bold text
    And a BlockNote table keeps its cells' text, and its video, audio and file blocks keep their files

  # Keys

  Scenario: Tab never throws the cursor out of the editor
    When I press Tab in a plain paragraph
    Then the body still has focus and the text is unchanged
    When I press Tab inside a code block
    Then the code block gets an indent

  Scenario: Backspace at the start of a heading turns it back into text
    Given the body contains a heading "Plans" after a paragraph "Intro"
    When I put the cursor at the start of "Plans" and press Backspace
    Then "Plans" is a paragraph and "Intro" is untouched
    When I press Backspace again
    Then "Plans" joins the end of "Intro"

  Scenario: Backspace at the start of a quote lifts it out of the quote
    Given the body contains a quote "Said"
    When I put the cursor at the start of "Said" and press Backspace
    Then "Said" is a plain paragraph

  # Pasting and other input

  Scenario: Cells copied from a spreadsheet paste as text, not as a picture
    When I paste a clipboard holding HTML with text, plain text and a PNG, as Numbers or Excel give
    Then the text is pasted and no image is added
    When I paste a clipboard holding only an image, or HTML with only an <img>
    Then an image block is added

  Scenario: Text from the emoji picker or dictation doesn't replace selected blocks
    Given two blocks are selected
    When text arrives as a beforeinput insertText or insertReplacementText event
    Then nothing changes and the blocks stay selected

  # Links

  Scenario: Meta+click opens a link
    Given the body contains a link "docs" to "https://example.com"
    When I click "docs"
    Then the cursor moves into the text and nothing opens
    When I Meta+click "docs"
    Then "https://example.com" opens outside the app

  # Big pages

  Scenario: Typing stays smooth in a very long page
    Given the body contains 2000 paragraphs
    When I type 30 characters at the end
    Then no keystroke takes longer than 16 ms to handle
