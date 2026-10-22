Feature: The ask bar, the composer and agents
  Asking happens where the words are: a small bar beside the selection takes the question
  (Shipyard's pattern), and the panel's field is a composer in synara's spirit: "@" mentions an
  agent or another page, "/" offers things to do with the words, and the model and effort
  sit in its footer. Agents are Claude Code's own agent files, found on this Mac, plus a few
  that ship with the app.

  Names used below:
  - the ask bar: toolbar "Ask Claude" beside the selected words, with a field and "Quote in reply"
  - the composer: the field at the bottom of the agent panel, with its footer

  Background:
    Given the app is open in a browser at 1280x800 with a page whose body reads
      "The mitochondria is the powerhouse of the cell."

  Scenario: The ask bar takes the question beside the words
    When I select "powerhouse" and click Ask (or press Meta+J)
    Then the ask bar appears just above the selected words, which stay marked
    And its field reads "Ask Claude about this…" and has focus
    When I type "What does this mean?" and press Enter
    Then the panel opens with "powerhouse" quoted and the question already sent
    And the bar is gone

  Scenario: Quote in reply
    When I select "the cell" and press Meta+J, then click "Quote in reply"
    Then the panel opens with "the cell" quoted and the composer focused, nothing sent

  Scenario: The bar goes away cleanly
    Given the ask bar is open
    When I press Escape
    Then the bar closes and the caret is back in the text
    When the bar is open and I click elsewhere in the page
    Then the bar closes
    When I select words again and press Meta+J
    Then the bar opens again, as many times as asked
    When the page scrolls while the bar is open
    Then the bar moves with the words, and hides only once they leave the view

  Scenario: Mention an agent
    Given the panel is open
    When I type "@" in the composer
    Then a menu lists the agents: those that ship with the app (Editor, Summarizer, Critic),
      then any from ~/.claude/agents on this Mac, each with its description
    When I choose "Editor"
    Then "@Editor" sits in the field as a chip, and the next answer follows that agent's
      prompt and model
    And the chip stays for the follow-ups, until its × removes it
    And the arrow keys move through the menu, Enter picks the one marked

  Scenario: Mention another page
    Given there is a page titled "Glossary"
    When I type "@Glos" in the composer and choose "Glossary"
    Then "@Glossary" sits in the field, and that page's text goes along with the question
    And it goes along again only when it has changed, even in a thread that already started

  Scenario: Slash commands do things with the words
    Given the panel is open with "powerhouse" quoted
    When I type "/" in the composer
    Then a menu lists Explain, Summarize, Shorten, Expand, Fix grammar, Rewrite and Translate
    When I choose "Shorten"
    Then the question "Shorten this" is sent at once with the quoted words

  Scenario: Model and effort in the footer
    Given the panel is open
    Then the composer's footer shows the model (Opus) and effort (Medium) as one small picker
    When I pick Sonnet and High
    Then the next question uses them, and Settings › AI shows the same

  Scenario: Agents are listed in Settings
    When I open Settings › AI
    Then an Agents group lists every agent with its source: "Built in" or the file it came from
    And a "Show folder" action opens the app's agents folder, where a Claude Code agent file
      (name, description, model in its front matter; the prompt below) can be dropped in

  Scenario: A broken agent file is skipped, not fatal
    Given a file in ~/.claude/agents has no name
    When I type "@" in the composer
    Then the other agents are listed and the broken one is left out
