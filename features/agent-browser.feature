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

  # Watching it from the project chat (slice 8a)

  Scenario: Watch the agent's tab live
    Given "Research" is linked to "site folder", and its chat is open
    When I ask the agent to serve the folder on its own port, open its page and press "Press me"
    Then the chat's header shows Browser while the workspace's browser runs
    When I press Browser
    Then a view beside the chat shows that tab live: the page at its address, and the heading
      turning to "Pressed" as the agent clicks
    And its address is on the workspace's own port, the one the runtime gave this folder

  Scenario: The view stays live on a still page
    Given the view shows the agent's tab, and the page hasn't changed for two minutes
    When the agent presses "Press me"
    Then the view shows "Pressed" within a few seconds
    And a second view of the same tab, opened and closed, leaves this one live

  Scenario: A wide page at its own size
    Given the view is narrower than the page
    When I press the page to see it at its own size
    Then it starts at its left edge, and I can scroll across the rest

  Scenario: What the agent saw is what the view shows
    Given the agent took a screenshot and read the console of its tab
    Then the view shows the same tab, and its Console lists the same messages

  Scenario: Several tabs
    Given the agent opened a second tab
    Then the view lets me choose which tab to watch, and shows the one I choose

  # Public pages, several agents, a lost browser (slice 8b)

  Scenario: Each agent its own tab
    Given two chats in "Research" both open the folder's page
    Then each has a tab of its own, with its own page, refs and cookies
    And each chat's Browser view opens on its own agent's tab

  Scenario: A public page, once allowed
    When the agent's browser is kept from opening "example.com"
    Then the view says so, with Allow
    When I press Allow
    Then the agent can open https://example.com, and the page loads in its tab
    And no view of this workspace still offers Allow for it
    And the notice reads in full in a narrow view, and the bar above wraps rather than cutting off

  Scenario: The browser goes away
    Given the view shows the agent's tab
    When the browser closes (it was idle, or it crashed)
    Then the view says the browser closed, not a frozen picture
    And when the agent opens a page again, the view shows it again

  Scenario: No browser
    Given the agent hasn't opened a browser in this workspace
    Then the header shows no Browser button
