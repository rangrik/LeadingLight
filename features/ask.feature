Feature: Ask Claude, an agent on every page
  Each page has Claude beside it: a panel in the note that answers about the page and can work
  on it, reading and changing the page, finding and reading other pages, making new ones and
  looking things up on the web. It runs through the Claude Code you installed and signed into
  on this Mac, or, for GPT models, the Codex you signed into (your subscriptions); the app holds
  no key. The panel's look follows synara: your
  messages on the right, Claude's work folded under one line per turn, approvals where the
  composer was. In a browser build, where there is no Claude Code, a stand-in plays Claude's
  part through the same steps, so every surface can be tried and tested.

  Names used below:
  - the Ask button: button "Ask Claude" in each page card's header, beside its Writing menu, on
    the card in front and the others on hover ("Ask GPT" while a GPT model is chosen, as is the
    ask bar); it asks about its own card's page, and gives way in a card too narrow for it and
    the whole title, where ⌘J still asks
  - the agent panel: region "Agent", the bar's Ask (features/bar.feature), beside the pages
  - the composer: the field "Question" at the bottom of the panel (features/composer.feature)
  - a turn: one question and everything Claude does to answer it
  - the stand-in (browser build only): reads the page on every turn; with words quoted, a
    question with "change" or "bold" edits them; "new page" creates one; "search" searches
    pages; "web" searches the web; in Plan mode it writes a plan and asks to go ahead. It speaks
    Claude Code's protocol for Claude models and Codex's app-server protocol for GPT models

  Background:
    Given the app is open in a browser at 1280x800 with a page "Cells" whose body reads
      "The mitochondria is the powerhouse of the cell."

  Scenario: The Ask button and ⌘J open the panel
    Then the Ask button shows a sparkles icon, 16 px, centred in a button the size of the
      Writing menu's beside it, and its tooltip reads "Ask Claude ⌘J"
    When I click the Ask button
    Then the bar opens on Ask with the composer focused
    And with no thread yet it reads "What should we do with “Cells”?"
    When I click the Ask button again
    Then the panel closes
    When nothing is selected and I press Meta+J
    Then the panel opens with the composer focused
    When I press Meta+J while the composer has focus
    Then the panel closes and focus returns to the editor
    When I select "powerhouse" and press Meta+J
    Then the ask bar appears by the words instead (features/composer.feature)

  Scenario: A question and its answer
    When I select "powerhouse", press Meta+J, type "What does this mean?" in the ask bar and press Enter
    Then the panel opens and my message sits on the right, in a rounded bubble, with
      "powerhouse" quoted above the question
    And while Claude works a line reads "Working for 1s", counting up, with a Stop button
      in place of Send
    And when it is done the line reads "Worked for 2s" and the answer is under it as Markdown
    And under the answer are "Insert below", "Replace" and a copy button

  Scenario: Claude's work folds under one line
    Given a turn has finished in which Claude thought and read the page
    Then its line reads "Worked for Ns" with a chevron, folded
    When I click it
    Then it unfolds to one row per step: "Thought for 1s", then "Read “Cells”", each with a
      16 px icon, muted, one line, and the text going to the foreground on hover
    When I click "Read “Cells”"
    Then the row opens to show what was asked and what came back, in small monospace
    And a turn that only answered, with no steps, shows the answer with no line above it

  Scenario: Claude asks before it changes the page
    Given the access is "Ask for approval"
    When I select "powerhouse", quote it in reply, and send "Make it bold"
    Then the composer gives way to a card "Edit “Cells”?" showing "powerhouse" struck in red
      and "**powerhouse**" in green, with "Allow once", "Allow for this thread" and "Decline"
    And the card has the keyboard, so 1, 2 and 3 answer it, and the page is not changed yet
    But when I was typing in the page as the card came, the keyboard stays in the page
    When I click "Allow once"
    Then "powerhouse" is bold in the page, the step reads "Edited “Cells”", and the composer is
      back with the keyboard
    And the turn's time leaves out the time the card waited for me
    And ⌘Z in the page takes the change back in one step

  Scenario: Declining keeps the page as it was
    Given the access is "Ask for approval" and the card "Edit “Cells”?" is showing
    When I click "Decline"
    Then the page is unchanged, the step reads "Edited “Cells”" marked declined, and the turn ends
    When I press 3 on the card
    Then it is declined the same way (1 allows once, 2 allows for the thread)

  Scenario: Allow for this thread
    Given the card "Edit “Cells”?" is showing
    When I click "Allow for this thread"
    Then the change is made, and the next edit in this thread is made without asking
    And a new thread asks again

  Scenario: Full access and Approve for me
    When I pick "Full access" from the access menu
    Then the access button reads "Full access" in the warning colour
    And an edit is made without a card
    When I pick "Approve for me"
    Then Claude Code's own classifier decides, and asks with the card only when unsure

  Scenario: Plan mode changes nothing until I say so
    When I turn on Plan mode from the + menu
    Then a "Plan" chip shows in the composer's footer
    When I quote "powerhouse" and send "Make it bold"
    Then Claude reads the page, writes a plan, and nothing in the page changes
    And under the plan is "Make these changes"
    When I click it
    Then Plan mode turns off and "Go ahead with the plan." is sent in the same thread

  Scenario: Other pages and new pages
    Given there is a page "Glossary" whose body reads "Powerhouse: a source of energy."
    When I send "search for powerhouse"
    Then a step reads "Searched pages for “powerhouse”" and its details list "Glossary"
    When I send "Make a new page about this" and allow it
    Then a step reads "Created “Stand-in page”" with an "Open" button, the page is in the
      sidebar, and the panel stays on "Cells"

  Scenario: The web
    When I send "look this up on the web" and allow it
    Then a step reads "Searched the web for “…”" with a globe icon

  Scenario: GPT through Codex
    When I pick "GPT-6.1-Sol" in the model picker
    Then the model button reads "GPT-6.1-Sol" and the effort slider offers that model's levels
    When I select "powerhouse", quote it in reply, and send "Make it bold"
    Then the steps are the same as Claude's: "Read “Cells”", then the card "Edit “Cells”?"
    When I click "Allow once"
    Then "powerhouse" is bold in the page and the answer reads "Made “powerhouse” bold."
    When I send "look this up on the web"
    Then a step reads "Searched the web for “…”", without a card: Codex searches on its servers
    And with "Approve for me" chosen, GPT's changes still ask, as there is no classifier for them

  Scenario: Switching between Claude and GPT in one thread
    Given a thread with a Claude answer
    When I pick a GPT model and ask a follow-up
    Then GPT answers in the same thread, having been sent the note afresh
    When I pick Claude again and ask
    Then Claude continues its own session in that thread

  Scenario: Codex is missing or signed out
    Given ?codex=missing
    When I open the model picker
    Then the GPT group says "Install Codex to use GPT models" with a link, and lists no models
    Given ?codex=signed-out
    Then it says "Run codex login in Terminal to use GPT models"
    And a GPT model chosen earlier falls back to sending nothing until Codex is ready, saying why
      in the panel

  Scenario: Threads are kept
    Given an answer has arrived
    When I reload the app and press Meta+J on "Cells"
    Then the thread is there as it was
    When I choose "New thread" from the thread menu in the panel's header
    Then the panel is empty again, and the menu lists the earlier thread by its first question
    When I pick it
    Then it comes back, and a follow-up continues the same Claude session

  Scenario: A thread stays with its page
    Given an answer is streaming on page A
    When I switch to page B and back to A
    Then A's thread is there with its answer, and B has none

  Scenario: Nothing typed while asking reaches the page
    Given the agent panel is open with its field focused
    When I type "hello" and press Enter
    Then the page body is unchanged

  Scenario: The answer can go into the note
    Given an answer has arrived for "powerhouse"
    When I click "Insert below"
    Then the answer's paragraphs appear after the block that held the selection
    When I ask again and click "Replace"
    Then the quoted words are replaced by the answer, inline when the answer is one paragraph
    And Replace goes away, since those words are gone
    When I click the copy button
    Then the clipboard holds the answer as Markdown and the button shows a check for a moment

  Scenario: Replace never eats the wrong words
    Given an answer has arrived for "powerhouse" and I have since typed more at the start of the page
    When I click "Replace"
    Then it finds "powerhouse" where it is now and replaces that
    And if the words are no longer in the page, nothing changes and the panel says so

  Scenario: An edit that can't find its words
    Given Claude asks to change words that are no longer in the page
    Then the step reads "Edited “Cells”" marked failed, its details say the words were not
      found, and the page is unchanged

  Scenario: Beside the page, following it
    When I press Meta+J
    Then Ask opens in the bar's panel and the page card narrows to make room, so no words sit under it
    When I open another page from the sidebar, or make a new one
    Then Ask stays open with that page's thread, and the keyboard stays in the page
    When I press Meta+J in the page
    Then the composer takes the keyboard
    When I open a list such as "Pages"
    Then Ask reads "Open a page to ask Claude about it." after a moment, and shows the page's
      thread again when I open a page
    Given two pages side by side
    When I click into the other page, or its Ask button
    Then Ask shows that page's thread; the Ask button also gives it the keyboard

  Scenario: Closing and reopening
    Given an answer has arrived
    When I press Escape
    Then the panel closes and focus returns to the editor
    When I press Meta+J again
    Then the panel shows the same thread

  Scenario: Stop
    When I ask a question and click Stop while Claude works
    Then the work stops where it was, the line reads "Stopped after Ns", and Send is back

  Scenario: Not signed in
    Given Claude Code reports "not logged in"
    When I open the panel
    Then it says to sign in with "claude auth login" in Terminal, with a "Check again" button
    And the question field still takes the keyboard, but Send stays off until signed in

  Scenario: Claude Code is not installed
    Given no claude binary is found
    When I open Settings › AI
    Then it says Claude Code is not installed, with a link to install it, and Ask says the same

  Scenario: Settings › AI
    When I open Settings › AI
    Then it shows the account Claude Code is signed into, with the plan
    And Model (Fable, Opus, Sonnet, Haiku; Opus chosen), Effort (Low, Medium, High, Extra High,
      Max; Medium chosen) and Access (Ask for approval, Approve for me, Full access; Ask chosen)
    And a line saying notes stay on this Mac, and only what Claude reads or is shown goes to Anthropic
