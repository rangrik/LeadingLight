Feature: The Work view of a project
  Inside a project on the rail, Work is one place for the developer side of it: the tasks in
  flight, then every worktree of the project's folder as the runtime sees it, whoever made it.
  One "New work" box starts work: what to do, where, and who. With an agent it makes a task and
  assigns it as Assign does (assign.feature); with none it only makes a worktree. This is the first
  slice (docs/PROJECT-6.md, 2); what it leaves out is in docs/DEFERRED.md.

  Names used below:
  - the demo: the browser build opened at "/?mac&demo" in an empty space; its project "LeadingLight"
    is linked to "/Users/you/work/LeadingLight", a git checkout, and "Home office" has no folder
  - Work row: the sidebar row "Work" under "Chat", a branch icon, shown when the project chosen on
    the rail has a linked folder
  - Work view: the pane "Work", crumbed under its project, with the title "Work", a "New work"
    button, then the sections "In flight" and "Worktrees"
  - worktree row: its name, its branch, who is in it and how they are, and what changed; then its
    actions. Where the tables are 900 px or wider (a 1376 px window with the sidebar open) these
    are columns, the branch beside the name in grey and cut short before the name is. The first
    row is the folder's own checkout, named after the folder
  - who: the agents with a live session in that folder: "Claude", "Codex", "3 agents", or "No agent"
  - how: "Needs your input" if one of them waits on a question, else "Working" if one is in a
    turn, else "Idle"
  - changed: files changed or new and not committed, "4 files changed", "1 file changed" or
    "No changes"; commits its branch has that its base lacks follow as "3 commits"
  - the box: the dialog "New work" with "What to do" (a text area), "Where" ("This checkout" or
    "New worktree"), "Agent" (Claude's models, Codex's models, or "No agent") and "Effort"
  - the demo's worktrees: "LeadingLight" (main, 3 agents, Working, 1 file changed), "pricing-copy"
    (ll/pricing-copy, Claude, Needs your input, 4 files changed), "sync-spike" (ll/sync-spike,
    No agent, 2 files changed) and "old-search" (ll/old-search, No agent, No changes, 3 commits)

  Background:
    Given the app is open in a browser at 1280x800 with the demo
    And "LeadingLight" is chosen on the rail

  # Getting there

  Scenario: Work is a row of the project's sidebar
    Then the sidebar starts with "Overview", "Chat" and "Work", then Today
    When I click "Work"
    Then the Work view opens, its crumb reads "LeadingLight", and the Work row is marked current
    And Shift-click on "Work" opens it beside the page in front

  Scenario: A project with no linked folder has no Work row
    When I click "Home office" on the rail
    Then the sidebar has "Overview" and neither "Chat" nor "Work"
    When I press ⇧⌘N
    Then no box opens, and a toast reads "New work needs a project with a linked folder. Choose
      one on the rail."
    And the same toast shows with "All" chosen

  # What it shows

  Scenario: Tasks in flight
    When I open the Work view
    Then "In flight · 3" lists "Write the pricing page copy" (Needs your input), "Audit the empty
      states" (Ready for review) and "Fix the tab row overflow" (Working), with "1 done" folded
      under them: the same rows, order and actions as Work on the project page (work-table.feature)
    And with no task in flight the section reads "Nothing in flight."

  Scenario: Every worktree of the folder
    When I open the Work view
    Then "Worktrees · 4" lists the demo's worktrees in the runtime's order, the checkout first
    And "pricing-copy" reads "ll/pricing-copy", "Claude · Needs your input", "4 files changed"
    And "old-search" reads "ll/old-search", "No agent", "No changes · 3 commits"
    And the checkout reads "main", "3 agents · Working", "1 file changed"
    And a worktree with no branch checked out reads "detached"
    And no row has a dot or a colour: the state is words

  Scenario: The list keeps up
    Given the Work view is open
    When the pricing agent's question is answered
    Then "pricing-copy" reads "Claude · Working" without a reload
    When a worktree is made or removed outside the app and the runtime says so
    Then the list shows it

  Scenario: A worktree's task
    When I click "Open task" on "pricing-copy"
    Then "Write the pricing page copy" opens, as a link does; Shift-click opens it beside
    And "sync-spike", made with no agent, and the checkout have no "Open task"

  Scenario: Narrow panes
    When the Work view's tables are narrower than 900 px, as in a 1280 px window with the sidebar open
    Then each worktree row keeps its name and actions on the first line, and puts branch, who and
      changed under it; nothing sticks out of the pane

  # When it can't

  Scenario: The runtime doesn't answer
    Given the project runtime is not running and won't start
    When I open the Work view
    Then "In flight" still lists the tasks, from the notes
    And under "Worktrees" it reads "The worktrees can't be listed: " and the runtime's reason, with
      a "Try again" button
    When the runtime is back and I press "Try again"
    Then the worktrees are listed
    And when I open New work it first reads whether the folder is a git checkout: until it knows, it
      says "Checking the folder…" and Start waits; it never starts an agent in the checkout itself
      because the first read failed
    And if the runtime still doesn't answer, the box says "The project runtime isn't answering. Close
      this and try again in a moment."

  Scenario: A folder that is not a git checkout
    Given "Research" is linked to "~/LL QA/Notes", a plain folder
    When I open its Work view
    Then under "Worktrees" it reads "This folder isn't a git checkout, so it has no worktrees."
    And the box has no "Where": work happens in the folder

  # New work

  Scenario: Opening the box
    When I press "New work" in the Work view
    Then the box opens, saying "For LeadingLight, in the folder LeadingLight.", with the cursor in
      "What to do", "Where" on "New worktree", "Agent" on the model of Settings › AI ("Opus") and
      "Effort" on its effort ("Medium")
    And under "Where" it reads "Named from what you write."
    And its button reads "Start" and is disabled until something is written
    When I press Escape and then ⇧⌘N, from any page of the project
    Then the box opens the same
    And File › New work… in the Mac menu bar opens it too
    And Settings › Shortcuts and the Keyboard shortcuts sheet list "New work" under File with ⇧⌘N
    And while the box is open, the keys for what is behind it do nothing: ⌘1–9 keep the project,
      and ⌘K, ⌘N, ⌘J, ⌘, and the Inbox's keys open nothing over or under it

  Scenario: An agent in a new worktree
    Given the box is open
    When I write "Add a dark mode toggle to the settings page" and a second line "Keep the system
      choice as the default."
    Then under "Where" it reads "On a new branch, ll/add-dark-mode-toggle-settings", on one line
    When I press "Start"
    Then a task "Add a dark mode toggle to the settings page" exists with Project "LeadingLight",
      and its words are the second line
    And a first line longer than 80 characters is cut at a word for the title, with "…", and the
      task's words are then everything written
    And it is assigned as Assign does: an Agent page "Claude: Add a dark mode toggle to the
      settings page", a session in the worktree "add-dark-mode-toggle-settings" with Opus at
      Medium and the access of Settings › AI, the task as its brief
    And the box closes, a toast reads "Started “Add a dark mode toggle to the settings page”", and
      no pane opens or moves
    And in the Work view the task is in "In flight" and the worktree in "Worktrees", with
      "Open task"
    And ⌘↩ in "What to do" does what "Start" does

  Scenario: An agent in this checkout
    Given the box is open
    When I write "Tidy the README", choose "This checkout" and press "Start"
    Then the task is made and its agent's session is in the project's folder; no worktree is made

  Scenario: Codex, with its model and effort
    Given the box is open
    When I choose "GPT-6.1-Sol" under Codex in "Agent"
    Then "Effort" offers that model's efforts and keeps "Medium", which the model has
    And an effort the chosen model lacks becomes one it has, as in the chat's composer: "Ultra"
      becomes "Max" for a Claude model, and a Codex model's own for a Codex one
    And "Start" starts a Codex session
    And with Codex missing or signed out, a Codex model can't start and the box says "Codex isn't
      on this Mac or isn't signed in."

  Scenario: No agent makes a bare worktree
    Given the box is open
    When I write "Try the new sync library" and choose "No agent"
    Then "Effort" is gone and the button reads "Make worktree"
    When I press it
    Then the runtime has a worktree "try-new-sync-library" on the branch "ll/try-new-sync-library"
    And no task, Agent page or session is made
    And the box closes, a toast reads "Made the worktree try-new-sync-library", and its row reads
      "No agent", "No changes"

  Scenario: No agent and no worktree is nothing to make
    Given the box is open
    When I choose "No agent" and "This checkout"
    Then the button is disabled and under "Where" it reads "Choose an agent or a new worktree."

  Scenario: A worktree name that already exists
    Given the box is open
    When I write "Pricing copy"
    Then under "Where" it reads "On a new branch, ll/pricing-copy-2", because "pricing-copy" is
      taken
    When I press "Start"
    Then the runtime is asked for "pricing-copy-2"
    And should the runtime say that one exists too (made since the list was read), the next
      number is tried, up to five times, and only then does the box show the runtime's words

  Scenario: The runtime refuses a start
    Given the box is open and the runtime will refuse to make a worktree
    When I write "Fix the footer" and press "Start"
    Then the box stays open with what I wrote, and shows the runtime's reason under it
    And no task named "Fix the footer" is left behind
    And "Start" pressed again, or ⌘↩, tries again
    When the runtime only fails to start the agent, after the worktree and the task are made
    Then the box closes and a toast reads "“Fix the footer” was made, but its agent didn't start."
      with the reason and, on a line of its own, "Open the task to try again."; opening the task
      starts it

  # Removing a worktree

  Scenario: Removing a clean worktree
    When I press "Remove" on "old-search"
    Then a dialog asks "Remove old-search?" and says "Its folder is deleted. The branch
      ll/old-search and its commits stay."
    When I press "Cancel"
    Then nothing changed
    When I press "Remove" on it again and confirm with "Remove"
    Then the runtime removes the worktree without force, the dialog closes and the row is gone

  Scenario: Refused while an agent is working in it
    When I press "Remove" on "pricing-copy"
    Then the dialog reads "pricing-copy is in use" and "Claude is at work in it. Stop it, or wait
      until it is done." with one button, "OK", and the runtime is not asked
    And an agent that started working after the list was read is caught the same way at "Remove"
    And with the agent idle the dialog asks, and adds "Claude's session there ends."

  Scenario: Uncommitted changes
    When I press "Remove" on "sync-spike" and confirm with "Remove"
    Then the runtime refuses, nothing is removed, and the dialog reads "sync-spike has files that
      aren't committed. Removing it deletes them." with "Cancel" and "Remove anyway"
    When I press "Remove anyway"
    Then the runtime removes it with force and the row is gone

  Scenario: What can't be removed here
    Then the checkout's row has no "Remove"
    And two worktrees the runtime gives one name (made by other tools in folders named alike)
      have no "Remove" either, since the runtime removes by name
    And a task whose worktree was removed keeps its page and reports
