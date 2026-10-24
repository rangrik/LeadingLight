Feature: Following an assigned task
  An assigned task shows its work as it happens, on the task itself: how it is going, what the agent
  is doing now, its checklist of concrete steps, the subtasks it made, the workers it started, and the
  evidence it has published so far. How it is going comes from the runtime; what the agent is doing
  and its checklist come from the agent, and can change in place. Nothing here moves the words being
  read. The agent ticks off only subtasks it made; only the person marks the task done.

  Names used below:
  - "Write the summary": an assigned task, as in features/assign.feature
  - work panel: the box under the task's title: its state, the agent's current step, the checklist,
    workers and evidence
  - states: Working, Needs your input, Ready for review, Idle (its turn ended, nothing to review),
    Stopped (its agent process ended), Done (I accepted it)

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Write the summary" is assigned to Claude

  Scenario: What the agent is doing now
    When the agent says with its status tool "Reading notes.txt", with steps "Read notes", "Write summary"
    Then the work panel says "Working", "Reading notes.txt", and "0 of 2 steps"
    When it ticks "Read notes"
    Then it says "1 of 2 steps", in place
    And with no checklist from the agent, the panel shows no count and no percentage

  Scenario: Subtasks
    When the agent makes subtasks "Outline" and "Draft" with its task tool and ticks "Outline" done
    Then they are Tasks whose "Subtask of" is "Write the summary", listed on it as Subtasks
    And the checklist shows "Outline" ticked and "Draft" not
    When the agent tries to tick "Write the summary" itself, or a task I made
    Then it is refused, saying only I mark it done, and Done stays unticked

  Scenario: Workers
    When the agent starts a worker to review summary.md
    Then the panel lists the worker under the agent with "Working", then how it ended
    And the worker has an Agent page "Started by" the agent, kept after its session is gone

  Scenario: Stop and carry on
    When I press Stop in the panel while it works
    Then the agent stops and the panel says so
    When I press Continue
    Then the agent carries on with the task, and the panel says "Working"

  Scenario: Reading isn't moved by updates
    Given I have scrolled down to read the report under the task
    When the agent's checklist gains three steps
    Then the words I am reading stay where they are on screen

  Scenario: Reports stay as published
    When the agent updates its checklist after publishing a report
    Then the report is as it was; only the panel changed

  Scenario: Widgets are explained in Settings
    When I open Settings › Objects
    Then "On a task and in the Feed" lists Activity, Checklist and Evidence, each with who
      makes it and what can change
