Feature: Filter the sidebar, and search page text
  A field at the top of the sidebar narrows its lists to pages whose title or alias has the typed
  words. Types show how many of their pages match and list them. A last row searches the words in
  page text and opens the results in a pane. Clearing the field puts the sidebar back as it was.

  Names used below:
  - filter field: searchbox "Filter pages" under the sidebar's header, with a search icon; while it
    has text it also has a "Clear filter" button
  - type row: button in navigation "Types", named by the type's plural ("Books"); while
    filtering it shows a muted count on its right
  - result row: a page row under a type row, in navigation "Pinned" or in navigation "Recent"
  - text search row: button "Search in page text for “…”", the last row while filtering
  - results pane: the pane the text search row opens, a region named by the words in quotes

  Background:
    Given the app is open in a browser at 1280x800 with the demo space ("/?mac&demo")
    And "Notes on Thinking in Systems" is open

  Scenario: ⌘K focuses the field, opening the sidebar first
    Given the sidebar is hidden (⌘\) and the cursor is in the page body
    When I press ⌘K
    Then the sidebar slides open and the filter field has focus
    When I press Escape
    Then the field is empty and the cursor is back in the page body where it was
    And ⌘K is listed as "Filter pages" under Go in the keyboard shortcuts

  Scenario: Typing narrows Pinned and Recent by title
    When I type "systems" in the filter field
    Then Recent lists only the pages whose title has "systems", among them "Thinking in Systems"
      and "Notes on Thinking in Systems", in Recent's own order
    And "Leverage Points: Places to Intervene in a System" is not listed ("System" lacks the "s")
    And "Systems" is bold in each title, in the page's own case
    And the Tags row shows "1" with the sub-row "systems"
    And Today, Calendar and Browser are still there
    And Recent's Sort and New page buttons still work

  Scenario: Words match in any order and any case; word starts come first
    When I type "THINK notes"
    Then "Notes on Thinking in Systems" is listed, with "Notes" and "Think" bold
    When I type "in"
    Then in Recent, "Thinking in Systems" and "Notes on Thinking in Systems" (a word starting
      "in") come before "Pricing notes" (where "in" is inside a word)

  Scenario: An alias finds a page
    Given "The Design of Everyday Things" has the alias "DOET"
    When I type "doet"
    Then Books shows 1 and lists "The Design of Everyday Things", with the alias shown muted after
      it and "DOET" bold

  Scenario: Type rows count and list their matching pages
    When I type "thinking"
    Then the Books row shows a muted "1" and has the sub-row "Thinking in Systems" under it
    And the Tasks row shows "1" with "Read chapter 3 of Thinking in Systems"
    And the Ideas row shows "1" with "Try reading Thinking in Systems chapter 4 on paper first"
    And types with no matching page (People, Meetings, Projects, …) are hidden
    And a type with more than 5 matches lists 5, then a muted row "N more" that opens its list
      (type "a": Tasks shows 7, five tasks and "2 more")
    When I click the Books row itself
    Then the Books list opens, as it does without a filter

  Scenario: Nothing matches
    When I type "zebra"
    Then the sidebar shows one line, "No page named that.", and the text search row under it
    And no type row, Pinned or Recent group is shown

  Scenario: Keys walk the results
    When I type "systems" and press ↓
    Then the first result row has focus, shown by the row's hover background, no ring
    When I press ↓ and ↑
    Then focus walks every result row in the order shown, across types, Pinned and Recent, and
      on to the text search row; ↑ from the first row returns to the field
    When I press Enter on "Feedback loops"
    Then "Feedback loops" opens in the focused pane, and the filter keeps its text
    When I press ⇧Enter on "Stocks and flows"
    Then it opens in a pane beside
    When I press ⌘Enter on another result row
    Then it opens in a new tab of the focused pane
    When I press Escape on a result row
    Then focus is back in the field, still holding "systems"

  Scenario: Enter in the field opens the first result
    When I type "weekly" and press Enter
    Then "Weekly review" opens in the focused pane
    When I type "zebra" and press Enter
    Then the results pane opens for “zebra”

  Scenario: Search in page text
    When I type "delay" and click "Search in page text for “delay”"
    Then the results pane opens, its header saying “delay” and "4 pages with these words"
    And each result shows its page's icon and title, with the line holding the word under it and
      "delay" bold in that line, newest page first
    And "Feedback loops", "Notes on Thinking in Systems", "Weekly review" and yesterday's daily
      note are among them
    And a mention in a line reads as the page's title ("Delays in Feedback loops are the key idea")
    When I click "Feedback loops" in the results
    Then it opens in that pane; ⇧-click opens beside, ⌘-click in a new tab

  Scenario: Text search reads each page once until it changes
    Given I searched page text for "delay"
    When I search page text for "loop"
    Then no page is read from storage again
    When I edit "Weekly review" to add "a long delay" and the save lands
    And I search page text for "delay" again
    Then only "Weekly review" is read again, and its new line is shown

  Scenario: Text search finds nothing
    When I search page text for "zebra"
    Then the results pane says "No page has these words in its text."

  Scenario: Clearing puts the sidebar back
    Given Recent is sorted by Updated, "Notes on Thinking in Systems" is open with its Thoughts
      page under it, and the sidebar is scrolled down
    When I type "loops" and then press the "Clear filter" button
    Then the field is empty and keeps focus
    And Types, Pinned and Recent show the same rows in the same order as before
    And the Thoughts tree under the open page is shown again, and the scroll is where it was
    When I type "loops" and press Escape
    Then the same holds, and focus goes back to where it was before the field
