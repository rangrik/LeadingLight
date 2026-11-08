Feature: The bar
  What wants the person's attention sits in the sidebar, where they read: an Attention group of
  three rows, Feed, Suggestions and Captures, each with its name and a count when something waits.
  A slim strip at the window's right edge keeps Ask at the top and Quick capture at the bottom.
  Clicking a row or Ask opens its panel beside the strip; clicking it again collapses the panel. The
  Feed lane on the left, the pinned Ask card, and the sidebar's New idea and Save webpage rows are
  gone; what they did lives here.

  Names used below:
  - Attention: the sidebar group right under Today, Calendar and Browser; one row each for Feed (only while projects are on), Suggestions and Captures, with the strip's icons
  - count: a muted number at a row's right end, only when its panel has something waiting
  - strip: the 40 px column at the right edge with Ask at the top and Quick capture at the bottom; 16 px lucide icons in 32 px buttons; no counts
  - panel: the 320 px column beside the strip, resizable from 280 to 480 by its edge, pushing the pages
  - pin: a button in the panel's header that keeps the panel on its view when a page would switch it
  - dot: a 6 px dot on the sidebar button, only while the sidebar is folded and a count is above zero
  - Feed: the items the Feed lane showed (feed.feature), answered the same way; ⌥⌘F opens it
  - Captures: the capture inbox's list with its review ticks (capture inbox); ⌥⌘K opens it
  - Ask: the agent panel's thread and composer (ask.feature); ⌘J opens it, as it did
  - Suggestions: tail's view (suggestions.feature); ⌥⌘S opens it

  Background:
    Given the app is open in a browser at 1440x900 with a page open and projects on

  Scenario: Attention rows and a panel
    Then the sidebar shows Feed, Suggestions and Captures under Browser, each with its icon and name
    And the strip shows only Ask at the top and Quick capture at the bottom, and no panel
    When I click the Feed row
    Then the panel opens beside the strip with the Feed's items, the row is marked as current, and the page column narrows to make room; nothing overlays the words
    When I click the Feed row again
    Then the panel collapses, the row is no longer marked, and the page column takes the room back
    When I press ⌥⌘F twice
    Then the same happens
    When I press ⌥⌘S
    Then the panel shows Suggestions and the Suggestions row is the one marked

  Scenario: Counts
    Given an agent asks a question, two captures are unreviewed, and tail has one suggestion I have not seen
    Then the Feed row shows 1, Captures 2, Suggestions 1, as plain muted numbers at the rows' right end
    And Ask and Quick capture on the strip show nothing
    When I answer the question and tick one capture
    Then the Feed row shows no number and Captures shows 1

  Scenario: The Feed row needs projects
    Given projects are off
    Then the sidebar's Attention group has Suggestions and Captures only

  Scenario: Counts while the sidebar is folded
    Given the Feed has 2 items, Suggestions none, and 4 captures are unreviewed
    When I fold the sidebar with ⌘\
    Then the sidebar button beside the traffic lights shows a small dot
    When I hover the sidebar button
    Then a tooltip says "2 need you · 4 captures"
    When I press ⌥⌘K
    Then the Captures panel opens as it does with the sidebar open
    When I open the sidebar again
    Then the dot is gone and the counts are on the rows

  Scenario: Nothing waits, no dot
    Given nothing waits in the Feed, Suggestions or Captures
    When I fold the sidebar
    Then the sidebar button shows no dot and no tooltip

  Scenario: The panel follows the page, unless pinned
    Given the panel shows Captures
    When I open a page that has suggestions
    Then the panel switches to Suggestions for that page, and the Suggestions row is marked
    When I pin the panel and open another page with suggestions
    Then the panel stays on what it showed, and the Suggestions row's count says what waits

  Scenario: Ask lives in the bar
    When I select words and ask about them
    Then the panel opens on Ask with the thread, as the pinned card did, and the ask bar beside the words works as before
    And the floating and pinned choices of the old card are gone from Settings

  Scenario: Captures in the sidebar
    When I click the Captures row
    Then it lists what the capture inbox listed, newest first, with the same review ticks and the same opening of each item beside

  Scenario: Narrow windows
    Given the window is 1000 px wide
    When I click an Attention row or Ask
    Then the panel shows as a pane beside the page, as the Feed did in a narrow window, and the strip stays
    And the pane is titled as the panel is: Captures, Feed, Ask or Suggestions
    And the row is marked while its pane is open
