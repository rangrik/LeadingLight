Feature: Assign a page to an agent
  Any page of a project can be given to an agent with one explicit Assign. The page becomes the
  task: a page whose type has no Done is made the space's task type, keeping its id, words, links
  and history, and tagged with where it came from. Nothing else is made. The agent works in the
  project's folder, or in a worktree of its own named from the task, with the task as its brief,
  reads the project's pages, and publishes what it did on the task. An Agent page records who has
  the task and the conversation it runs in; the chat is there when wanted, never needed.
  Mentioning a page or an agent never starts work. Assigning twice, or a reload or restart while
  it starts, never starts a second agent.

  Names used below:
  - "Research": a project page linked to "~/LL QA/My Project", a git checkout
  - "Write the summary": a task (type Task) whose Project is "Research", with the brief
    "Read notes.txt and write summary.md with its main points."
  - "Pricing page": an Idea whose Project is "Research", with three paragraphs
  - Assign: the button with a robot icon in the line under the title, beside Add property
  - the dialog: "Assign “<title>”", with Agent, Profile, Access, "In its own worktree" (a switch,
    shown only for a git checkout), "Plan first" (a switch, breakdown.feature), "Becomes" (only
    when the space has more than one type with Done) and "Anything to add"
  - card: the box under a task's title (task-work.feature)

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Research" is linked to "~/LL QA/My Project"

  Scenario: Assign a task
    Given "Write the summary" is open
    When I press Assign, pick Sonnet and Approve for me, and press Assign in the dialog
    Then the dialog closes and says "Assigned to Claude: Write the summary"
    And the card shows "Claude: Write the summary" and "Working", and Assign is gone
    And Agents lists "Claude: Write the summary", whose Task is "Write the summary"
    And the agent works in "~/LL QA/My Project" and summary.md appears there
    And when it has worked, its report shows on the task under the brief

  Scenario: An idea becomes the task
    Given "Pricing page" is open
    Then the dialog says "This idea becomes a task and is given to the agent. Its words, links and
      history stay."
    When I assign it
    Then "Pricing page" is a Task with the same id, words, links and history, Done unticked,
      Project "Research" (listed on "Research" under Tasks, no longer under Ideas) and the tag
      "From idea"
    And no other page was made: Tasks lists "Pricing page" once, and nothing says "Assigned as the task"
    And its history has the type change, and the card shows its agent
    And it still shows on the day it was captured (this-day.feature)

  Scenario: Any page converts the same way
    Given "Kickoff" is a Meeting whose Project is "Research"
    When I assign it
    Then it is a Task tagged "From meeting", keeping Date and Attendees as properties of its own
    And a page that is already a task keeps its type and properties, and gets no tag

  Scenario: Which task type
    Given my space has its own type "Chore" with a Done property and a Project relation
    When I press Assign on "Pricing page"
    Then the dialog has "Becomes" with Task and Chore, Task chosen
    And with only one type with Done, there is no "Becomes"
    When I assign a Chore
    Then it works as a Task does, and the Chore keeps its type and properties

  Scenario: In its own worktree
    Given "Write the summary" is open and "~/LL QA/My Project" is a git checkout
    When I turn on "In its own worktree" and assign it
    Then the runtime has a worktree "write-summary" of "~/LL QA/My Project" on the branch
      "ll/write-summary", and the agent's conversation runs in it
    And the card says "in write-summary" after the agent's name
    And its brief names the worktree and the branch and says never to switch branches
    And summary.md appears in the worktree, not in "~/LL QA/My Project" itself

  Scenario: The worktree's name comes from the title
    Then a second task titled "Write the summary" gets "write-summary-2"
    And "Fix the 2 broken links on the pricing page, please!!" gets "fix-broken-links-pricing-page"
    And "Ümlauts & émojis 🎉" gets "umlauts-emojis"
    And "Art direction for the hero" gets "direction-hero", since the runtime keeps "art-" names
    And a title with no usable word gets "task-" and four letters
    And a name is never longer than 30 characters, and never one the runtime already has

  Scenario: No worktree for a plain folder
    Given "Notes" is a project linked to a folder that is not a git checkout
    When I press Assign on a task of "Notes"
    Then the dialog has no "In its own worktree"

  Scenario: The brief is the task as written
    When the agent asks LeadingLight's project tool what it is working on
    Then it gets the task, its brief as the task says it, and the project

  Scenario: Assigning twice starts one agent
    When I press Assign in the dialog twice quickly, or reload or quit while it starts
    Then there is one Agent page and one conversation for the task, and Assign doesn't come back
    And after a reload the card shows the same agent
    And a page converted and then assigned again (its agent gone) is not converted twice

  Scenario: The chat is there when wanted
    When I press Chat on the card
    Then the project's chat opens beside the task on that agent's conversation, titled with the task's name

  Scenario: What can't be assigned says why
    Given "Loose idea" is a page in no project with a folder
    Then it shows no Assign button
    And "Research" itself, the project page, shows no Assign: its tasks and pages are assigned, never the project
    And with projects off, no page shows Assign
    And a space with no type with Done is told to make one first
    When I pick a GPT model while Codex isn't signed in
    Then the dialog says Codex isn't on this Mac or isn't signed in

  Scenario: A mention starts nothing
    When I type "@Write the summary" in a page, or mention an agent in Ask
    Then no agent starts and no Agent page is made
