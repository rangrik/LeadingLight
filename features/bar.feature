Feature: The bar
  A slim strip at the window's right edge, always there, holds the three places that collect things
  for you, Feed, Captures and Suggestions, then a line, then Ask, and Capture at the bottom. Each is
  named under its icon. Clicking one opens its panel beside the strip; clicking it again collapses the
  panel back to the strip. A small count sits on an icon only when something waits in it. The Feed
  lane on the left, the pinned Ask card, and the sidebar's New idea and Save webpage rows are gone;
  what they did lives here.

  Names used below:
  - strip: the column at the right edge; each control a 48 px tall column, a 16 px lucide icon over its 11 px name; no borders beyond its hairline
  - label: the name under an icon, muted, in the text colour while its panel is open; never cut short
  - panel: the 320 px column beside the strip, resizable from 280 to 480 by its edge, pushing the pages
  - description: one 12 px muted line under a panel's header saying what the panel is for
  - count: a small number at an icon's top-right, only when its panel has something waiting; none on Ask or Capture
  - Keep here: a labelled toggle in the panel's header that keeps the panel on its view when a page would switch it
  - Feed: the items the Feed lane showed (feed.feature), answered the same way; ⌥⌘F opens it
  - Captures: the capture inbox's list with its review ticks (capture inbox); ⌥⌘K opens it
  - Ask: the agent panel's thread and composer (ask.feature); ⌘J opens it, as it did
  - Suggestions: tail's view (suggestions.feature); ⌥⌘S opens it

  Background:
    Given the app is open in a browser at 1440x900 with a page open

  Scenario: The strip and a panel
    Then the strip shows Feed, Captures, Suggestions, a line, Ask at the top and Capture at the bottom, and no panel
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

  Scenario: The panel follows the page, unless kept here
    Given the panel shows Captures
    When I open a page that has suggestions
    Then the panel switches to Suggestions for that page
    When I turn on Keep here and open another page with suggestions
    Then the panel stays on what it showed, and the Suggestions count says what waits

  Scenario: Every control is named
    Then each control shows its name under its icon: Feed, Captures, Suggestions, Ask, Capture
    And no name is cut short or wider than the strip
    And Ask sits below a short hairline, apart from the three above it
    And Capture sits at the bottom, level with the cards' bottom edge
    When I click Captures
    Then its icon and name turn to the text colour and the others stay muted
    When I hover Feed
    Then a tooltip shows only its key, ⌥⌘F, not its name again

  Scenario: The first control stays level with the headers
    Given the window is laid out as the Mac app (?mac), with a 36 px header
    Then Feed's icon is centred on the page header's middle line, as the traffic lights are
    Given a browser layout with a 64 px header
    Then Feed's icon is centred on that header's middle line too

  Scenario: The count stays at the icon
    Given two captures are unreviewed
    Then Captures shows 2 at its icon's top-right, clear of its name
    And the count is read with the button: "Captures, 2"

  Scenario: Each panel says what it is for
    When I open Feed
    Then under its header I read "What agents need from you, from every project."
    When I open Captures
    Then I read "What you captured in a hurry, to sort out when ready."
    When I open Suggestions
    Then I read "What Tail offers for the page in front and elsewhere."
    When I open Ask
    Then I read "The thread with Claude about the page in front."

  Scenario: Empty panels say when they fill and lead somewhere
    Given a space where nothing waits anywhere
    When I open Suggestions
    Then I read "Tail speaks when a block you finish reads as a task or names a page." and a "How Tail works" button
    When I click "How Tail works"
    Then Settings opens on AI, scrolled to Tail and what it does
    When I go back and open Feed
    Then I read "Questions, approvals and work ready for review show here." and a "Projects in Settings" button
    When I click "Projects in Settings"
    Then Settings opens on AI, scrolled to Projects
    When I go back and open Captures
    Then it keeps "Nothing waiting here" and its sentence, and adds a "Capture something" button
    When I click "Capture something"
    Then the capture box opens

  Scenario: Keep here
    When I open Captures
    Then its header shows a "Keep here" toggle, off
    When I hover it
    Then a tooltip reads "Stay on this panel when a page has suggestions"
    When I click it
    Then it shows pressed, and stays pressed when I switch to Feed or reload
    And there is no pin icon anywhere in the bar

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
    And the pane is titled as the panel is: Captures, Feed, Ask or Suggestions
    And the strip keeps its names, and the control for the open pane shows pressed
