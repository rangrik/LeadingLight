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
    When I press Stop on the card while it works
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
    And the state never overlaps Chat, and Chat and Accept remain reachable
    When I accept its report
    Then the card says "Done"

  Scenario: Reading isn't moved by updates
    Given I have scrolled down to read the report under the task
    When the agent's checklist gains three steps, or a subtask's row changes
    Then the words I am reading stay where they are on screen

  Scenario: Reports stay as published
    When the agent updates its checklist after publishing a report
    Then the report is as it was; only the card changed

  Scenario: Widgets are explained in Settings
    When I open Settings › Objects
    Then "On a task and in the Feed" lists Activity, Checklist, Work table and Evidence, each with
      who makes it and what can change
