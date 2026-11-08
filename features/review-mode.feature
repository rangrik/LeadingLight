Feature: Reviewing a report in review mode
  An agent's report is read where it shows, on its task, under the brief. Review mode turns the pane
  into a place to read one report and answer it, without leaving the task: the brief folds to one
  line, the report fills the column, notes go in the margin, a few presses give a verdict on words,
  and a bar at the bottom sends the notes, accepts, or ends the review. A second draft can be read
  as what changed since the first. The report never changes; nothing is stored but notes.

  Names used below:
  - "Write the pricing page copy": a task assigned to Claude, with two reports by its agent:
    "Pricing copy, first draft" and, newer, "Pricing copy, second draft", which rewrites some
    paragraphs (the ?demo space has these)
  - "Empty states audit": the only report on "Audit the empty states"
  - review bar: the 44 px bar at the bottom of the pane in review mode
  - verdicts: the Keep, Change and Ask buttons on the selection bar in review mode

  Background:
    Given the browser build is open at "/?mac&demo"
    And "Write the pricing page copy" is open

  Scenario: Entering review mode from the report on the task
    When I press Review on the byline of "Pricing copy, second draft"
    Then the same pane shows review mode, with no dialog and no new pane
    And at the top one line reads "Write the pricing page copy" and the brief's first words, with a
      chevron pointing right
    And below it the report's byline, its title and its words, at a 72-character measure
    And the margin on the right is kept for notes, with the report's notes in it
    And the task's card, properties, other reports and backlinks are not shown
    And the review bar shows "No notes ticked", Accept and Done

  Scenario: Entering review mode from the report's own page
    Given "Pricing copy, second draft" is open as its own page
    When I press Review in its header
    Then the same pane shows "Write the pricing page copy" in review mode for that report

  Scenario: Review is offered only where there is something to send
    Then every report on a task with an agent has Review on its byline
    And a report on a page that is not such a task has no Review

  Scenario: The fold
    Given review mode is on for "Pricing copy, second draft"
    When I press the folded line
    Then the brief shows under it, as the task's own words, and the chevron points down
    And a note written on the brief is a note on the task, as anywhere
    When I press it again
    Then the brief folds back to the one line

  Scenario Outline: A verdict on words
    Given review mode is on for "Pricing copy, second draft"
    When I select "<words>" in the report
    Then the selection bar offers Add sidenote, Keep, Change and Ask
    When I press <verdict>
    Then a note opens in the margin level with the words, its first line "<verdict>"
    And its tick is on, and the review bar says "1 note ticked" with "Send 1 note"
    And the caret is on the note's next line, so typing adds words under the verdict
    When I click back in the report without typing
    Then the note reads "<verdict>" alone, with no empty line under it

    Examples:
      | words                    | verdict |
      | Notes that think with you | Keep    |
      | $15 a seat a month       | Change  |
      | try it free for 14 days  | Ask     |

  Scenario: Verdicts only in review mode
    When I select words of "Pricing copy, second draft" under the brief, not in review mode
    Then its selection bar offers only Add sidenote, as before

  Scenario: Changes, with a previous report by the same agent
    Given review mode is on for "Pricing copy, second draft"
    Then the folded line has a Changes toggle, off
    When I turn Changes on
    Then the report's words are replaced by what changed since "Pricing copy, first draft": removed
      words struck through in the destructive colour, added words in the success colour, and the
      paragraphs that didn't change between them, in the system font, in light and dark
    And the verdicts and Add sidenote are not offered on the changes
    When I turn Changes off
    Then the report's words and their notes are back, and a new note can be added

  Scenario: No Changes without a previous report
    Given "Audit the empty states" is open, and review mode is on for "Empty states audit"
    Then the folded line has no Changes toggle
    And reviewing "Pricing copy, first draft" has no Changes toggle either, as nothing came before it

  Scenario: The review bar sends the ticked notes
    Given review mode is on for "Pricing copy, second draft", with notes Keep and Change ticked
    When I press "Send 2 notes" on the review bar
    Then it is sent at once, as from the task's card (feedback.feature), and a toast says "Sent to Claude"
    And the bar says "No notes ticked" and the notes say "Sent"
    And a send that fails says "Not sent" on the notes and in a toast; Try again is in the task's stream,
      shown once review mode ends

  Scenario: The review bar accepts
    Given "Audit the empty states" is open, and review mode is on for "Empty states audit"
    When I press Accept on the review bar
    Then the task is done, accepted on "Empty states audit", as from the card (DECISIONS 26)
    And the bar says "Accepted just now" in place of Accept, and review mode stays on
    And on "Write the pricing page copy", whose subtasks aren't all done, the bar says "Subtasks still
      open" in place of Accept, as the card offers no Accept then either

  Scenario: Done leaves review mode
    Given review mode is on for "Pricing copy, first draft", which is folded on the task
    When I press Done
    Then the task shows as before: title, card, brief and its reports
    And "Pricing copy, first draft" is unfolded and at the top of the pane at once (as high as the
      page lets it go, when little comes after it)

  Scenario: Esc is Done
    Given review mode is on for "Pricing copy, second draft"
    When I click in the report's words and press Esc
    Then review mode ends, as with Done
    When I enter it again, start typing in a note and press Esc
    Then review mode stays on

  Scenario: Leaving the page
    Given review mode is on for "Pricing copy, second draft"
    When I open another page in the pane and come back, or reload
    Then the task shows as before, not in review mode
