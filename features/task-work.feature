Feature: Following an assigned task
  An assigned task shows its work as it happens, on the task itself: how it is going, what the agent
  is doing now, its checklist of concrete steps, the subtasks with their own state, the workers it
  started, the evidence it has published so far, and the one press that is wanted next. How it is
  going comes from the runtime; what the agent is doing and its checklist come from the agent, and
  change in place. The task's state also shows on its tab and its sidebar row, so nothing has to be
  opened to know. Nothing here moves the words being read. The agent ticks off only subtasks it
  made; only the person marks the task done.

  Names used below:
  - "Write the summary": an assigned task, as in features/assign.feature
  - card: the box under the task's title: its state, the agent's current step, the steps, the Work
    table (breakdown.feature) when it has subtasks, workers, evidence, and the actions
  - actions: Stop, Continue, Chat, Accept, "Send n notes" (feedback.feature) and "Start the ready
    ones" (breakdown.feature), each shown only when it applies
  - primary: the one filled button on the card; the rest are plain buttons or in the ⋯ menu
  - ⋯ menu: the small button at the end of the card's first row, holding Chat, Stop, and Continue
    when it applies but isn't the primary
  - states: Working, Needs your input, Ready for review, Idle (its turn ended, nothing to review),
    Stopped (its agent process ended), Done (I accepted it)
  - state dot: a 6 px dot before the title on the task's tab and its sidebar row: info colour
    while Working, warning for Needs your input, success for Ready for review, none otherwise,
    with a tooltip naming the state

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Write the summary" is assigned to Claude

  Scenario: What the agent is doing now
    When the agent says with its status tool "Reading notes.txt", with steps "Read notes", "Write summary"
    Then the card says "Working", "Reading notes.txt", and "0 of 2 steps"
    When it ticks "Read notes"
    Then it says "1 of 2 steps", in place
    And with no checklist from the agent, the card shows no count and no percentage

  Scenario: The state on the tab and in the sidebar
    Given "Write the summary" is open in a tab and listed in the sidebar
    Then both carry the state dot, info colour, "Working" on hover
    When the agent asks a question
    Then both dots turn warning, and the Feed's count goes up by one
    When it publishes with ready
    Then both dots turn success
    When I accept it
    Then the dots go
    And a task with no agent, and every other page, has no dot

  Scenario: Subtasks
    When the agent makes subtasks "Outline" and "Draft" with its task tool and ticks "Outline" done
    Then they are Tasks whose "Subtask of" is "Write the summary", listed on it under Subtasks
    And the Work table shows "Outline" ticked and "Draft" not, each with no agent and no Start
    When the agent tries to tick "Write the summary" itself, or a task I made
    Then it is refused, saying only I mark it done, and Done stays unticked

  Scenario: Workers
    When the agent starts a worker to review summary.md
    Then the card lists the worker under the agent with "Working", then how it ended
    And the worker has an Agent page "Started by" the agent, kept after its session is gone

  Scenario: Stop and carry on
    When I choose Stop from the card's ⋯ menu while it works
    Then the agent stops and the card says "Idle", with Continue
    When I press Continue
    Then the agent carries on with the task, and the card says "Working"

  Scenario: The latest report, then the older ones
    Given the agent published "Summary, first draft" and later "Summary, second draft"
    Then under the task's own words, "Summary, second draft" shows in full, newest first
    And "Summary, first draft" is folded to its byline and title, opened with a click, and the
      card's review line names the newest

  Scenario: Following work in a narrow split pane
    Given the task is ready for review beside another page
    When I make its pane narrow, including with Large interface text
    Then the agent name remains visible and the state wraps to fit
    And the state never overlaps the ⋯ button, and Accept and the ⋯ menu's Chat remain reachable
    When I accept its report
    Then the card says "Done"

  Scenario: Reading isn't moved by updates
    Given I have scrolled down to read the report under the task
    When the agent's checklist gains three steps, or a subtask's row changes
    Then the words I am reading stay where they are on screen

  Scenario: Reports stay as published
    When the agent updates its checklist after publishing a report
    Then the report is as it was; only the card changed

  Scenario: The question is answered on the card
    When the agent asks "Should the summary lead with the numbers?" with options "Yes" and "No"
    Then the card says "Needs your input" and, under what the agent is doing, shows the question
      with both options and "Or type your own answer", as the Feed's item does
    And the card has no filled button: the answer is the primary
    When I pick "Yes" on the card
    Then the question goes from the card, and the Feed's item for it goes too
    And answering the same question in the Feed instead takes it off the card; it is sent once
    When the runtime refuses an answer
    Then the card says "Not sent" with the reason and Try again, and the question stays on the card

  Scenario: An approval is answered on the card
    When the agent asks to run "pnpm qa"
    Then the card shows "The agent wants to run a command", the command, "Allow once", "Always allow
      in this chat" and "Decline"
    When I choose "Allow once"
    Then it goes from the card and from the Feed

  Scenario: What changed since the agent's last report
    Given the agent published "Summary, first draft" and later "Summary, second draft"
    And 4 of the second draft's top-level blocks have words the first draft has nowhere
    Then the card's review line names "Summary, second draft", then a muted "· 4 paragraphs changed"
    When I click "4 paragraphs changed"
    Then the page scrolls to the first of the 4 in the report under the task's words
    And each of the 4 has a 2 px bar in the info colour at its left, which fades after two seconds
    And the report's words and notes are as they were
    And the line shows while the agent works or waits on me too, not only when it is ready
    And with no earlier report by the same agent, or no block changed, the line has no "changed"

  Scenario: One primary action at a time
    Then the card has at most one filled button, chosen in this order:
      | when                                                           | primary                |
      | a question or an approval waits                                | the answer on the card |
      | Ready for review, or at rest with a report; no open subtasks   | Accept                 |
      | Idle or Stopped, nothing to accept                             | Continue               |
      | notes are ticked                                               | Send n notes           |
      | Working with nothing ticked                                    | none                   |
    And with notes ticked while another is primary, "Send n notes" stays on the card, not filled
    And with Accept the primary on an Idle task, Continue is in the ⋯ menu

  Scenario: Chat and Stop live in the ⋯ menu
    Given the agent works in the worktree "summary"
    Then the card's first row shows the agent's name, "in summary", "Working" and the ⋯ button
    And no Chat or Stop button of its own
    When I open the ⋯ menu
    Then it offers Chat and Stop
    When I choose Chat
    Then the agent's chat opens, as the Chat button did
    When the agent is Idle
    Then the ⋯ menu offers Chat, and Continue when Accept is the primary, but not Stop
    And a task whose agent has no conversation yet shows no ⋯ button

  Scenario: Widgets are explained in Settings
    When I open Settings › Objects
    Then "On a task and in the Feed" lists Activity, Checklist, Work table and Evidence, each with
      who makes it and what can change
