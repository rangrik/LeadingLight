Feature: Reading layout
  A page you read from (a source) gets a "Your words" column beside its text, so taking
  something from it is one step away: its sidenotes, your takeaways, the names and ideas in it
  worth a page, and the essay it could become.

  Names used below:
  - source: a Book, a page with a source address (a saved webpage), or any page with "Reading layout" on
  - "Reading layout": a checked item in "Page options" (the header's ⋯), also ⌥⌘R for the page in front
  - "Your words": the column right of the text, 320 px, with Notes, Takeaways, Concepts and Write it up
  - concept chip: a small chip in Concepts; one with a link icon links, one with a plus makes a page

  Background:
    Given the browser build is open at 1440x900 with the demo space (?demo) and the sidebar folded

  Scenario: A Book is a source
    When I open the Book "Thinking in Systems"
    Then a "Your words" column shows right of the text, its first line level with the title
    And it lists Notes, Takeaways, Concepts and Write it up, in that order
    And the text keeps its width and does not run under the column

  Scenario: A saved webpage is a source
    When I open "Leverage Points: Places to Intervene in a System", which has a source address
    Then the "Your words" column shows

  Scenario: Turning the reading layout on and off
    Given I open "Notes on Thinking in Systems", a plain page
    Then no "Your words" column shows
    When I open "Page options" and choose "Reading layout"
    Then the column shows, and "Page options" shows "Reading layout" checked with ⌥⌘R beside it
    When I press ⌥⌘R
    Then the column goes and the text is as wide as before
    When I open "Thinking in Systems" and press ⌥⌘R
    Then its column goes, and stays gone after a reload, though it is a Book
    When I press ⌥⌘R again
    Then the column is back

  Scenario: Notes list the page's sidenotes
    Given "Notes on Thinking in Systems" in the reading layout, with two sidenotes in the margin
    Then Notes lists both, numbered as in the margin, each showing its note's first line
    And the sidenotes stay in the margin, between the text and the column, with no overlap
    When I click the second row
    Then the page scrolls to the second note's words and they are lit for a moment
    When I select a sentence in the body and click "Add note" in Notes
    Then the sentence gets note number 3, its note opens in the margin with the cursor in it
    And Notes lists a third row
    When I type "Delays again" in that note
    Then the third row reads "Delays again"

  Scenario: Add note needs a place in the page
    Given "Thinking in Systems" with the cursor in its title
    When I click "Add note"
    Then no note is made, and Notes says "Select words in the page first." for a few seconds

  Scenario: Takeaways are saved with the page
    Given "Thinking in Systems" with no takeaways
    Then Takeaways shows "In your own words…" in a muted colour
    When I click it and type "Structure makes behaviour", Enter, "Delays make oscillation"
    And I reload the page
    Then Takeaways shows those two lines
    And the page's body is unchanged

  Scenario: Concepts offer to link titles named in the text
    Given "Notes on Thinking in Systems" in the reading layout
    Then Concepts shows a link chip "LeadingLight", which the text names without a link
    And pages the text already links ("Stocks and flows", "Feedback loops", "Donella Meadows") have no chip
    When I open "Thinking in Systems", whose text says "as Meadows puts it"
    And "Meadows" is an alias of the page "Donella Meadows"
    Then Concepts shows a link chip "Meadows"; its tooltip says it links to Donella Meadows
    When I click "Meadows"
    Then "Meadows" in the text becomes a link to "Donella Meadows"
    And the chip goes, Concepts says "Nothing to link yet.", and the rest of the text is unchanged

  Scenario: Concepts offer to make pages for repeated names
    Given "Notes on Thinking in Systems" in the reading layout
    And its text names "Forrester" and "MIT" twice each, and neither is a page
    Then Concepts shows plus chips "Forrester" and "MIT", at most five such chips
    And words that only start a sentence ("The", "Resilience") have no chip
    When I click "Forrester"
    Then a Page "Forrester" exists and the first "Forrester" in the text links to it
    And nothing new opens, and the chip goes

  Scenario: Write it up opens the essay
    Given "Thinking in Systems" in the reading layout with no essay
    Then Write it up shows "Essay · 0 quotes"
    When I click it
    Then the page's essay opens beside it, and the narrower Book folds its column into tabs
    When I select a sentence in "Thinking in Systems" and click "Add to essay"
    And I choose the "Your words" tab
    Then Write it up shows "Essay · 1 quote"

  Scenario: Empty sections say what goes there
    When I open "How to Take Smart Notes", a Book with an empty body
    Then Notes says "No notes yet. Select words and press ⇧⌘M."
    And Takeaways shows "In your own words…"
    And Concepts says "Nothing to link yet."
    And Write it up shows "Essay · 0 quotes"

  Scenario: A narrow pane folds the column into tabs
    Given "Notes on Thinking in Systems" in the reading layout, in a pane 1000 px wide
    Then there is no column; a "Page" and "Your words" tab strip sits above the body, on "Page"
    When I choose "Your words"
    Then the body is replaced by Notes, Takeaways, Concepts and Write it up
    When I click a note's row there
    Then the "Page" tab comes back and the page scrolls to that note's words
    When I choose "Your words" and then "Page"
    Then the body is back as it was
    When the pane grows to 1200 px
    Then the tabs go and the column is back

  Scenario: Thoughts pages, essays and reports are never sources
    When I open the Thoughts page under "Notes on Thinking in Systems"
    Then no column shows, "Page options" has no "Reading layout", and ⌥⌘R does nothing
