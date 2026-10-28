Feature: Writing help that leaves room to think
  The writer chooses when to review and what to change. Learning is optional and local.

  Scenario: Draft without interruptions
    Given Grammar check is on and help is set to "When I ask"
    When I write "I recieved a apple." and pause
    Then no spelling or grammar underlines, error totals, or correction popups appear
    And the text is unchanged
    When I choose "Review writing" from the page's Writing menu
    Then one suggestion is shown with the original words and a proposed change
    And the review can be closed at any time without changing text

  Scenario: Fix a slip quickly without rewriting my voice
    Given the review offers "received" for my bold word "recieved"
    When I press Apply
    Then only that word changes and its bold formatting remains
    And Undo restores that change without undoing earlier writing
    And no other suggestion is applied automatically
    And a choice called "Keep this wording" leaves my words unchanged

  Scenario: Learn one small thing
    Given a suggestion has a supported lesson
    When I choose "Why?"
    Then I see a short explanation and one example
    And I may save the tip or try one two-choice practice
    And practice never edits my page
    And either answer explains the choice without a score or a failure label
    And I can move on without answering

  Scenario: Come back to learning when I want
    Given I saved a tip
    When I reopen the app and choose "Saved tips" in the review
    Then I can reread the tip or try its practice
    And I can remove it
    And no streak, countdown, reminder, or mastery claim appears
    And only generic tips are kept, not a history of my sentences

  Scenario: Read aloud instead of reading more
    Given a local English speech voice is available
    When I choose "Listen" in the review
    Then the displayed words are spoken only after my request
    And Stop or closing the review stops speech
    And no remote speech voice is selected
    And when no local voice is available the review explains that Listen is unavailable

  Scenario: My specialist words belong here
    Given a spelling suggestion flags a word I use
    When I choose "Remember word"
    Then the word stays unchanged and is no longer flagged after reload
    And I can remove it from "My words"
    And a failed save explains that the word was not remembered

  Scenario: Opt into help by the words
    When I choose "While I write" in Writing settings
    Then grammar underlines are available
    And clicking an underline opens its suggestion
    And the Writing menu offers the same review using only the keyboard
    And no correction is made without my choice

  Scenario: A review never changes stale or protected text
    Given a suggestion is open
    When the source changes before I apply it
    Then unrelated text is not changed and the review refreshes
    And code, page links, and attributed quotations are excluded
    And read-only reports cannot be corrected

  Scenario: The checker has limits
    When checking is still running or fails
    Then the review says so and offers Retry for a failure
    And it does not say there are no suggestions before checking finishes
    When checking finishes without suggestions
    Then it says "No suggestions from this check" rather than grading my writing
