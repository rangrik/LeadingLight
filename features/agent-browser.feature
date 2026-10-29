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
    And two differently sized views of a personal tab do not keep resizing each other's page
    And the last browser pane I used controls its automatic viewport size
    And all views pause page input until queued size changes finish and their frames match

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

  Scenario: Open the browser before an agent does
    Given a page has a linked folder
    When I open its chat and press Browser
    Then the browser opens beside the chat with an address field and New tab
    And no website is opened until I enter an address

  Scenario: Browse without a linked folder
    Given no page has a linked folder
    When I press Browser in the sidebar
    Then the browser opens beside my notes
    And its profile, downloads and workspace stay in the app's own runtime folder

  Scenario: Choose an upload by hand
    Given I press a file field in a page
    Then the browser asks me to choose files for that page
    When I choose a file
    Then only that file is uploaded to that page
    And cancelling does not upload anything
    When the page navigates or asks for a different file before my choice arrives
    Then that old choice is rejected instead of uploading to the new request

  # Shared browsing: the person and the agent use the same Chromium page.

  Scenario: Navigate by address or search
    Given the browser is open
    And a delayed initial tab list never replaces an address I am typing
    When I enter "localhost:1420" in Address and press Enter
    Then a tab opens at "http://localhost:1420/"
    When I enter words instead of an address and press Enter
    Then the browser opens a DuckDuckGo search for those words
    And a refused public site offers Allow with its hostname before it loads
    And javascript, data, file and credential-bearing URLs are refused

  Scenario: Browse a page by hand
    Given "site folder" is open in a browser tab
    When I click "Press me" in the live page
    Then the live page and the agent's snapshot both show "Pressed"
    When I focus the page's text field and type, paste, select and delete text
    Then the field contains exactly the text I entered
    And scrolling, dragging and keyboard navigation affect that same page
    And fitting a large page to a narrow pane keeps clicks aligned with its controls

  Scenario: Browser navigation follows the page
    Given a tab has visited two pages
    When I press Back and Forward
    Then each restores the matching page and its address
    When I follow a link in the page
    Then the address and title follow the resulting page
    And Reload reloads this tab and Stop stops its current load
    And a failed navigation shows an error and leaves the controls usable

  Scenario: A slow page stays cancellable
    Given a page takes eight seconds to answer
    When I open it by address or follow a link to it
    Then Stop remains available while it is loading, even after five seconds
    And waiting does not show a request-timeout error
    When I press Stop
    Then the load stops and this tab remains usable

  Scenario: Several personal tabs and an agent tab
    Given a chat's agent has a tab open
    When I create two personal tabs and switch between them
    Then each keeps its page and the agent's tab stays open
    And the agent's tab is labelled separately from my tabs
    When I close a personal tab
    Then only that tab closes
    When I reopen the last closed tab
    Then its address opens in a personal tab
    And closing the last personal tab shows a new-tab view
    When I Command-click or middle-click a link in a personal tab
    Then its destination opens in another personal tab without closing the original

  Scenario: Pick the page the agent should work on
    Given I have opened a personal tab
    When I press Ask about page
    Then its chat opens with that tab attached above the composer
    And my next message names that exact tab for the agent
    And I can remove the attachment before sending
    And switching to an unrelated chat does not share the tab with it
    When I copy its agent instructions
    Then they identify this workspace and the exact tab name
    And the agent can snapshot and operate that same tab through its existing browser tools
    And another chat does not silently become the selected agent tab

  Scenario: Keep personal browsing across restarts
    Given I have personal tabs open and a site has set a cookie
    When the runtime and app restart
    Then the browser can restore those personal tabs
    And the personal profile keeps that site's cookie
    And agent tabs keep their separate cookie contexts
    And no browser state is written in the linked folder

  Scenario: Find, zoom and viewport
    Given a page contains the word "Pressed" twice
    When I open Find in page and enter "Pressed"
    Then Next and Previous move to matching text and no match is reported plainly
    When I change Zoom and then reset it
    Then the page changes size and returns to 100 percent
    When I choose a phone viewport
    Then both the live page and the agent see the phone layout

  Scenario: Bookmarks and history
    Given I have visited a page
    When I bookmark it
    Then it appears in Bookmarks after the app reloads
    And History records its title and address
    When I open a bookmark or history entry
    Then it opens in the selected personal tab
    And removing a bookmark or clearing history updates the list

  Scenario: Inspect the page without consuming agent output
    Given the page logs a message and a request fails
    When I open Console and Network
    Then they show this tab's messages and failed requests
    And the agent can still read the same messages
    When I open Page text
    Then it shows the runtime's snapshot with element references

  Scenario: Give feedback on a page element
    Given a page is open
    When I choose Comment on an element and click its button
    Then the button is selected without being activated
    And I can scroll while choosing an element without clicking or typing into the page
    And opening or resizing the feedback panel keeps the selected element in view
    And I can write feedback and attach that element to the browser chat
    And the agent receives my feedback with the exact tab and element metadata
    When I preview a supported style change
    Then the same live page shows it and Reset restores its prior inline styles
    And Reset restores the original style attribute when nothing else changed it
    But unrelated style changes made by the page remain
    When the page navigates or the element is removed
    Then applying an old preview is refused and I can select a new element

  Scenario: A page asks a question
    Given a page opens an alert, confirm or prompt
    Then the browser shows the message as text with the appropriate response controls
    When I accept or dismiss it
    Then only that tab's dialog is answered and browsing continues

  Scenario: Downloads
    Given a page starts a download
    Then Downloads shows the filename and whether it is running, completed or failed
    And the file stays in the runtime's browser download folder
    And a running download can be cancelled
    And a completed download can be saved to a location I choose

  Scenario: Browsing permissions stay visible
    Given a public site has been allowed
    When I open Site permissions
    Then I can see and revoke that permission
    And a refused site never silently opens in another browser
    And changing a permission does not grant access to private runtime or unrelated workspace endpoints
    And a blocked host appears only once for the affected tab's current navigation

  Scenario: Clear saved website data
    Given my personal tabs have saved website sign-ins and history
    When I choose Clear browsing data and cancel
    Then my tabs and saved data remain
    When I confirm Clear browsing data
    Then this workspace's personal tabs, cookies, website storage and history are removed
    And bookmarks and downloaded files remain
    And other workspaces are unchanged
    But if an agent tab is still open, clearing is refused with an explanation

  Scenario: Full view and keyboard shortcuts
    Given the browser has focus
    Then Command-L selects Address, Command-T makes a browser tab and Command-W closes it
    And Command-Shift-T restores the last closed tab and Command-F opens Find in page
    And these shortcuts do not create or close note tabs
    And they still target the browser while its menu is open
    When I enter full view and return to split view
    Then the same browser tab and chat remain open

  Scenario: Stale and closed tabs
    Given I switch tabs while a slow request or screencast is arriving
    Then the old tab never replaces the new tab's frame, address or errors
    When the stream stops
    Then the view says it is reconnecting instead of presenting a frozen picture as live
    And it reconnects without creating extra listeners or streams
    When the browser closes
    Then the view says it closed and offers to reopen a personal tab

  Scenario: Narrow browser pane
    Given the browser pane is 360 pixels wide
    Then its address, tab controls and page remain usable without a horizontal page overflow
    And tooltips explain icon buttons without browser title attributes
    And the page controls are usable in light and dark themes
    And personal pages resize to the pane so their text stays readable beside a chat
    When I choose a phone or desktop viewport
    Then that viewport stays fixed until I choose Use pane size
    And using another view of the same tab does not change that fixed viewport
    And page input waits for a frame at the new size before accepting another click
