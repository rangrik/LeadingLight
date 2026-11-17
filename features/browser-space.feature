Feature: The browser space
  The browser is a pane in the Mac app: my tabs in the shared sidebar, one row of controls,
  a real page. My tabs are native pages. Agents keep their own streamed browsers.

  Background:
    Given I am in the Mac app

  Scenario: Go to the browser and back
    When I press Browser in the sidebar, or ⌥⌘B
    Then the sidebar shows "Browser" under LeadingLight, a search field, Pinned, Tabs and Agents
    And my open panes stay as they are
    When I select a browser tab or open a new one
    Then its pane has Back, Forward, the address pill, Save and More
    And there is only one place that shows an address
    And switching sidebar mode does not open the command bar
    When I press ⌥⌘B again, or choose Notes in the sidebar footer
    Then my notes are as I left them
    And my tabs are still open when I return

  Scenario: Open a page
    When I press ⌘T
    Then a command bar opens in the middle of the window with the cursor in it
    When I type "en.wikipedia.org" and press Return
    Then a new tab opens that page at the screen's full resolution
    And the tab's row shows the site's icon and the page's title
    And the pill shows "en.wikipedia.org" with the path in a quieter color
    When I type words that are not an address and press Return
    Then a web search for them opens

  Scenario: The command bar finds what I have
    Given I have tabs open, pages in history, and a link on the clipboard
    When I press ⌘T with nothing typed
    Then "Open copied link" is first, then my open tabs, then pages from history
    When I type part of an open tab's title
    Then that tab is offered first, and Return switches to it instead of opening a copy
    When I press Escape
    Then the bar closes and the page is as it was

  Scenario: Go somewhere in this tab
    Given a page is open
    When I click the pill or press ⌘L
    Then the command bar opens with the page's full address selected
    And Return loads what I type in this tab, not a new one

  Scenario: Tabs
    Given three tabs are open
    When I click a tab's row
    Then its page shows at once, where I left it, still playing if it was
    When I press ⌘W
    Then the tab closes and a neighbour shows
    When I press ⇧⌘T
    Then it comes back at its address
    And ⌘1 to ⌘9 jump to a tab by its place, and ⌃⇥ goes to the next
    And a tab playing sound shows a speaker in its row

  Scenario: Pinned sites
    When I choose Pin from a tab's row
    Then its icon joins the Pinned tiles and stays after I close the tab or restart
    When I click a pinned tile
    Then its tab shows, or opens if it was closed

  Scenario: Loading, stopping and failing
    When a page is loading
    Then a thin line fills along the bottom of the pill, and Reload becomes Stop
    When a page cannot be reached
    Then the page area says so in plain words with Try again
    And the pill shows the address I asked for

  Scenario: Keys go to the page in front
    Given a native page has the keyboard
    Then ⌘R reloads it, and ⌘[ and ⌘] go back and forward in it
    And ⌘C, ⌘V, ⌘X, ⌘A and ⌘Z act on it
    And ⌘+, ⌘− and ⌘0 zoom it
    When I click into a note and press ⌘A
    Then it selects the note, not the page

  Scenario: The app's own menus and the page
    Given a page is showing
    When the command bar, a menu or a dialog opens over it
    Then I still see the page behind it, and the whole menu shows
    And the page is live again when it closes

  Scenario: Links that want a new window
    When a page opens a link in a new window, or I ⌘-click a link
    Then it opens in a new tab after the current one

  Scenario: My tabs come back
    Given tabs are open and I am signed in to a site
    When I quit the app and open it again
    Then the same tabs are in the sidebar in the same order, without pressing anything
    And I am still signed in

  Scenario: Bring it up from anywhere
    Given another app is in front
    When I press ⌃⌥B
    Then LeadingLight comes forward in the browser with the command bar open
    When I press ⌃⌥B again
    Then LeadingLight hides and the app I was in is in front again

  Scenario: Hide the sidebar
    When I press ⌘\
    Then the page takes the room, and the toolbar leaves space for the window buttons
    And ⌘T still finds my tabs

  Scenario: Agents keep their own browsers
    Given an agent has opened a page in its own browser
    Then it is listed under Agents, not under Tabs, with a dot while the agent works
    When I click it
    Then I see its streamed page, and the pill says "Agent's own browser"
    And it shares no cookies, tabs or sign-ins with my tabs or with another agent's browser
    And opening or closing my tabs never changes an agent's tab
    And a project chat's Browser button still shows that chat's agent tab beside the chat

  Scenario: A page cannot reach the app
    Given any website is open in one of my tabs
    Then it cannot call the app's commands or read my notes
    And "javascript:", "data:" and "file:" addresses are refused

  Scenario: Save a link
    Given a page is open
    When I press Save, or ⌘D
    Then the pill says "Saved" for a moment and the Save icon is filled
    And the page is listed under Saved in the sidebar, and in the command bar
    When I press Save again
    Then it is no longer saved

  Scenario: The browser build
    Given I am in the browser build, not the Mac app
    Then Browser opens the streamed browser pane as before, since a web page cannot host a native view
