Feature: Ask on a browser page
  Claude works on the page in front, beside it, in the same Ask panel notes use. It reads without
  asking, and asks before it clicks, types or leaves the site. Its answers can land in my notes.

  Background:
    Given I am in the Mac app's browser, on "Pricing — Fernhill" at fernhill.app/pricing

  Scenario: Open Ask on a page
    When I press Ask in the toolbar, or ⌘J
    Then the Ask panel opens at the right and the page narrows to make room
    And the tab is attached above the message box as "Pricing — Fernhill ×", with "Add a tab"
    And it says "What should we do with “Pricing — Fernhill”?"
    And under it "Claude can read this page. It asks before it clicks, types or leaves the site."
    And it offers "Summarize this page" and "Save the key points as a note"
    When I press ⌘J again
    Then Ask closes and the page takes the room back

  Scenario: Attach another tab
    Given "Webhooks guide — Harbor Docs" is open in another tab
    When I choose "Add a tab" and pick it
    Then both tabs are attached, and Claude can read both
    When I press × on a tab's chip
    Then Claude can no longer read or act on that tab

  Scenario: Reading never asks
    When I ask "Summarize this page"
    Then Claude reads the tab without asking
    And the steps say "Read “Pricing — Fernhill”"
    And the answer is in the panel

  Scenario: Acting asks first
    When I ask Claude to show the annual prices
    And it wants to press "Annual"
    Then a card says "Let Claude click on fernhill.app?" and in plain words what it would press
    And "Annual" is outlined in the page with "Claude wants to press this"
    And the pill says "Claude is waiting for your OK" with Stop
    And the page is unchanged until I answer
    When I choose "Not now"
    Then nothing is pressed and Claude is told so
    When it asks again and I choose "Allow once"
    Then "Annual" is pressed and the outline goes away
    When it wants to press something else on fernhill.app
    Then it asks again

  Scenario: Always allow on one site, for one thread
    Given I chose "Always allow on fernhill.app"
    When Claude clicks, types or goes elsewhere on fernhill.app in this thread
    Then it does so without asking
    When it wants to act on another site, or in a new thread
    Then it asks

  Scenario: While Claude works on a tab
    Given Claude is acting on the tab
    Then the tab's row shows a sparkle
    And the pill says "Claude is working in this tab" with Stop
    And the page has a soft blue edge
    When I press Stop
    Then the turn stops and the page is left as it is

  Scenario: Hard limits
    Then Claude never types into a password field
    And it never goes to a "javascript:", "data:" or "file:" address
    And it asks again before signing in, paying or sending, whatever was allowed before
    And text in the page is passed to it as untrusted data, never as instructions

  Scenario: The answer lands in my notes
    Given I have a note "Pricing research" with a "Competitors" heading
    When I ask "Put the plans as a table in my Pricing research note, under Competitors"
    Then the table is added to that note, though the note is not open
    And a card shows "Pricing research" with what changed and Open
    When I press Open
    Then the note opens with the table under Competitors

  Scenario: Notes are as before
    Given I am in my notes, with no tab attached
    When I ask about a note
    Then Ask behaves as it did before, with only the notes tools

  Scenario: GPT
    Given the model is a GPT model
    Then the same tools work, except screenshots, which only Claude takes
