Feature: Safe local grammar suggestions
  The writer chooses every change, and a suggestion never replaces unrelated words.

  Scenario: Apply one suggested correction
    Given a paragraph contains "🙂 I recieved the letter." with "recieved" in bold
    When I review grammar and apply "received"
    Then only "recieved" becomes "received" and it remains bold
    And undo restores the exact paragraph in one step
    And typing before and after the correction is a separate undo step

  Scenario: The page changes while I am reviewing
    Given a suggestion is open
    When I edit the page before applying it
    Then the old suggestion cannot change the new text
    And reviewing again checks the current page

  Scenario: Keep this occurrence of my wording
    Given two paragraphs contain the same flagged wording
    When I choose "Keep this wording" for the first occurrence
    Then that occurrence leaves the review and loses its underline
    And the second occurrence is still offered
    And the page text is unchanged

  Scenario: Remember a personal word
    Given a personal word is flagged as spelling
    When I add it to my dictionary
    Then its spelling suggestion and underline disappear without changing any text
    And it stays in my dictionary after a reload
    When I remove the word from my dictionary
    Then it can be flagged again

  Scenario: Keep code and quoted sources outside the grammar review
    Given a page has a code block, inline code, a page link and words cited from a source
    When I review grammar
    Then those parts are not offered as corrections
    And suggestions in the surrounding prose still point at the exact words

  Scenario: A check is still running or cannot finish
    When the local checker is loading or fails
    Then the review says that it is checking or could not finish
    And it does not claim that the writing has no suggestions
    And retry can check the same text again
