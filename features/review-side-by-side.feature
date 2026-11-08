Feature: Review side by side
  Reviewing an agent's work puts the brief and the report in view together: the task on the left,
  the report's own page on the right. A strip under the report's crumbs holds what the review
  needs: the agent's steps, its pending question, Send, Accept, and the next thing that needs me.
  The panes are the ones the app already has, so closing the report leaves the task as it was.

  Names used below:
  - "Write the summary": a task in "Research" assigned to Claude, with its report "Summary"
  - "Audit the notes": another assigned task, ready for review with its report "Audit"
  - review: the task in a pane, and beside it, to its right, the report's own page
  - strip: a 36 px row under the right pane's crumbs, with a hairline below it

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And Claude's checklist for "Write the summary" has 2 of 4 steps done

  Scenario: Review from the task's card
    Given "Write the summary" is ready for review and is open alone
    When I press Review on its card's review line
    Then the task stays in its pane, scrolled to its top, with the brief and its card in view
    And "Summary" opens in a new pane to its right, which has the keyboard
    And the strip reads "2 of 4 steps done", Accept and Review next
    And the right pane's header has no Send of its own; the strip has it

  Scenario: Review from the Feed
    Given I am reading "Plan", and the Feed lists "“Write the summary” is ready for review"
    When I select the item
    Then "Write the summary" opens in a new tab in front of "Plan", and "Summary" opens beside it
    And "Plan" is still in its tab, where I left it

  Scenario: Nothing opens twice
    Given "Write the summary" and "Summary" are side by side
    When I press Review again, or select its item in the Feed
    Then there are still two panes, the same ones, and the right one has the keyboard
    Given instead only "Summary" is open
    When I select its item in the Feed
    Then "Write the summary" opens to the left of it, and nothing else moves

  Scenario: The steps
    When I press "2 of 4 steps done" in the strip
    Then the four steps open under it, two ticked, as on the card; pressing again folds them
    And with no checklist from the agent, the strip shows no count

  Scenario: Answering the agent's question from the strip
    Given Claude asks "Should we ship in May or June?" with options May and June, after its first draft
    When I select the question in the Feed
    Then the task and "Summary" open side by side
    And the strip shows the question with May and June, and what the question is about
    And it shows no Accept while the question waits
    When I choose "June" in the strip
    Then it says "Sent. Waiting for the agent to take it." or the question goes
    And the Feed item goes, and the agent's chat shows it answered: one answer, wherever given
    And the card says "Working" once the agent carries on

  Scenario: An answer that doesn't go
    Given the runtime refuses the answer
    When I choose "June" in the strip
    Then it says "Not sent" with the reason and Try again, as in the Feed, and the question stays

  Scenario: A question before any report
    Given Claude asks about "We ship in May" in "Plan" and has published nothing
    When I select the question in the Feed
    Then the task opens with "Plan" beside it, and the strip on "Plan" shows the question
    And had the agent not said what it is about either, its Agent page opens beside instead

  Scenario: Notes and Send
    Given the task and "Summary" are side by side
    When I write a note on "Summary" in the right pane and tick it for sending
    Then the same note shows on "Summary" under the task's words in the left pane
    And the strip reads "Send 1 note"
    When I press it
    Then the batch is sent to Claude as from the card, saying "Sent to Claude"
    And had the runtime refused it, it would say "Not sent" and why

  Scenario: Accepting from the strip
    Given "Write the summary" is ready for review side by side with "Summary"
    When I press Accept in the strip
    Then the task is done: the strip says "Accepted just now" in place of Accept
    And the card says Done, and the task's tab and sidebar row lose their dot

  Scenario: Review next
    Given the Feed also lists "“Audit the notes” is ready for review"
    When I press Review next in the strip
    Then "Audit the notes" takes the task's place in the left pane and "Audit" the report's in the right
    And there are still two panes
    When nothing else in the Feed needs a review or an answer
    Then the strip reads "Nothing else needs you" where Review next was

  Scenario: Closing the report
    Given the task and "Summary" are side by side
    When I close the right pane
    Then the task fills the page area alone, as it was, and the strip went with the pane
    And the task's tab (when its pane has more than one) and its sidebar row keep the state dot

  Scenario: A report opened beside its task another way
    When I Shift-click Open on "Summary" under the task's words
    Then "Summary" opens beside the task with the strip, as from Review
    And a report open with its task nowhere in view has no strip
