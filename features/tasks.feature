Feature: Tasks
  A task is a to-do that is a page of its own, so it can be listed with every other task, given
  a due date and a project, and found from anywhere. It is the starter type Task, plain data like
  the other starter types. Wherever a task is linked on its own line, the line has a checkbox, so
  it is ticked off in the page where it was written.

  Names used below:
  - Task: the starter type "Task" / "Tasks" (icon circle-check, green) with the properties
    "Done" (checkbox), "Due" (date), "Project" (one Project page, listed on the project as
    "Tasks") and "Tags". Its cards show Due and Project.
  - task line: a link to a task on its own line, in the Line view: a checkbox where the icon
    would be, then the title. Any page whose type has the property "Done" gets one.
  - checkbox: the same 16 px box as a to-do item in the editor, centred on the title's line
  - a new space: no stored data. An older space: one saved by a build before tasks.

  Background:
    Given the app is open in a browser at 1280x800 with no stored data

  Scenario: Tasks are a starter type
    Then the sidebar's Types list "Tasks" after "Projects"
    When I click "Tasks"
    Then the pane shows "Tasks", "New task" and "No tasks yet"

  Scenario: An older space gets tasks once
    Given an older space with the starter types and no Task type
    When the app loads
    Then "Tasks" is listed under Types, and the Idea type has the properties Project, Tags,
      Created and Updated (capture.feature)
    When I delete the Task type in its settings and reload
    Then it does not come back

  Scenario: A task page
    When I click "Tasks", then "New task", and title it "Call the plumber"
    Then its property rows are Done (unticked), Due, Project and Tags, in that order
    And the Tasks view lists it
    And it is not listed under Pages in the sidebar; tasks live in Tasks

  Scenario: Ticking a task off where it is written
    Given the page "Home" has a task line for "Call the plumber"
    When I click its checkbox
    Then the box is ticked and the title is muted and struck through, as a checked to-do is
    And the page "Call the plumber" shows Done ticked
    When I reload
    Then the line is still ticked
    When I click the checkbox again
    Then it is unticked, and so is Done

  Scenario: The checkbox and the title do different things
    Given "Home" has a task line for "Call the plumber"
    When I click the checkbox
    Then the task does not open, and the page in view is still "Home"
    When I click the title
    Then the task opens, as any line link does; Shift-click opens it beside

  Scenario: Ticking Done on the task shows in the line
    Given "Home" has a task line for "Call the plumber" and the task is open beside it
    When I tick "Done" on the task's page
    Then the line in "Home" is ticked at once, with no reload

  Scenario: Inline links and cards have no checkbox
    Given "Home" has the sentence "Ask @Call the plumber today" and the task linked as a small card
    Then the inline link shows the task's icon and title, and the card shows its icon, with no checkbox

  Scenario: Any type with Done gets the checkbox
    Given the Project type is given the property "Done" in its settings
    Then a project linked on its own line shows a checkbox too

  Scenario: A project lists its tasks
    Given the task "Call the plumber" has the Project "House"
    When I open "House"
    Then "Linked tasks · 1" at its end shows a small card for "Call the plumber"
    And Settings › Writing suggests the writing tools off for Tasks, as for other records

  Scenario: A task line stays aligned
    Given "Home" has a to-do item "Buy milk" and below it a task line "Call the plumber"
    Then both checkboxes are the same size and sit at the same left edge, each centred on its
      title's line, and the two titles start at the same x
