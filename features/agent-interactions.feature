Feature: An agent's questions and approvals
  When the agent in a project chat asks something (a question with options, several questions, a
  permission to use a tool, a plan to start), the chat shows it where the composer was, and the
  answer goes to that one request exactly once. A request is named by the agent process that
  asked it and the agent's own id for it; the runtime keeps each answer's command id, so a second
  click, a retry after a lost reply or a reload never answers twice, and an answer is never sent
  to a request of a later process. The card says where the answer is: sending, sent and waiting
  for the agent, answered, or that it can't be answered now and why. Answers you typed are never
  lost.

  Names used below:
  - "Research": a page linked to a folder, with its project chat open (features/project-chat.feature)
  - the runtime's requests: GET /v1/sessions/<session>/requests (runtime 0.3.30-ll.6)
  - the probe: pnpm runtime:probe requests

  # The runtime (slice 4a)

  Scenario: Each request is named once and answered once
    When the probe has Claude ask a single-choice question
    Then the runtime lists it pending, named by its process and Claude's own id
    When the same answer is sent twice at once with one command id
    Then both replies carry the same receipt and Claude got one answer
    When an answer with another command id follows
    Then it is refused, and the question shows answered with the first answer

  Scenario: What an ended process asked can't be answered
    Given Claude asked a question and its process is stopped before an answer
    When the conversation is resumed and an answer is sent to that question's id
    Then it is refused as cancelled or expired
    And nothing reaches the resumed agent

  Scenario: Answers survive the ways they can go wrong
    Given the seam tests in apps/desktop/src/lib/project-runtime/requests.test.ts
    Then two sends at once answer once
    And a reply lost after the runtime took the answer is reconciled as sent, with nothing more written
    And a reply lost before the runtime had it is sent again with the same command, once
    And another window's answer shows as answered elsewhere
    And an answer to an expired request comes back as words for the composer
    And a later, staler read never brings an answered question back

  # The chat (slice 4b)

  Scenario: A single-choice question
    Given access is Ask for approval
    When I send "Ask me with AskUserQuestion whether I prefer tea or coffee, then write my answer to drink.txt"
    Then a card shows "Do you prefer tea or coffee?" (in the agent's words) with Tea and Coffee, numbered 1 and 2
    When I press 2
    Then the card says "Sent. Waiting for the agent to take it." and then the question shows answered "Coffee"
    And the agent goes on: it asks to write drink.txt

  Scenario: A multiple-choice question and my own words
    When the agent asks one question that takes several answers, and a second question
    Then the first says "Choose one or more." and Next waits until something is chosen
    When I choose two options, press Next, and type my own answer to the second, then Send
    Then the agent gets both options for the first and my words for the second

  Scenario: An approval, allowed and declined
    When the agent asks to write hello.txt
    Then a card shows the file's path with "Allow once", "Always allow in this chat" and "Decline"
    When I press Allow once
    Then hello.txt is written
    When it asks again for another file and I press Decline
    Then the file isn't written and the agent goes on without it

  Scenario: A click and Enter together, and a double click
    Given a question card in front
    When I press an option and Enter at the same moment, or double-click an option
    Then the agent gets one answer

  Scenario: Reload while an answer is on its way
    Given I chose an answer and the page reloads before the agent took it
    Then the card comes back with my answer and its state, and nothing is sent twice

  Scenario: The agent's process ends before I answer
    Given a question card in front and part of an answer typed
    When the agent's session is stopped, or its process ends
    Then the card goes, and my words are back in the composer with a line saying why

  Scenario: The keys stay with the card
    Given a card with two questions in front
    When I answer the first and press Next
    Then the number keys pick on the second question without clicking it first
