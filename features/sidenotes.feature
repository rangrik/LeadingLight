Feature: Sidenotes, thoughts and essays
  A sidenote is a thought written beside a sentence or a paragraph. Its text lives in the page's
  Thoughts page, which collects every raw thought on that page. When ready, "Write essay" opens
  a linked essay beside the page, and selected text can be quoted into it with a reference.

  Names used below:
  - "Add sidenote" in the selection toolbar; ⌘⇧M does the same, and with no selection it notes
    the whole paragraph holding the cursor
  - margin: the column right of the text where notes sit, each level with its sentence
  - note number: the small numbered chip after a noted sentence
  - "Remove sidenote": a button on a note, shown while the pointer is over it
  - "Write essay" / "Open essay" in "Page options"; "Close essay" in the essay pane's header
  - "Add to essay" in the selection toolbar, shown once the page has an essay

  Background:
    Given the app is open in a browser at 1440x900 with a page "Article" holding three paragraphs

  Scenario: Adding a sidenote to a sentence
    Given the sidebar is open
    When I select a sentence in the second paragraph and click "Add sidenote"
    Then the sentence gets a dotted underline and a note number "1" after it
    And a note opens in the margin level with the sentence, with the cursor in it
    And the sidebar collapses, and the text moves left to make room for the margin
    And "Thoughts" appears nested under "Article" in the sidebar
    When I type "Is this true for small teams?" and reload
    Then the note still shows "Is this true for small teams?" beside the sentence

  Scenario: A sidenote on a whole paragraph
    When I put the cursor in the third paragraph, select nothing, and press ⌘⇧M
    Then the whole paragraph is noted and its note opens in the margin
    When I press ⌘⇧M in an empty paragraph
    Then nothing happens

  Scenario: Notes are numbered in reading order and never overlap
    Given I add a note on paragraph 3, then a long note on paragraph 1, then one on paragraph 2
    Then the notes are numbered 1, 2, 3 from the top
    And each note sits level with its sentence, or just below the note above it, never on top
    When the pointer rests on a note number or a note
    Then a line runs from the sentence to its note

  Scenario: The Thoughts page collects every note
    Given notes on two sentences
    When I open "Thoughts" under "Article"
    Then it shows both notes, each under the sentence it belongs to
    When I click a quoted sentence there
    Then "Article" opens with that sentence in view, briefly lit
    When I go back to "Thoughts", edit a note, and open "Article"
    Then the margin shows the edit

  Scenario: Removing a sidenote
    When I click "Remove sidenote" on a note
    Then the sentence loses its underline and number, and the note leaves the margin and the Thoughts page
    When I delete the text of another noted sentence instead
    Then its note leaves the margin but stays in the Thoughts page
    When I delete a thought's block in the Thoughts page and open "Article"
    Then its sentence is no longer noted and its note is gone from the margin
    When I delete the Thoughts page, with "Article" open
    Then every note leaves "Article" at once
    When I add a sidenote and type in it
    Then a new Thoughts page appears under "Article" and keeps the note after a reload

  Scenario: Writing an essay beside the source
    When I choose "Write essay" in "Page options"
    Then an essay page opens on the right with the cursor in its title
    And "Article" stays on the left with its notes in the margin
    And the essay appears nested under "Article" in the sidebar, and the sidebar collapses
    When I click "Close essay"
    Then "Article" fills the panel again, and "Page options" offers "Open essay"
    When I click the essay in the sidebar
    Then "Article" opens with the essay beside it

  Scenario: The margin always has room
    Given the window is 1100 px wide and the essay is open beside "Article"
    Then the pane I last worked in is open, and the other is a slim strip with its title
    When I click the "Article" strip and add a sidenote
    Then "Article" shows its full margin and the essay is the strip
    When I click the essay strip
    Then the essay opens and "Article" becomes the strip

  Scenario: Quoting into the essay
    Given "Article" has its essay open beside it, with the cursor in the essay's second paragraph
    When I select a sentence in "Article" and click "Add to essay"
    Then the essay gets a quote of that sentence after its second paragraph, ending in a reference "Article"
    And the sentence in "Article" gets a quote mark after it
    When I click the reference in the essay
    Then "Article" scrolls to the sentence and it is briefly lit
    When I click the quote mark in "Article"
    Then the essay scrolls to the quote

  Scenario: A quote and its words stay linked
    Given "Article" has two sentences quoted in its essay
    When I delete the first quote in the essay, or only its reference
    Then that sentence in "Article" loses its underline and quote mark at once, and the other keeps them
    When I undo in the essay
    Then the quote is back, and so are the sentence's underline and quote mark
    When I delete it again, close the essay and reload
    Then that sentence has no mark, and the other still has its own
    When I delete the essay page
    Then no sentence in "Article" keeps a quote mark, and "Page options" offers "Write essay" again
