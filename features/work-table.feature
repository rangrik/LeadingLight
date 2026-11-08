Feature: The Work table on a project
  A project page opens with what is being worked on: one row per task of the project that has an
  agent or started subtasks, with its state, steps, latest report and the one press it wants, so
  nothing has to be opened to know where things stand. The same table shows a task's subtasks on
  its card (breakdown.feature).

  Names used below:
  - "Research": a project page linked to a folder (assign.feature)
  - Work: the section under a project page's properties, before its words: "Work · 2 in flight"
  - row: the task's icon and title, its agent, state, steps "2 of 5", latest report (title · when),
    and its action
  - action: Answer (a question waits; it opens the Feed on it), Accept (ready for review),
    Continue (idle or stopped), Start (a subtask whose After tasks are done), nothing while working
  - done: rows accepted or ticked Done, folded under "3 done" at the table's end

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Research" is linked to "~/LL QA/My Project"

  Scenario: Rows for what is in flight
    Given "Research" has tasks "Write the summary" (working, 2 of 5 steps, report "Draft"),
      "Pricing page" (ready for review), "Old chore" (accepted) and "Someday" (no agent)
    When I open "Research"
    Then Work lists "Pricing page" first, then "Write the summary", each with agent, state, steps
      and latest report
    And "Old chore" is under "1 done", opened with a click
    And "Someday" is not in Work; it is still in "Linked tasks" at the end, as before
    And with no task in flight and none done, there is no Work section

  Scenario: Order
    Then rows that need me come first (Needs your input, then Ready for review), then Working,
      then Idle and Stopped, each group most recent first; then Not started, oldest first, so a plan
      reads in the order it was made

  Scenario: Acting from the row
    When I press Accept on "Pricing page"'s row
    Then it is accepted, as from its card, and moves under done
    When an agent asks a question
    Then its row says "Needs your input" with the question's first words, and Answer opens the Feed on it
    When I press Continue on an idle row
    Then its agent carries on, and the row says "Working"

  Scenario: Live, and still
    When an agent's state, step or report changes
    Then its row changes in place, without the page scrolling or the words below moving

  Scenario: A row opens the task
    When I click a row's title
    Then the task opens, as a link does; Shift-click opens it beside
    When I click the latest report's title
    Then the task opens with that report in view

  Scenario: A task with subtasks
    Given "Pricing page" has subtasks with agents
    Then its row's state is the rolled-up one (breakdown.feature), and its steps count the subtasks
      done of all, "1 of 3"
    And the subtasks are not rows of their own in the project's Work; they are on "Pricing page"'s card

  Scenario: Narrow panes
    When the Work table itself is narrower than 720 px
    Then each row keeps its title and action on the first line, and puts agent, state, steps and
      latest report under it; nothing sticks out of the pane
