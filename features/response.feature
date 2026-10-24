Feature: Reading the agent's answer to my feedback
  The agent answers a batch of feedback with one new report: a part for each point I sent, saying
  what the point was about and linking to it, then its answer. A point it doesn't answer says so and
  why, and the report says it isn't complete. I read the answer, make fresh notes on it if I like, and
  send a new batch. I never close or tidy the old notes: once sent, they are done.

  Names used below:
  - "Write the summary", its report "Summary", and a batch of two points sent on it with the comment
    "Keep it short." (features/feedback.feature)
  - response: the report that answers a batch

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And the batch was sent to Claude, the task's agent

  Scenario: One answer, point by point
    When the agent answers the batch
    Then one new report shows in the task's stream after the batch, with "answers your feedback"
      in its byline
    And it has "Point 1" and "Point 2", each saying "On “<the words>” in Summary" and then the answer
    And the Feed lists "Claude answered your feedback on “Write the summary”"

  Scenario: Its links work
    When I press the words of point 1 in the response
    Then "Summary" opens with its note 1 lit
    When I press "your note" in point 2
    Then the batch as I sent it opens

  Scenario: The words are gone, the point isn't
    Given I deleted the sentence note 2 was written against
    Then the response and the batch still show what point 2 was about, as it was when sent

  Scenario: An answer that leaves a point out
    When the agent answers point 1 and says it can't answer point 2 because it needs the budget figures
    Then point 2 reads "Not answered: it needs the budget figures"
    When the agent leaves a point out altogether
    Then that point reads "Not answered", the byline says "1 of 2 points answered", and the task
      isn't ready for review because of it

  Scenario: Only the batch's own agent answers it, about its own points
    When another agent publishes an answer to the batch, or an answer to a point it doesn't have
    Then the publish is refused, saying which of the two it was, and nothing shows

  Scenario: A second round
    Given I read the response and add a note to its answer for point 1
    When I tick that note and send it
    Then a second batch is sent, the agent answers it with a second response, and the first
      response and batch are as they were
