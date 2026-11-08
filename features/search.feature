Feature: Quick open
  ⌘K opens a switcher over the page: type a few letters of a page's name and press Enter to go
  there. It finds pages by title and aliases, not by the words inside them. It also runs the
  app's places (a type's list, Today, Calendar, Settings, Browser, the bar's panels) by name.

  Names used below:
  - switcher: a 560 px COSS Command dialog, centred over the page area, 12 vh from the top, with a
    field ("Open a page…") and a list under it
  - row: the page's icon, its title, its type name muted, and its project's name when it has one;
    "open" muted at the right when the page is already open in a tab
  - findable: every page but daily notes, tags, reports, agents' pages and templates, which have
    their own places (the Calendar, a tag's page, the task)
  - recent: the 8 most recently edited findable pages; within a kind of match, newer pages come first

  Background:
    Given the app is open in a browser at 1440x900 on the demo space, with "Weekly review" open

  Scenario: Three ways in
    When I press ⌘K
    Then the switcher opens with the field focused and empty
    When I press Esc, then click "Search" at the top of the sidebar, under Today
    Then the switcher opens again; the Search row shows ⌘K at its right
    When I press Esc, press ⌘T for an empty tab and click its "Search" button
    Then the switcher opens again
    And ⌘K is listed under Go in Keyboard shortcuts (⌘⌥/), as "Search"

  Scenario: The empty field shows recent pages and commands
    When I press ⌘K
    Then "Recent" heads the 8 most recently edited pages, newest first
    And no daily note, tag, report, agent page or template is among them
    And "Weekly review" shows "open" at its right
    And "Commands" follows, with Today, Calendar, Browser, Settings ⌘,, each type's list (Books, Tasks, …) and the bar's panels: Suggestions ⌥⌘S, Feed ⌥⌘F, Captures ⌥⌘K, Ask ⌘J
    And the first row is highlighted

  Scenario: Matches come in order: start of the title, start of a word, then letters in order
    When I press ⌘K and type "pri"
    Then "Pricing notes" comes before "Write the pricing page copy", which comes before pages that only hold p, r and i in order
    And "Recent" is gone, and no command row shows, since no command's words start with "pri"
    When I clear the field and type "fl"
    Then "Stocks and flows" (a word starts with "fl") comes before "Feedback loops" (f, then l)
    When I type "tis"
    Then "Thinking in Systems" is listed though its title does not hold "tis": its alias "TiS" does
    And its row says "Book" in muted text
    When I type "pricing page"
    Then "Write the pricing page copy" shows "Task" and "LeadingLight", its project

  Scenario: Keys
    When I press ⌘K, type "stocks" and press ↓ then ↑
    Then the highlight moves down a row and back
    When I press Enter
    Then "Stocks and flows" opens in the pane in front, in place of "Weekly review", and the switcher closes
    When I press ⌘K, type "feedback" and press ⇧Enter
    Then "Feedback loops" opens in a new pane beside it, and that pane is in front
    When I press ⌘K, type "pricing notes" and press ⌘Enter
    Then "Pricing notes" opens in a new tab of the pane in front, and that tab is in front
    When I press ⌘K, type "stocks" and press Enter
    Then the tab already holding "Stocks and flows" comes to the front; no second copy opens

  Scenario: A page that isn't there yet
    When I press ⌘K and type "Garden plan"
    Then the last row reads New page “Garden plan”
    When I press ↑ until it is highlighted, or click it, and press Enter
    Then a Page titled "Garden plan" is made and opens in the pane in front
    When I press ⌘K and type "pricing notes"
    Then there is no New page row: a page has that exact title
    When I press ⌘K and type only spaces
    Then the list is the empty field's, and there is no New page row

  Scenario: Commands
    When I press ⌘K, type "books" and press Enter
    Then the Books list opens in the pane in front
    When I press ⌘K, type "feed" and press Enter
    Then the Feed panel opens in the bar, as ⌥⌘F does
    When I press ⌘K, type "settings" and press Enter
    Then Settings opens

  Scenario: Esc gives the keyboard back
    Given I have put the cursor after "momentum" in "Stocks and flows"
    When I press ⌘K, type "xyz" and press Esc
    Then the switcher closes and nothing opens
    And the cursor is after "momentum" again; typing a letter puts it there
    When I press ⌘K and click outside the switcher
    Then it closes and the cursor is where it was

  Scenario: ⌘K over another dialog, or in Settings
    When I open Settings and press ⌘K
    Then Settings stays and the switcher opens over it; opening a page closes Settings first
    When I press ⌘K while the switcher is open
    Then it closes, as Esc does

  Scenario: Fast on a large space
    Given the demo space plus 300 more pages
    When I press ⌘K and type "notes" one letter at a time
    Then each letter's list is drawn before the next frame (under 16 ms from key to paint)
