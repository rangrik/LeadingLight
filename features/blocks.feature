Feature: Block kinds
  The editor supports the Capacities block set, minus math and object blocks.
  Every kind can be inserted from the slash menu (listbox "Insert block"); the
  ones with a markdown shortcut can also be typed. Each kind survives a reload.

  Names used below:
  - body: textbox "Page body"
  - block handle: buttons "Add block" and "Drag to move"
  - code block controls (shown on hover or while the cursor is inside): a "Language" picker,
    buttons "Copy code" and "Download code"
  - table controls: toolbar "Table" with buttons "Add row above", "Add row below",
    "Add column left", "Add column right", "Delete row", "Delete column", "Delete table"
  - image controls: toolbar "Image" with toggles "Small", "Medium", "Full width" and buttons "Replace", "Remove"
  - media insert: button "Choose file" inside the placeholder block for Image, Video, Audio, File
  - embed: textbox "Embed URL" and button "Embed" inside the placeholder block
  - emoji prefix: button "Change emoji" in front of the block; it opens a popover with
    searchbox "Search emoji", one button per emoji (the full set, in groups) and a "Remove emoji" button
  All controls are COSS UI components (Toolbar, Toggle, Select, Popover, Input, Button, Tooltip).

  Background:
    Given the app is open in a browser with one page open and an empty body

  Scenario: The slash menu lists every block kind in sections
    When I type "/"
    Then the slash menu shows these sections and items, in order:
      | Basic  | Text, Small text, Heading 1, Heading 2, Heading 3, Heading 4, Quote, Toggle, Emoji |
      | Lists  | Bullet list, Numbered list, Alphabetical list, Roman list, To-do list             |
      | Blocks | Code block, Table, Columns, Group, Divider                                          |
      | Media  | Image, Video, Audio, File, Embed                                                    |

  Scenario Outline: Markdown shortcuts for the new text kinds
    When I type "<shortcut>" followed by a space and then "text"
    Then the block becomes a <kind> containing "text"

    Examples:
      | shortcut | kind              |
      | ####     | heading 4         |
      | a.       | alphabetical list |
      | i.       | roman list        |

  Scenario: A lettered or roman list right under another list starts its own list
    Given the body contains a numbered list "one", "two" followed by an empty paragraph
    When I type "a. " then "alpha" in that paragraph
    Then there are two lists: the numbered one and a lettered one starting at "a."

  Scenario: Alphabetical and roman lists use lowercase markers
    When I type "a. " then "one", press Enter and type "two"
    Then the markers read "a." and "b."
    When I start a new block and type "i. " then "one", press Enter and type "two"
    Then the markers read "i." and "ii."

  Scenario: Small text is a paragraph with a smaller size
    When I type "/small" and press Enter and type "fine print"
    Then the block is a small-text paragraph containing "fine print"
    And its font size is smaller than a normal paragraph's

  Scenario: Toggle opens and closes and keeps its content
    When I type "/toggle" and press Enter
    Then a new toggle is inserted, already open, with the cursor in its title
    When I type "Summary" and press Enter and type "Hidden detail"
    Then the toggle shows "Summary" with "Hidden detail" as its only content block
    When I click the toggle's chevron
    Then "Hidden detail" is hidden and the chevron points right
    When I wait 1 second and reload the browser
    Then the toggle is still closed and opening it shows "Hidden detail"

  Scenario: Emoji prefix with a picker
    When I type "/emoji" and press Enter and type "Idea"
    Then the block shows an emoji in front of "Idea"
    When I click "Change emoji" and pick "🚀"
    Then the block shows "🚀" in front of "Idea"
    And after a reload the emoji is still "🚀"

  Scenario: Code block has a language picker, highlighting, copy and download
    When I type "```" and press Enter and type "const x = 1"
    Then the code block shows a "Language" picker reading "Plain text"
    When I pick "JavaScript" in the "Language" picker
    Then "const" is rendered as a keyword (a token span exists for it)
    When I click "Copy code"
    Then the clipboard contains "const x = 1"
    And "Download code" offers a file named like "snippet.js"

  Scenario: Table with controls
    When I type "/table" and press Enter
    Then a table with a header row and 3 columns by 3 rows is inserted
    And the cursor is in the first header cell
    When I type "Name" and press Tab and type "Role"
    Then the first two header cells read "Name" and "Role"
    When I click "Add row below"
    Then the table has 4 rows
    When I click "Add column right"
    Then the table has 4 columns
    When I click "Delete column"
    Then the table has 3 columns
    When I click "Delete table"
    Then no table remains and the cursor is in a paragraph
    And every table button shows a tooltip naming it on hover

  Scenario: Table columns can be resized by dragging the border
    Given the body contains a 3x3 table
    When I drag the border between the first and second column 60 px to the right
    Then the first column is about 60 px wider than before

  Scenario: Columns hold blocks side by side
    When I type "/columns" and press Enter
    Then two empty columns are shown side by side, each outlined while empty
    And the cursor is in the first column
    When I type "left" and press Tab and type "right"
    Then the first column contains "left" and the second contains "right"
    And on a reload the layout is the same

  Scenario: Grouping selected blocks
    Given the body contains paragraphs "one", "two", "three"
    When I select the blocks "one" and "two" and press Meta+G
    Then "one" and "two" are inside one group box and "three" is outside it

  Scenario: Image from a file, with width presets
    When I type "/image" and press Enter
    Then an image placeholder block with "Choose file" is shown
    When I choose a PNG file
    Then the image is shown at medium width
    When I click the image
    Then the "Image" toolbar is shown
    When I click "Full width"
    Then the image spans the editor's full width
    And after a reload the image is still shown at full width

  Scenario: Image from paste and from drag and drop
    When I paste a PNG image from the clipboard
    Then an image block is inserted at the cursor
    When I drop a JPEG file onto the middle of the paragraph "two words here"
    Then an image block is inserted before or after that paragraph, by which half was hit
    And "two words here" stays one paragraph

  Scenario: Video and audio play inline with the app's own controls
    When I type "/video" and press Enter and choose an MP4 file
    Then a video shows with a control bar of COSS parts: a "Play" button, the time, a seek slider
      named "Seek", a "Mute" button and a "Full screen" button
    When I type "/audio" and press Enter and choose an MP3 file
    Then an audio card shows a "Play" button, the time, a "Seek" slider and a "Mute" button
    And neither shows the browser's built-in player controls
    And the time shows hours once a file is an hour or longer, like "1:23:20"
    And the time readout keeps one width while playing, so the slider never moves
    When I click the video's picture
    Then the video block is selected and does not start playing
    When I click "Full screen" on the video
    Then the whole player fills the screen, with the app's control bar still under the picture
    When I click "Exit full screen"
    Then the player is back in the page
    When I click "Play"
    Then the button becomes "Pause" and the time advances

  Scenario: A missing or broken media file says so
    Given an image, a video and an audio block whose files can no longer be loaded
    Then each shows a dashed row: "This image can't be shown", "This video can't be played",
      "This audio can't be played", with a "Choose file" button
    When I choose a new file in one of them
    Then that block shows the new file

  Scenario: A tall video stays on screen
    When I add a portrait video taller than the window
    Then the video is letterboxed to at most 70% of the window's height, with its controls visible

  Scenario: File attachment card
    When I type "/file" and press Enter and choose a PDF file
    Then a file card shows the file's name and size
    And clicking the card opens the file (in the browser build, as a blob: URL a browser can open)

  Scenario: Embed from a URL
    When I type "/embed" and press Enter
    Then an embed placeholder with "Embed URL" is shown
    When I enter "not a link" and press Enter
    Then the "Embed URL" field is marked invalid
    When I enter "https://www.youtube.com/watch?v=dQw4w9WgXcQ" and press Enter
    Then a YouTube player is embedded
    When I paste a YouTube link into an empty paragraph
    Then it becomes an embedded player

  Scenario: Media blocks are removed with Backspace when selected
    Given the body contains an image block
    When I click the image and press Backspace
    Then the image is gone and the cursor is in a paragraph

  Scenario: Every block kind survives a reload
    Given the body contains one of each: heading 4, small text, toggle, alphabetical list,
      roman list, emoji block, code block with language, table, columns, group, image, video, audio, file, embed
    When I wait 1 second and reload the browser
    Then the body contains the same blocks in the same order with the same attributes
