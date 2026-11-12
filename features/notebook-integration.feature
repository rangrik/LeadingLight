Feature: Documents and notebooks stay distinct
  Drawing never hides a document, changes its type or discards its metadata.

  Scenario: Start a notebook beside an existing document
    Given a document has unsaved paragraphs, a sidenote, tags and a description
    When I choose "New linked notebook" from the page actions
    Then a separate notebook is created with a link back to the document
    And the document keeps its id, type, body, sidenote and properties
    When I return to the document
    Then all its text and metadata are visible without opening another menu
    And "Open linked notebook" returns to the same notebook

  Scenario: Create an independent notebook
    When I choose "New notebook"
    Then a new notebook is created without changing the page I was reading
    And it has its own title, properties, history and paper
    And creating a normal page still creates a document

  Scenario: Type changes never convert notebooks or documents
    Given a notebook contains ink, text boxes, audio and a custom property
    When I open its details
    Then its Notebook type has no conversion menu
    When another writer attempts to change its type to Book or Page
    Then the change is refused before any content or property is changed
    And its ink, text boxes, audio and custom property remain unchanged
    And its title and metadata are still editable
    And Notebook is not offered in a document's type menu
    And normal document type changes preserve their properties

  Scenario: Older mixed pages expose all existing content
    Given an earlier version added paper to a document with paragraphs and image blocks
    When I reopen the page
    Then the document body and metadata are visible before its handwriting
    And opening and closing handwriting leaves that body visible
    And reading the page does not move or rewrite its ink, attachments or content

  Scenario: Quick capture uses the existing page header
    Given I am reading a document or a notebook
    Then Record and the mobile camera are one action away in the page header
    And there is no second persistent Write, Record, Photo and zoom row
    And notebook zoom and paper choices are available only for a notebook
    And narrow layouts retain a readable title and usable touch targets

  Scenario: Pencil double tap respects the system choice
    Given I am drawing with a supported Apple Pencil
    When I double tap with Switch to eraser enabled in system settings
    Then the eraser becomes active and another double tap restores my drawing tool
    And choosing Eraser after typing still remembers the previous drawing tool
    When Switch to previous tool is enabled
    Then double tap swaps the current and previous drawing tools
    When the system choice is Off
    Then double tap does not change the tool

  Scenario: Typing has an explicit exit
    Given I am drawing in a notebook
    When I select Text
    Then the keyboard stays closed until I place or edit a text note
    When the keyboard is open
    Then Finish typing remains visible above it
    And Finish typing, Escape or Command+Enter saves the text and returns to Pen
    And opening or closing paper never focuses a hidden document editor

  Scenario: Notebook creation fails safely
    Given saving a new notebook fails
    When I choose New linked notebook
    Then the source document stays open and unchanged
    And an error explains that the notebook could not be created
    And retrying does not create duplicate linked notebooks

  Scenario: A linked notebook keeps an unwritten source page
    Given I have just created a page without typing into it
    When I create its linked notebook and restart the app
    Then the source page still exists and the notebook can return to it

  Scenario: Deleted or unavailable links do not strand a notebook
    Given a notebook links to a source document
    When the source document is deleted
    Then the notebook and all its contents remain usable
    And its unavailable source is not offered as a working link

  Scenario: Notebook details keep long metadata readable
    Given a notebook has a title and description that each wrap onto several lines
    When I reopen Notebook details or rotate the device
    Then every line remains visible
    And the close button stays below the device status bar
    When I paste several lines into its title
    Then they become a single title separated by spaces
    And no document blocks or keyboard focus are created behind the notebook

  Scenario: A history copy does not replace the source's usual notebook
    Given a document has a linked notebook
    When I open a notebook version in history
    Then its ink and placed text are visible in a scrollable paper preview
    And viewing the version cannot edit its paper
    And the history close button stays below the device status bar
    When I keep a copy of a notebook version
    Then the copy has its own page and keeps its paper and source relation
    And Open linked notebook on the source still opens the oldest linked notebook

  Scenario: Unreadable paper never becomes a blank document
    Given a notebook has paper saved in an unsupported format
    When I open it
    Then a message explains that this version cannot read the paper
    And history is available for recovery
    And document typing and capture are unavailable
    And its saved paper and metadata are not rewritten
