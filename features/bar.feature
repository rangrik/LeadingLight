Feature: The bar
  A slim strip at the window's right edge, always there, holds Inbox and Ask at the top and Quick
  capture at the bottom. Inbox is one list of everything that wants me: what agents need, Tail's
  suggestions and my captures. Clicking an icon opens its panel beside the strip; clicking it again
  collapses the panel back to the strip. The Feed lane on the left, the pinned Ask card, and the
  sidebar's New idea and Save webpage rows are gone; what they did lives here.

  Names used below:
  - strip: the 40 px column at the right edge; 16 px lucide icons in 32 px buttons; no titles, no borders beyond its hairline
  - panel: the 320 px column beside the strip, resizable from 280 to 480 by its edge, pushing the pages
  - Inbox: the panel of three sections, in this order: Needs you, Suggested, Captured; ⌥⌘I opens and closes it
  - section: a small header (11 px, uppercase, muted) with how many rows it holds, then its rows; a section with no rows does not show
  - Needs you: what the Feed listed (feed.feature), answered in the row the same way; its project menu sits in the section's header when there are two projects or more; ⌥⌘F opens the Inbox here
  - Suggested: Tail's suggestions (suggestions.feature), "On this page" rows first, then "Elsewhere"; ⌥⌘S opens the Inbox here
  - Captured: the captures to review, newest first, each with its project picker, Add tag and review tick; ⌥⌘K opens the Inbox here
  - count: one number on the Inbox icon: items that need me, plus suggestions not yet seen, plus captures to review; none on Ask or Quick capture
  - pin: a toggle in the Inbox's header, its tooltip "Keep order", that keeps the sections in their order
  - Ask: the agent panel's thread and composer (ask.feature); ⌘J opens it, as it did

  Background:
    Given the app is open in a browser at 1440x900 with a page open

  Scenario: The strip and the Inbox
    Then the strip shows Inbox and Ask at the top and Quick capture at the bottom, and no panel
    And hovering Inbox shows "Inbox ⌥⌘I"
    When I click Inbox
    Then the panel opens beside the strip, titled "Inbox", and the page column narrows to make room; nothing overlays the words
    And it shows Needs you, Suggested and Captured, in that order, each header with its count
    When I click Inbox again
    Then the panel collapses to the strip, and the page column takes the room back
    When I press ⌥⌘I twice
    Then the same happens

  Scenario: One count
    Given an agent asks a question, two captures are unreviewed, and tail has one suggestion I have not seen
    Then Inbox shows 4, and Ask and Quick capture show nothing
    When I open the Inbox
    Then Inbox shows 3, since the suggestion is now seen, and Suggested still says 1
    When I answer the question and tick one capture
    Then Inbox shows 1, Needs you is gone, and Captured says 1

  Scenario: Sections with nothing in them do not show
    Given no agent needs me and tail has no suggestions, and one capture waits
    When I open the Inbox
    Then only Captured shows, saying 1
    When a page I edit gets a suggestion
    Then Suggested appears above Captured, saying 1

  Scenario: Nothing waits
    Given no agent needs me, tail has no suggestions, and every capture is reviewed
    When I open the Inbox
    Then it says only "Nothing needs you. Agents' questions, Tail's suggestions and your captures show here."
    And the Inbox icon shows no count

  Scenario: The old keys open their section
    When I press ⌥⌘K
    Then the Inbox opens scrolled so Captured's header is at its top, and Captured's first row has the keyboard
    When I press ⌥⌘F
    Then the Inbox stays open and scrolls to Needs you, its first item with the keyboard
    When I press ⌥⌘S
    Then it scrolls to Suggested
    And none of the three closes the Inbox; ⌥⌘I and Esc do
    When I press ⌥⌘S with no suggestions
    Then the Inbox opens at its top

  Scenario: Walking the rows with the keyboard
    Given the Inbox is open with rows in all three sections, and Needs you's first item has the keyboard
    When I press ↓ past the last item of Needs you
    Then the first row of Suggested has the keyboard, tinted as under the pointer, with no ring
    When I keep pressing ↓
    Then it walks into Captured and stops at its last row; ↑ walks back the same way and stops at the first
    When I press Enter on a Needs you item
    Then it opens, with its answer, and what it is about opens beside the page, as the Feed did
    When I press Enter on a Suggested row
    Then the page it is about comes to the front and its block is lit
    When I press Enter on a Captured row
    Then its page opens, as clicking its title does
    When I press Esc
    Then the Inbox collapses and the keyboard is back in the page

  Scenario: Suggestions about the page in front come first, unless I keep the order
    Given the Inbox is open, the pin is off, and an agent needs me
    When I open a page that has suggestions
    Then an "On this page" section with those rows sits at the top of the panel, above Needs you
    And Suggested below holds only the suggestions about other pages
    When I open a page without suggestions
    Then the order is Needs you, Suggested, Captured again
    When I turn the pin on, its tooltip saying "Keep order", and open the page with suggestions again
    Then the order stays Needs you, Suggested, Captured, and Suggested lists "On this page" rows first, then "Elsewhere"
    When Ask is open and a page with suggestions comes to the front
    Then the panel stays on Ask

  Scenario: Needs you, answered in place
    Given two projects have agents asking
    Then Needs you's header has a small project menu, "All projects"
    When I pick one project
    Then only its items show, and the count on the header and on the icon follow
    When I answer a question in its row
    Then it is answered as in its chat, and the row leaves once the agent has it

  Scenario: Captured, reviewed in place
    When I open the Inbox
    Then Captured lists the captures to review, newest first, each with its project picker, Add tag and a tick
    When I tick one
    Then it leaves, and "Marked reviewed: its title" shows with Undo
    And "Show reviewed" sits at Captured's end
    When I click "Show reviewed"
    Then the reviewed captures show below, each with Return to inbox, and the link says "Hide reviewed"
    And Today's card still opens the full Captures page, with its To review and Reviewed tabs
    And the sidebar has no Capture inbox row

  Scenario: Ask lives in the bar
    When I select words and ask about them
    Then the panel opens on Ask with the thread, as the pinned card did, and the ask bar beside the words works as before
    And the floating and pinned choices of the old card are gone from Settings

  Scenario: Narrow windows
    Given the window is 1000 px wide
    When I click Inbox
    Then the Inbox shows as a pane beside the page, titled "Inbox", with the same sections, and the strip stays
    When I open what a Needs you item is about
    Then it opens in that pane, its crumb leading back to Inbox
    When I press ⌥⌘K
    Then the pane shows the Inbox at Captured
    When I click Inbox
    Then the pane closes
