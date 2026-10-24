Feature: Assign a task to an agent
  A task, or a page of a project, can be given to an agent with one explicit Assign. The agent works
  in the project's folder with the task as its brief, reads the project's pages, and publishes
  what it did beside the task. An Agent page records who has the task and the conversation it runs
  in; the chat is there when wanted, never needed. Mentioning a page or an agent never starts work.
  Assigning twice, or a reload or restart while it starts, never starts a second agent.

  Names used below:
  - "Research": a project page linked to "~/LL QA/My Project"
  - "Write the summary": a task (type Task) whose Project is "Research", with the brief
    "Read notes.txt and write summary.md with its main points."
  - Assign: the button with a robot icon in the line under the title, beside Add property
  - work row: the line under a task's title naming its agent and how it is going, with Chat

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Research" is linked to "~/LL QA/My Project"

  Scenario: Assign a task
    Given "Write the summary" is open
    When I press Assign, keep Sonnet and Approve for me, and press Assign in the dialog
    Then the dialog closes and says "Assigned to Claude: Write the summary"
    And the work row shows "Claude: Write the summary" and "Working", and Assign is gone
    And Agents lists "Claude: Write the summary", whose Task is "Write the summary"
    And the agent works in "~/LL QA/My Project" and summary.md appears there
    And when it has worked, its report shows after the brief

  Scenario: The brief is the task as written
    When the agent asks LeadingLight's project tool what it is working on
    Then it gets the task, its brief as the task says it, and the project

  Scenario: Assigning twice starts one agent
    When I press Assign in the dialog twice quickly, or reload while it starts
    Then there is one Agent page and one conversation for the task
    And after a reload the work row shows the same agent

  Scenario: The chat is there when wanted
    When I press Chat in the work row
    Then the project's chat opens beside the task on that agent's conversation, titled with the task

  Scenario: A page of the project, through a task of its own
    Given "Brief" is a page "Research" links to
    When I press Assign on "Brief" and assign it
    Then a task "Brief" is made, linked to "Brief" and with Project "Research", and given to the agent
    And "Brief" says "Assigned as the task Brief", and Assign is gone from it
    And assigning "Brief" again finds that task rather than making another

  Scenario: My own task type
    Given my space has its own type "Chore" with a Done property and a Project relation
    When I assign a Chore
    Then it works as a Task does, and the Chore keeps its type and properties

  Scenario: What can't be assigned says why
    Given "Loose idea" is a page in no project with a folder
    Then it shows no Assign button
    And with projects off, no page shows Assign
    When I pick a GPT model while Codex isn't signed in
    Then the dialog says Codex isn't on this Mac or isn't signed in

  Scenario: A mention starts nothing
    When I type "@Write the summary" in a page, or mention an agent in Ask
    Then no agent starts and no Agent page is made
