Feature: A quiet place to read books
  Books use the same page editor, highlights and sidenotes as my own writing.

  Scenario: Use the e-ink appearance
    When I turn on "E-ink" in the reading toolbar
    Then the interface uses a paper palette, flat surfaces and quiet monochrome controls
    And motion and translucent glass are removed
    And photographs keep their original colours
    And my choice survives a reload
    When I turn it off
    Then my previous theme is restored
    When I choose another theme in Appearance
    Then E-ink turns off and the chosen theme is used
    When I choose the E-ink theme in Appearance
    Then the E-ink controls and flat surfaces turn on together

  Scenario: Import a PDF
    When I open "Reading library" and choose a PDF
    Then the original file is saved in a Book page
    And its text becomes linked reading sections with the original page numbers
    And I can highlight words and add a sidenote in each section
    And long books are split into sections so typing remains responsive
    And I can open the original PDF whenever I need its exact layout

  Scenario: A scanned PDF
    Given a PDF page contains no selectable text
    When I import it
    Then the page is kept as an image
    And I can use "Extract text" in the Apple apps to recognise its words

  Scenario: A password-protected PDF
    Given I know the password for a PDF
    When I enter it in the import dialog and choose the PDF
    Then the PDF can be imported
    When the password is wrong or the file cannot be read
    Then the dialog explains the failure and stays open for another attempt

  Scenario: Import an EPUB I can read outside Kindle
    When I choose an unencrypted EPUB
    Then its chapters become linked reading sections in order
    And its images are saved locally
    And no scripts or remote resources from the book run in LeadingLight
    When I choose an encrypted EPUB or a Kindle-only file
    Then I am directed to its authorized reader rather than given an empty book

  Scenario: Keep notes beside a Kindle purchase or Libby loan
    When I choose Kindle or Libby in "Reading library"
    Then I can name the book and save a link to its authorized reader
    And I get a Book page for my notes, photos, voice recordings and sidenotes
    And the page explains that protected book text remains in the service's reader
    And I can import exported highlights as text without replacing my existing notes
