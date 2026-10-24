Feature: Visual precision
  Alignment is part of correctness. These are measured with element boxes,
  at 1280x800, light mode, unless stated. "Equal" means within 1 px.

  Background:
    Given the app is open in a browser at 1280x800 with a page containing
      a heading 1, a paragraph, a bullet item, a to-do item, a quote, a code block and a divider

  Scenario Outline: The block handle sits on the first line of every block kind
    When I hover the <kind>
    Then the vertical centre of "Drag to move" equals the vertical centre of the block's first line
    And the right edge of "Drag to move" is 8 px left of the block's left edge

    Examples:
      | kind        |
      | heading 1   |
      | paragraph   |
      | bullet item |
      | to-do item  |
      | quote       |
      | code block  |
      | divider     |
      | file card   |
      | audio card  |

  Scenario: The handle stays while the pointer travels to it
    When I hover a paragraph and move the pointer slowly left onto "Drag to move"
    Then the handle never disappears on the way

  Scenario: One left edge for title and body, one inset for nested text
    Then the title field's text left edge equals the paragraph text's left edge
    And quote text, bullet and numbered item text, to-do text and toggle title text all start 24 px right of it

  Scenario: Inline controls sit on the line they belong to
    Then an emoji prefix is centred on its line and the line keeps its normal height
    And a toggle's chevron is a 16 px icon centred on the title line, and its content starts at the title text's left edge
    And a code block's controls are centred on the code's first line, with a 16 px chevron in the language picker
    And a selected image shows its toolbar inside the image's top-right corner, outlined, with no tint beyond the image
    And a media placeholder shows no selection tint while its own field has focus
    And a selected video shows its toolbar inside the picture's top-right corner
    And a selected audio card shows "Replace" and "Remove" as flat buttons at the end of its controls row, and keeps its height
    And a selected file card shows "Replace" and "Remove" as flat buttons inside the card's right end, after its name and size
    And a long file name truncates at the same point whether or not the card is selected
    And every selected media block (image, video, audio, file, embed, empty placeholder) is outlined, not tinted
    And no media toolbar covers the title or another block's controls
    And the selected-block tint reaches 4 px past the text, leaving 4 px before the handle

  Scenario: Floating toolbars don't cover the title
    When I select a word in the first block of the page
    Then the selection toolbar opens below the selection
    And for a word further down, it opens above as usual
    When I scroll a long page so a paragraph sits just under the header and select a word in it
    Then the selection toolbar opens below the selection, fully visible
    When the pointer rests on the toolbar over another block
    Then the toolbar stays on top of that block's handle

  Scenario: Sidebar geometry follows COSS
    Then the app's logo tile, the "Recent" label and the page row icons share one left edge
    And every page row is 32 px tall with the icon and the text sharing one vertical centre
    And the "New page" and "Sort Recent" buttons are vertically centred on the "Recent" label,
      4 px apart
    And the row's "More" button is vertically centred on its row

  Scenario: Icons are 16 px and centred in their buttons
    Then every icon in the sidebar, the panel header, the toolbars, the slash menu and the block handle is 16 x 16 px
    And each icon's centre equals its button's centre

  Scenario: One look for every floating surface
    Then the slash menu, the selection toolbar, the table toolbar, the page actions menu and the emoji popover
      share one corner radius, one border colour and one shadow (the COSS popup style)

  Scenario: Slash menu geometry
    When I type "/" at the start of an empty paragraph
    Then the menu's left edge is within 4 px of the "/" character's left edge
    And every item row and every section label is 28 px tall, so rows sit on whole pixels

  Scenario: Selection toolbar geometry
    Given the paragraph contains the word "camera"
    When I select "camera"
    Then the toolbar's horizontal centre is within 2 px of the selection's horizontal centre
    And the toolbar's bottom edge is 8 px above the selection's top edge
    And all buttons are 28 x 28 px and the separator is vertically centred
    And every toolbar button in the table and image toolbars is 28 px tall, text buttons included
    When I click "Link"
    Then the toolbar keeps its width and stays centred

  Scenario: Text rhythm
    Then the body's line height is 1.6 times its font size
    And consecutive paragraphs are separated by exactly 10 px of vertical space, list items by 4 px
    And every block's visible edge (text, quote bar, code box, table border, media card, group border)
      is 10 px from the next block's, nested list items included; a divider has 15 px each side
    And that holds below an open toggle, for one or two lists inside a quote, and around columns
    And a heading 1 has more space above it than below it

  Scenario: Dark mode keeps the same geometry
    Given the browser prefers a dark color scheme
    Then every measurement above is unchanged
