Feature: Capture while reading
  Keep handwriting, spoken thoughts and photographed passages in the page being read.

  Scenario: A notebook looks like a page of paper
    Given I open a handwritten page
    Then its title sits on the sheet above the writing
    And faint ruling and a margin give handwriting and typed notes the same rhythm
    And Plain, Ruled and Dotted paper are available in notebook options
    And changing the paper style never moves or recolours existing ink
    And the iPad has one flat row of pen, highlighter, eraser, selection and text tools
    And the system pen palette is available from All pens instead of covering the page
    And the sheet and controls use the same paper and ink colours on Mac and iPad
    And the selected Text tool remains visible when its label is hidden on a phone

  Scenario: Remove a capture source without losing its words
    Given a recording or photo has recognized text on my paper
    When I delete the source from its context menu
    Then its editable text stays on the paper

  Scenario: A failed recording save keeps its retry action
    Given saving a paper recording fails
    When I press Quick record again
    Then the unsaved take is retried before another take can start
    And the original audio appears on the paper when saving succeeds

  Scenario: Paper opens as a notebook workspace
    Given I have a paper page with handwriting and typed notes
    When I open it on iPad, iPhone or Mac
    Then the paper is the main surface below a compact set of tools
    And recording and the mobile camera remain one action away in the existing page header
    And a visible Details action opens its metadata without moving the paper
    And any existing document blocks remain visible before the paper

  Scenario: Read a narrow notebook without shrinking its contents
    Given I open a paper page in a narrow pane or on iPhone
    Then I can zoom and pan the paper at a readable scale
    And fitting the whole width does not change saved text sizes or positions
    And controls keep a touch target of at least 44 points on touch devices

  Scenario: Paper selection stays out of the writing
    Given a paper has several text boxes and attachments
    Then unselected items show only their contents
    When I select an item
    Then its boundary and one resize handle become available
    And I can drag the selected item itself to move it
    And deletion is a contextual action rather than a permanent button on the paper
    When I finish editing or tap away
    Then the selection controls disappear without adding an empty text box

  Scenario: Write on a whole page
    Given I created a new notebook on iPad
    When I open handwriting
    Then the notebook is a whole sheet with pen, highlighter, eraser and selection tools
    And no handwriting image block is added to the document
    And I can undo, redo, zoom and scroll on the paper
    And undo history is scoped to the open notebook
    When I write with Apple Pencil and leave the paper
    Then the page keeps editable strokes in their original positions
    And reopening handwriting returns to that same paper

  Scenario: Type between handwritten passages
    Given I have handwritten passages on a paper page
    When I choose Text and tap between the passages
    Then I can type in a text box at that position
    And I can move or resize the text box without moving the ink
    And on iPad I can hold it, choose Move, then tap a destination on the paper
    When I finish typing and choose Pen
    Then I can continue handwriting on the same page
    And reopening the page keeps both the text and the ink editable

  Scenario: Keep paper through interruption
    Given I have changed the ink or text on a paper page
    When I put the app in the background or close the page
    Then the current paper is saved
    And a locally saved draft recovers edits if the app stops before its database save completes
    When saving fails
    Then the paper stays open with my work and offers another save

  Scenario: Read and type on another device
    Given a paper page has synced from my iPad
    When I open the page on my Mac or iPhone
    Then the whole paper and its text boxes are visible in their original positions
    And I can edit the text without flattening the ink
    And simply opening the paper does not change its saved contents
    And the editable strokes and attachments travel through encrypted attachment sync

  Scenario: Preserve earlier document notes
    Given the page already contains typed document notes or image blocks
    When I create a linked notebook
    Then the document and its metadata are unchanged
    And the separate notebook links back to the document
    And returning shows the document notes without a disclosure

  Scenario: Capture directly on paper
    Given I am writing on paper in the iPad or iPhone app
    When I tap Record or Photo
    Then recording starts or the camera opens with that one action
    And the record button shows a timer without moving the paper
    And the saved audio or photo belongs to this paper
    And recognized text appears as an editable text box without replacing its source
    And a recognized source becomes a small playable recording or photo beside its text
    And moving the text keeps its source beside it without changing the ink
    And I can open the original photo at full size
    When I go back to the page before recognition finishes
    Then the paper closes with the source saved for a later recognition retry

  Scenario: Record directly into the current page
    Given I am editing a page on Mac, iPad or iPhone
    When I press "Quick record" or Command+Shift+R
    Then one recording starts in that page without a second Record press
    When I press the shortcut again or "Stop and transcribe"
    Then recording stops and the original audio is saved first
    And supported Apple devices add the transcript as editable paragraphs below the audio
    And another quick press cannot start a duplicate recording while microphone access is pending

  Scenario: Switch pages during recording
    Given a voice block is recording in one page
    When I open another page before pressing Stop
    Then the microphone stops without keeping that unfinished take
    And the new page's header shows Record
    And pressing Record starts a new take in that page

  Scenario: Speech recognition cannot finish
    Given I have stopped a recording
    When the language, device or speech model is unavailable
    Then the audio stays playable and I can retry transcription
    And the message explains what is unavailable
    And silence does not add an empty transcript

  Scenario: Photograph a passage
    Given I am editing a page on iPad or iPhone
    When I tap "Take photo"
    Then the rear camera opens directly
    When I accept the photo
    Then the image is saved in the current page
    And recognised text is added as editable paragraphs below it
    And the image remains available if no text is found

  Scenario: Extract text from an existing image or handwriting
    Given I have selected an image or handwriting block
    When I choose "Extract text"
    Then recognition runs on the device
    And the recognised text is inserted below that block without replacing the original
    And I can undo the inserted text without losing the original

  Scenario: The capture target disappears during recognition
    Given text recognition is running on an image
    When I remove or replace that image
    Then its recognition result is not inserted into another block

  Scenario: Permissions or cancellation leave the page usable
    When I deny microphone or camera access, or cancel the camera
    Then no empty photo is added
    And permission failures explain how to try again
    And I can continue editing the page
