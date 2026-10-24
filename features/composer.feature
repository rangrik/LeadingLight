Feature: The ask bar, the composer and agents
  Asking happens where the words are: a small bar beside the selection takes the question
  (Shipyard's pattern), and the panel's field is COSS's composer laid out after synara's: a
  rounded card with the question on top and, under it, + on the left, then the access menu,
  and on the right the model and effort, then a round Send. "@" mentions an agent or another
  page, "/" offers things to do with the words. Agents are Claude Code's own agent files,
  found on this Mac, plus a few that ship with the app.

  Names used below:
  - the ask bar: toolbar "Ask Claude" beside the selected words, with a field and "Quote in reply"
  - the composer: the field "Question" at the bottom of the agent panel, with its footer

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
    Then the panel opens with "the cell" quoted just above the composer, the composer focused,
      nothing sent
    And the quote's × takes it away

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

  Scenario: The composer's footer
    Given the panel is open
    Then the composer is one rounded card: the field on top reading "Ask about this page…",
      and under it, on one line, a round + button, the access button "Ask for approval" with a
      hand icon, then at the far end the model button "Opus Medium" and a round Send button
    And every icon is centred in its button, and the buttons' centres share one line
    And Send is off until something is typed; Enter sends, Shift+Enter breaks the line
    When the panel is narrowed to 280 px
    Then the access button keeps its icon and drops its words, the model drops the effort, and
      nothing wraps or overlaps
    And with Plan mode on, the access button drops its words at any width, to make room for the chip

  Scenario: The + menu
    When I click +
    Then a menu opens above it with "Page or agent", "Command" and a "Plan mode" switch
    And choosing in it, or in the access menu or the model popover, leaves the popup open or
      closed as it should and Escape closes only the popup
    When I choose "Page or agent"
    Then "@" is typed in the field and the mention menu opens

  Scenario: The access menu
    When I click the access button
    Then a menu lists "Ask for approval", "Approve for me" and "Full access", each with its
      icon and a line saying what it does, the current one checked
    When I pick "Full access"
    Then the button reads "Full access" in the warning colour, and the choice is kept

  Scenario: The model and effort picker
    When I click the model button
    Then a popover lists, under "Claude", Fable, Opus, Sonnet and Haiku with ⌘1 to ⌘4, and under
      "GPT" the models Codex offers (in the stand-in GPT-6.1-Sol and GPT-6-Luna), the current one
      checked
    And under them the effort's name and a slider with that model's stops: Claude's Low, Medium,
      High, Extra High, Max; GPT-6.1-Sol's add Ultra
    When I pick Sonnet and drag the slider to Extra High
    Then the button reads "Sonnet Extra High", the next question uses them, and Settings › AI
      shows the same
    When I press Meta+3 with the popover open
    Then Sonnet is chosen

  Scenario: Mention an agent
    Given the panel is open
    When I type "@" in the composer
    Then a menu lists the agents: those that ship with the app (Editor, Summarizer, Critic),
      then any from ~/.claude/agents on this Mac, each with its description, then the pages
    When I choose "Editor"
    Then an "Editor" chip with the agent icon sits in the text, and that question follows the
      agent's prompt and model
    And the arrow keys move through the menu, Enter picks the one marked

  Scenario: Mention another page
    Given there is a page titled "Glossary"
    When I type "@Glos" in the composer and choose "Glossary"
    Then a "Glossary" chip with the page icon sits in the text, and that page's text goes along
      with the question
    And it goes along again only when it has changed, even in a thread that already started

  Scenario: Slash commands do things with the words
    Given the panel is open with "powerhouse" quoted
    When I type "/" in the composer
    Then a menu lists Explain, Summarize, Shorten, Expand, Fix grammar, Rewrite and Translate
    When I choose "Shorten"
    Then the question "Shorten this" is sent at once with the quoted words

  Scenario: Agents are listed in Settings
    When I open Settings › AI
    Then an Agents group lists every agent with its source: "Built in" or the file it came from
    And a "Show folder" action opens the app's agents folder, where a Claude Code agent file
      (name, description, model in its front matter; the prompt below) can be dropped in

  Scenario: A broken agent file is skipped, not fatal
    Given a file in ~/.claude/agents has no name
    When I type "@" in the composer
    Then the other agents are listed and the broken one is left out
