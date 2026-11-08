Feature: Breaking a task into subtasks
  A big task is broken into subtasks that are tasks of their own, each worked by its own agent,
  in parallel where nothing waits on anything else. The person breaks it down with task lines
  inside the task, or asks the agent to with Plan first. Each subtask starts with a press, never
  by itself; each is accepted on its own; the parent's state rolls up.

  Names used below:
  - "Research", "Pricing page": assign.feature
  - subtask: a task whose "Subtask of" is the parent, listed on the parent under Subtasks
  - After: a task's relation to the tasks it waits on (many; reverse "Before")
  - Work table: on the parent's card, one row per subtask: title, agent, state, steps, latest
    report, and the row's action (task-work.feature)
  - "Start the ready ones": the button on the card while a subtask with no agent has every After
    task done; "Start" on a single row does the same for that one
  - Plan first: the switch in the Assign dialog

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Research" is linked to "~/LL QA/My Project"

  Scenario: Task lines inside a task make subtasks
    Given "Pricing page" is a Task, open, not yet assigned
    When I type "/task", Enter, "Copy", Enter, then "/task", Enter, "Layout", Enter
    Then "Copy" and "Layout" are Tasks whose "Subtask of" is "Pricing page" and whose Project is "Research"
    And "Pricing page" lists them under Subtasks, and each line has a checkbox
    And its card shows the Work table with both "Not started", and "Start the ready ones"
    And a task line written in "Research" itself, or in a page with no Project, has no Subtask of

  Scenario: Plan first
    When I press Assign on "Pricing page", turn on "Plan first" and assign it
    Then the agent is told to break the task into subtasks with its task tool, each with a title,
      a brief and what it waits on, to publish the plan with ready, and to stop; never to start them
    And when it has, the card says "Ready for review" and the Work table lists "Copy", "Layout"
      and "Launch post", each "Not started", "Launch post" with "after Copy, Layout"
    And the Feed says "“Pricing page” is ready for review"
    And the agent's task tool refuses an After naming a task that isn't a subtask of the same parent

  Scenario: Start the ready ones
    Given the plan above
    When I press "Start the ready ones"
    Then "Copy" and "Layout" each get an agent of their own, with the model, access and profile
      "Pricing page" was given, and "Launch post" stays "Not started" with "after Copy, Layout"
    And each row says "Working" as its agent goes, and the parent's card says "Working"
    And with "In its own worktree" on for "Pricing page", "Copy" works in a worktree "copy" and
      "Layout" in "layout"

  Scenario: A subtask's agent knows the whole
    When "Copy"'s agent asks the project tool what it is working on
    Then it gets "Copy", its brief, and that it is part of "Pricing page", with that page's words
    And its first prompt had "Pricing page"'s words under "This is part of"

  Scenario: Each subtask is accepted on its own; the next ones free up
    Given "Copy"'s agent published with ready, and "Layout"'s is working
    Then "Copy"'s row says "Ready for review" with Accept, and the parent's card says "Working"
    When I accept "Copy", then "Layout" when it is ready
    Then both rows say "Done", and "Start the ready ones" is back, for "Launch post"
    When I press it
    Then "Launch post" starts; nothing started by itself before the press
    And ticking Done on a subtask by hand frees what waited on it the same way

  Scenario: The parent's state rolls up
    Given "Pricing page" has no agent of its own and subtasks with agents
    Then its card shows, with the Work table, and no Assign
    And its state is "Needs your input" if any subtask needs it, else "Working" if any works, else
      "Ready for review" when every started subtask is ready or done, else "Idle"
    And with an agent of its own too, that agent's state counts the same way as a subtask's
    And its tab and sidebar row carry that state (task-work.feature)
    And Done on "Pricing page" is mine alone; accepting every subtask never ticks it

  Scenario: Starting one subtask by hand
    When I open "Launch post" and press Assign
    Then the dialog shows as for any task, and assigning it starts it, After or not

  Scenario: The agent's own subtasks stay its checklist
    When the agent working "Pricing page" (not Plan first) makes subtasks with its task tool and
      ticks them itself
    Then they show in the Work table ticked by it, with no agent of their own and no Start,
      as task-work.feature has it
