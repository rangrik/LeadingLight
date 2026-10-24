Feature: An agent's browser
  An agent in a project uses a real headless browser that belongs to its workspace: it opens the
  workspace's own pages, clicks and reads them, and the person can watch the same tab live. The
  browser is the runtime's (Shipyard's, DECISIONS.md 18). A plain folder, not only a Git
  checkout, is a workspace of its own, so its browser works without git init, and nothing of the
  browser's is written into the person's folder.

  Names used below:
  - the probe: pnpm runtime:probe browser (features/project-runtime.feature)
  - "site folder": a plain folder holding index.html, a heading "Not pressed" and a button
    "Press me" that changes the heading to "Pressed", served on the folder's own first port

  Scenario: A plain folder is its own workspace
    Given "site folder" is not a Git repository
    When it is added to the runtime as a project folder
    Then its one workspace is the folder itself, named as the project is
    And the workspace has a block of ports from the runtime's own range, clear of the person's
      Shipyard
    And it can't be removed as a worktree, and no worktree can be made in it

  Scenario: The agent drives the folder's page while an observer watches that tab
    Given an agent in "site folder"
    When it runs berthd browser open, snapshot, and clicks "Press me"
    Then its berthd is the runtime's own, first on its PATH
    And it reports the heading "Pressed"
    And an observer reading the tab's live frames sees that same tab at the folder's address
    And the observer's own snapshot of the tab shows the heading "Pressed"

  Scenario: The browser writes nothing into the person's folder
    Given an agent used the browser in "site folder"
    Then "site folder" still holds only index.html: no .git, no .berth
    And the browser's downloads and long snapshots are in the runtime's own state
