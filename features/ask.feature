Feature: Ask about this
  Select words in a note, ask a question, and read the answer in a panel that belongs to the
  note. The answer comes from Claude through the Claude Code you installed and signed into on
  this Mac (`claude -p`, your subscription); the app holds no key. In a browser build, where
  there is no Claude Code, a stand-in answers so the panel can be tried and tested.

  Names used below:
  - Ask: the last item of the selection toolbar, and ⌘J
  - the ask bar: toolbar "Ask Claude" beside the selected words (features/composer.feature)
  - the agent panel: region "Agent" inside the page panel, docked to a corner of the note

  Background:
    Given the app is open in a browser at 1280x800 with a page whose body reads
      "The mitochondria is the powerhouse of the cell."

  Scenario: Ask from the selection toolbar
    When I select "powerhouse" and click Ask
    Then the ask bar appears above the words, its field focused
    When I type "What does this mean?" and press Enter
    Then the agent panel opens in the bottom-right corner of the note
    And it shows "powerhouse" quoted, the question under it, then the answer streams in as Markdown
    And while it streams a Stop button shows; when it ends the field is ready for a follow-up

  Scenario: Ask with ⌘J
    When I select "the cell" and press Meta+J
    Then the ask bar appears by "the cell"
    When I click "Quote in reply"
    Then the agent panel opens with "the cell" quoted above the question field, which has focus
    When nothing is selected and I press Meta+J
    Then the panel opens with no quote, ready to ask about the whole page

  Scenario: Nothing typed while asking reaches the page
    Given the agent panel is open with its field focused
    When I type "hello" and press Enter
    Then the page body is unchanged

  Scenario: The answer can go into the note
    Given an answer has arrived for "powerhouse"
    When I click "Insert below"
    Then the answer's paragraphs appear after the block that held the selection
    When I ask again and click "Replace"
    Then the quoted words are replaced by the answer, inline when the answer is one paragraph
    And Replace goes away, since those words are gone
    When I click "Copy"
    Then the clipboard holds the answer as Markdown and the button shows a check for a moment

  Scenario: Replace never eats the wrong words
    Given an answer has arrived for "powerhouse" and I have since typed more at the start of the page
    When I click "Replace"
    Then it finds "powerhouse" where it is now and replaces that
    And if the words are no longer in the page, nothing changes and the panel says so

  Scenario: A thread stays with its page
    Given an answer is streaming on page A
    When I switch to page B and back to A
    Then A's thread is there with its answer, and B has none

  Scenario: A follow-up keeps the thread
    Given an answer has arrived
    When I type "Shorter" and press Enter
    Then the second answer comes in the same thread, under the first
    When I edit the note and ask again
    Then the answer sees the note as it is now, not as it was at the first question

  Scenario: The panel moves and resizes
    Given the agent panel is open
    When I choose "Top left" from its corner menu
    Then it sits in the top-left corner of the note and stays there when I reopen it
    And the corner facing the page shows a resize mark that fills in when the pointer is over it
    And dragging that mark resizes it, no smaller than 280 by 240

  Scenario: Closing and reopening
    Given an answer has arrived
    When I press Escape
    Then the panel closes and focus returns to the editor
    When I press Meta+J again
    Then the panel shows the same thread

  Scenario: Stop
    When I ask a question and click Stop while it streams
    Then the answer stops where it was and the field is ready again

  Scenario: Not signed in
    Given Claude Code reports "not logged in"
    When I open the panel
    Then it says to sign in with "claude auth login" in Terminal, with a "Check again" button
    And the question field still takes the keyboard, but Send stays off until signed in

  Scenario: Claude Code is not installed
    Given no claude binary is found
    When I open Settings › AI
    Then it says Claude Code is not installed, with a link to install it, and Ask says the same

  Scenario: Settings › AI
    When I open Settings › AI
    Then it shows the account Claude Code is signed into, with the plan
    And a Model row (Opus, Sonnet, Haiku; Opus chosen) and an Effort row (Low, Medium, High; Medium chosen)
    And a line saying notes stay on this Mac and only the selection and the page go to Anthropic when you ask
