Feature: Highlight selected words
  Highlights use named colours that remain readable in light and dark themes.

  Scenario: Choose and change a highlight
    Given a page contains "Keep these words"
    When I select "these words" and open "Highlight"
    And I choose "Blue highlight"
    Then only "these words" has a blue background
    And the Highlight menu closes
    When I click "Highlight" once and choose "Pink highlight" on that selection
    Then its background is pink
    And the highlight remains after saving and reopening the page

  Scenario: Remove or undo a highlight
    Given some selected words have a blue highlight and others are plain
    When I open "Highlight" and choose "Remove highlight"
    Then those words have no highlight and keep their other formatting
    When I undo
    Then the blue highlight returns

  Scenario: Keyboard and Markdown keep the default highlight
    When I select plain words and press Cmd-Shift-H
    Then the words have a yellow highlight
    When I press Cmd-Shift-H again
    Then the highlight is removed
    When I type "==remember this== "
    Then "remember this" has a yellow highlight
