Feature: The bar
  A slim strip at the window's right edge, always there, holds four icons at the top, Suggestions,
  Feed, Captures and Ask, and Quick capture at the bottom. Clicking an icon opens its panel beside the
  strip; clicking it again collapses the panel back to the strip. A small count sits on an icon only
  when something waits in it. The Feed lane on the left, the pinned Ask card, and the sidebar's New idea
  and Save webpage rows are gone; what they did lives here.

  Names used below:
  - strip: the 40 px column at the right edge; 16 px lucide icons in 32 px buttons; no titles, no borders beyond its hairline
  - panel: the 320 px column beside the strip, resizable from 280 to 480 by its edge, pushing the pages
  - count: a small number on an icon, only when its panel has something waiting; none on Ask or Quick capture
  - pin: a button in the panel's header that keeps the panel on its view when a page would switch it
  - Feed: the items the Feed lane showed (feed.feature), answered the same way; ⌥⌘F opens it
  - Captures: the capture inbox's list with its review ticks (capture inbox); ⌥⌘C opens it
  - Ask: the agent panel's thread and composer (ask.feature); ⌘J opens it, as it did
  - Suggestions: tail's view (suggestions.feature); ⌥⌘S opens it

  Background:
    Given the app is open in a browser at 1440x900 with a page open

  Scenario: The strip and a panel
    Then the strip shows four icons at the top and Quick capture at the bottom, and no panel
    When I click Feed
    Then the panel opens beside the strip with the Feed's items, and the page column narrows to make room; nothing overlays the words
    When I click Feed again
    Then the panel collapses to the strip, and the page column takes the room back
    When I press ⌥⌘F twice
    Then the same happens

  Scenario: Counts
    Given an agent asks a question, two captures are unreviewed, and tail has one suggestion I have not seen
    Then Feed shows 1, Captures 2, Suggestions 1, and Ask and Quick capture show nothing
    When I answer the question and tick one capture
    Then Feed shows nothing and Captures 1

  Scenario: The panel follows the page, unless pinned
    Given the panel shows Captures
    When I open a page that has suggestions
    Then the panel switches to Suggestions for that page
    When I pin the panel and open another page with suggestions
    Then the panel stays on what it showed, and the Suggestions count says what waits

  Scenario: Ask lives in the bar
    When I select words and ask about them
    Then the panel opens on Ask with the thread, as the pinned card did, and the ask bar beside the words works as before
    And the floating and pinned choices of the old card are gone from Settings

  Scenario: Captures in the bar
    When I open Captures
    Then it lists what the capture inbox listed, newest first, with the same review ticks and the same opening of each item beside
    And the sidebar has no Capture inbox row

  Scenario: Narrow windows
    Given the window is 1000 px wide
    When I open a panel
    Then the panel shows as a pane beside the page, as the Feed did in a narrow window, and the strip stays
