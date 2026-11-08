Feature: Search with content
  ⌘K finds a page by any of its words, not only its title, so a half-remembered sentence leads
  back to where it was written. Each result shows the line that matched, and opening it scrolls to
  that line and lights it for a moment.

  Names used below:
  - panel: the search dialog, 640 px wide, 10% of the window's height from the top
  - Search row: the sidebar's row under Today, with ⌘K at its right end
  - chips: the filters in a row under the field: a type ("Books"), a project ("in LeadingLight"),
    "Edited this week". The words in the field are what is filtered; a chip only mirrors them
  - "Feedback loops": a page with the paragraph "Delays in a loop make it oscillate. That is most of
    what goes wrong in projects: the signal arrives after the decision."
  - "Notes on Thinking in Systems": a page with a section "Delays" whose paragraphs talk about
    delays and loops, edited yesterday
  - "Pricing notes": a page in no project; "Write the pricing page copy": a task in "LeadingLight"

  Background:
    Given the browser build is open at 1280x800 with the demo space (?mac&demo)

  Scenario: Opening and closing
    When I press ⌘K while writing in a page
    Then the panel opens with the field focused and the placeholder "Search pages and their words"
    And the sidebar's Search row shows ⌘K as a key
    When I press Escape
    Then the panel closes and the caret is back where I was writing
    When I click the Search row
    Then the panel opens
    And pressing ⌘K again closes it

  Scenario: Nothing typed shows the recent pages
    When I open the panel
    Then it lists the 8 most recently edited pages under "Recent", newest first
    And each row shows the page's icon, its title, and its project's name muted at the right

  Scenario: A half-remembered sentence
    When I open the panel and type "delays make loops oscillate"
    Then 80 ms after the last key the results show "Pages · 1" with "Feedback loops"
    And under its title is "Delays in a loop make it oscillate. That is most of what goes wrong…"
      with "Delays", "loop", "make" and "oscillate" in bold
    And the words can be in any order and only begin a word: "oscil" finds it too

  Scenario: Title matches come before body matches, recent before old
    When I type "pricing"
    Then "Write the pricing page copy" and "Pricing notes" (titles, the task edited more recently)
      come before pages that only say "pricing" in their text, such as today's daily note
    And the results are grouped by type with a count, in the order of each group's best result:
      "Tasks · 1", "Pages · 2", "Daily notes · 1", "Projects · 1", "Meetings · 1", "Agents · 1",
      "Reports · 1"
    And in "Pages · 2", "Pricing notes" (title) is above "Weekly review" (text)

  Scenario: More than one block matches
    When I type "delays"
    Then "Notes on Thinking in Systems" shows its first block that says "delays" ("…draws on it.
      Overshoot comes from delays."), and "+5 more" for the other five blocks that do

  Scenario: Reports and agents are found by title, not by their text
    When I type "pricing"
    Then "Claude: Write the pricing page copy" (an agent) and "Pricing copy, first draft" (a report)
      are listed after every page of mine, though they were edited last
    When I type "simpler to explain"
    Then "Pricing notes" is found, and the report "Pricing copy, first draft" is not
    When I type "in:reports simpler to explain"
    Then the report "Pricing copy, first draft" is found too

  Scenario Outline: Filters, clicked or typed
    When I type "<words>"
    Then the chip "<chip>" is on, and only <what> are listed
    When I click the chip "<chip>"
    Then its words are gone from the field and the chip is off

    Examples:
      | words                    | chip              | what                                   |
      | Books                    | Books             | books, newest first                    |
      | pricing in LeadingLight  | in LeadingLight   | pages of LeadingLight saying "pricing" |
      | delays edited this week  | Edited this week  | pages edited in the last 7 days        |

  Scenario: Clicking a chip adds its words
    When I type "delays" and click the chip "Pages"
    Then the field reads "delays Pages" and only pages are listed

  Scenario: Open at the match
    When I type "signal arrives after the decision" and press Enter
    Then the panel closes and "Feedback loops" opens in the pane in front
    And the paragraph "Delays in a loop make it oscillate…" is scrolled into view and lit for a moment
    And the caret is at the start of that paragraph
    When I search again and press ⇧Enter on a result
    Then it opens beside the page I was reading, which stays where it was

  Scenario: Nothing matches
    When I type "zebra crossing"
    Then the panel says "Nothing has these words."
    And offers "New page “zebra crossing”"; Enter on it makes that page, opens it, and puts the
      caret in its body

  Scenario: The index follows edits
    Given I opened the panel once, so every page's words are read
    When I write "a quiet harbour at dawn" in "Weekly review" and wait for it to save
    And I open the panel and type "quiet harbour"
    Then "Weekly review" is found with that line
    And no other page was read again to find it

  Scenario: Typing stays fast on a big space
    Given the demo space plus 300 generated pages of a few paragraphs each
    When I open the panel and type a sentence of 30 keys
    Then every key's frame takes under 16 ms
    And no key reads the store: the search runs 80 ms after the last key, in memory
