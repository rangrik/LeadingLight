Feature: Handwriting belongs to the document
  A page mixes normal blocks, ink over blocks, and handwriting between blocks.

  Scenario: Enabling writing is reversible and does not convert a page
    Given a Book page has text, an image, metadata and a sidenote
    When I enable Write on this page and then finish without drawing
    Then its stored content, type and properties are unchanged
    And the same page remains open without a keyboard or another editor

  Scenario: Ink follows a block through movement and undo
    Given I circle words in a paragraph and draw over an image
    When I insert a paragraph above them and move the annotated blocks
    Then each drawing stays with its original block
    When I duplicate a drawn block and erase a stroke from the copy
    Then the original drawing is unchanged
    When I delete the original block and undo
    Then its text and drawing return together
    And both survive saving and reopening the page

  Scenario: Annotated lists act as one visible block
    Given a list has handwriting over one of its items
    When I open the block menu from any item or select its block with the keyboard
    Then the whole annotated list is visibly selected
    When I duplicate or drag that selected block
    Then every list item and its handwriting travel together
    And erasing ink in the duplicate leaves the original unchanged
    And ordinary lists still allow individual item actions

  Scenario: Handwriting fits between typed blocks
    Given a page contains two paragraphs
    When I choose Write below on the first block
    And draw near the bottom of the handwriting space
    Then the space grows and the second paragraph moves down
    When I finish writing
    Then the page shows the first paragraph, handwriting and second paragraph
    And I can continue typing after the handwriting

  Scenario: Text edits never silently misplace an annotation
    Given I circle a phrase in a paragraph
    When unchanged marked words move without changing their line shape
    Then the circle follows the phrase
    When I change the marked words or reflow them across different lines
    Then the original drawing and original context remain available for review
    And the drawing is not painted over unrelated text
    When I undo the text change or restore the original layout
    Then the drawing aligns with the original words again

  Scenario: Input does not summon the keyboard or trap scrolling
    Given writing is active on an iPad
    Then Pencil draws and a finger scrolls
    And Draw with finger can be enabled explicitly
    When I enter writing with text selected
    Then the text selection handles close without changing the selected block
    And a handwriting space has no text-selection tint while I draw
    When I finish writing, switch pages, or open a sheet
    Then no stroke continues on another surface
    And completed ink remains saved

  Scenario: History, copy and save failure preserve ink
    Given a document contains over-block ink and handwriting between blocks
    When I copy and paste its annotated blocks
    Then their text and ink remain together and independently editable
    When saving fails
    Then the existing save error remains visible and retry keeps the ink
    When I view or restore page history
    Then its ink is visible and viewing cannot alter it

  Scenario: An unfinished stroke counts as an unsaved edit
    Given a prior stroke has finished saving
    And I am still drawing the next stroke
    When sync checks whether it can replace the open page
    Then the page reports unsaved changes
    And a live replacement cannot overwrite that stroke

  Scenario: Older content remains untouched
    Given existing pages include ordinary documents, old mixed pages and notebooks
    When I install this update and open those pages
    Then their stored text, metadata, strokes and attachments are not migrated
    And standalone notebook tools remain available

  Scenario: A newer document arrives while its page is already open
    Given an editable page is open
    When its content is replaced with a document containing an unknown block
    Then known text is shown read-only with an unsupported-content notice
    And reading the document returns every original block and attribute
    And the preview never saves a partial document
    When a supported document replaces it
    Then editing and saving work normally again

  Scenario: Dense handwriting survives device sync
    Given a handwriting space contains 65536 valid saved points
    When a history event syncs the before and after versions of its page
    Then every point and its original image context reaches the other device
    And extended point data cannot hide an attachment from validation
