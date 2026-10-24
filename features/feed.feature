Feature: The Feed
  The Feed lists what the project agents need from me, from every project, whichever pages are open:
  questions, approvals, work ready for review, and an agent that stopped before its work was ready.
  Each item says why in plain words, which agent and task, which project, and what it is about.
  Selecting one opens that beside it, so I answer with the material in view, and the page I was
  reading stays where it was. An answer given here is the same answer as in the agent's chat: one
  is enough, and an answered question never comes back. Routine steps never show here.

  Names used below:
  - Feed: the row under New idea in the sidebar, with how many items need me; ⇧⌘I does the same
  - lane: the Feed beside the sidebar, before the pages, with All projects or one project, and Close
  - "Write the summary": an assigned task in "Research" (features/assign.feature)
  - "Plan": a page of "Research" with the paragraph "We ship in May"

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Write the summary" is assigned to Claude, and the task's page isn't open

  Scenario: A question beside what it is about
    Given the agent says with its context tool that its question is about "We ship in May" in "Plan"
    When it asks "Should we ship in May or June?" with options May and June
    Then the Feed's count says 1, and the Feed lists "Claude: Write the summary asks: Should we ship
      in May or June?" with "Write the summary · Research"
    When I select the item
    Then "Plan" opens beside the lane, scrolled to "We ship in May", which is lit for a moment
    And the page I was reading is still open where I was
    And the item shows the question with May and June, as in the chat

  Scenario: Answered once, wherever
    Given the Feed shows the agent's question
    When I choose "June" in the Feed
    Then it says "Sent. Waiting for the agent to take it.", then the item goes
    And the agent's chat shows the question answered "June", with no card waiting
    And after a reload, or the runtime reconnecting, the question doesn't come back
    And had I answered it in the chat first, the Feed item would go without a second answer

  Scenario: A draft answer is kept
    When I type my own answer in the Feed's item and reload before sending
    Then my words are still in the item

  Scenario: An approval
    Given the task's agent works in Ask for approval
    When it wants to run a command
    Then the Feed says "Claude: Write the summary wants to run a command" and shows the command
    And Allow once there lets it run

  Scenario: Ready for review
    When the agent publishes its report with ready
    Then the Feed lists "“Write the summary” is ready for review", opening the report beside the lane
    And "Later" takes it off the Feed until a newer report

  Scenario: Evidence at its moment
    Given the agent's question is about its video evidence at 0:42
    When I select the item
    Then the report opens beside the lane at the video, set to 0:42

  Scenario: One project at a time
    Given agents in "Research" and "Garden" each ask something
    When I choose "Garden" in the lane's project menu
    Then only Garden's question is listed; All projects lists both

  Scenario: The keyboard
    When I press ⇧⌘I, move with ↓ and ↑, and press Enter on an item
    Then the lane opens, the focus moves through the items, and Enter opens the item

  Scenario: A narrow window
    Given the window leaves no room for the lane beside a page
    When I press Feed
    Then the Feed opens as a pane beside the page, as any page does
    And selecting what an item is about shows it in that pane, its crumb leading back to the Feed

  Scenario: An agent that asks in its own words
    Given a Codex agent outside Plan mode, which has no question tool
    When it says what its question is about, asks in its reply and stops
    Then the Feed lists "Codex asks: …" with its words, and what it said the question is about
    When I type "Average" in the item's reply and press Send
    Then the agent gets it as a message in its chat and carries on, and the item goes

  Scenario: An agent with no context
    When an agent asks a question without saying what it is about
    Then its item says it didn't say, and its task opens beside the lane

  Scenario: Quiet work stays out
    When the agent reads pages, runs commands it may, updates its checklist and makes subtasks
    Then nothing is added to the Feed
