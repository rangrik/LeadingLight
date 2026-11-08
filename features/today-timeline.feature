Feature: A daily note shows the day as a timeline
  Between the day bar (with Tail's rows under it) and the note's own words, a daily note shows
  what happened that day in time order: the pages I made and edited, what agents published and
  asked, and what I captured. So where things stand is on Today, not split between a list at the
  bottom, the Feed and the tasks. A toggle hides it when I only want my words. It replaces the
  "This day" section that sat after the body.

  Names used below:
  - timeline: the region "Timeline": a 1 px line in the border colour, a 6 px dot per entry
  - entry: a 28 px row: the time (12 px, tabular, muted), a 16 px icon, then one line where names
    are in the foreground colour and the other words are muted
  - "Day" and "Just my words": the segmented control at the top right of the timeline

  Background:
    Given the app is open in a browser at 1280x800

  Scenario: Every kind of entry, in its words
    Given today I made "Pricing page" at 10:12 and edited "Kickoff", made on Monday, at 11:30
    And at 11:45 Claude published the report "Pricing copy, first draft" on its task
    And at 12:05 I captured the idea "Ask Sam whether word counts should show"
    And at 12:20 Claude asked "Should the pricing page lead with the monthly or the yearly price?"
    When I open today's note
    Then the timeline lists, earliest first:
      | time  | icon             | line                                                             |
      | 10:12 | the page's icon  | made Pricing page                                                |
      | 11:30 | the page's icon  | edited Kickoff                                                   |
      | 11:45 | the report icon  | Claude published Pricing copy, first draft                       |
      | 12:05 | the idea icon    | captured Ask Sam whether word counts should show                 |
      | 12:20 | a question mark  | Claude asked: Should the pricing page lead with the monthly or … |
    And each time is as the locale has it (15:40 or 3:40 PM)
    And "Pricing page", "Kickoff", "Claude", the report's and the idea's names are in the
      foreground colour; "made", "edited", "published", "captured", "asked:" and the question are muted
    And a long line ends in one ellipsis on its one line

  Scenario: What the timeline leaves out, as "This day" did
    Given today I also edited a tag, yesterday's note, a Thoughts page, and "Pricing notes"
    And today's note links "Pricing notes" in its words
    Then none of them is in the timeline, nor today's note itself, nor the Agent pages the app made
    And a page made and edited the same day shows once, as "made", at the time it was made
    And a captured idea shows once, as "captured", not also as "made"

  Scenario: An edit on two days
    Given "Kickoff" was edited on Tuesday and again on Thursday
    Then Tuesday's timeline and Thursday's both say "edited Kickoff"

  Scenario: A converted idea stays on its day
    Given "Pricing page", made Tuesday, was assigned on Thursday and became a Task
    Then Tuesday's timeline still says "made Pricing page", now with the Task icon
    And Thursday's says "edited Pricing page"

  Scenario: Opening what an entry is about
    When I click "made Pricing page"
    Then "Pricing page" opens in this pane
    When I go back and Shift-click "Claude published Pricing copy, first draft"
    Then the report opens in a pane beside, today's note staying where it was
    When I click "Claude asked: Should the pricing page…"
    Then the Feed opens in the bar with that question open and focused, ready to answer

  Scenario: Live while the note is open
    Given today's note is open beside "Kickoff"
    When I type in "Kickoff"
    Then "edited Kickoff" moves to the end of the timeline, at the time of the edit, as soon as it is saved
    When an agent publishes a report, or I capture an idea with ⌃⌥I
    Then its entry appears at the end without the note scrolling or its words losing the cursor
    When the agent's question is answered
    Then its entry leaves the timeline, as it leaves the Feed

  Scenario: A past day
    When I open yesterday's note
    Then its timeline lists what was made, edited, published and captured that day, from the records
    And no question is in it: questions are about now and show only on today's note

  Scenario: Just my words
    When I pick "Just my words"
    Then the timeline's entries are gone and only the toggle stays above the note's words
    And the note's words are editable as before; Tail's rows above the toggle stay
    When I reload the app and open yesterday's note
    Then "Just my words" is still picked there too
    When I pick "Day"
    Then the timeline is back

  Scenario: A quiet day
    Given nothing was made, edited, published or captured on a day, and no agent is asking
    Then that day's note shows no timeline and no toggle, only its words

  Scenario: A busy day folds its morning
    Given 14 entries on one day
    Then the timeline shows the last 8, under a row "6 earlier" at the top of the line
    When I click "6 earlier"
    Then the earlier entries unfold above, in time order, and the same row folds them again
    And a day with 9 entries shows all 9: a single entry is never folded away

  Scenario: A narrow pane
    Given today's note is in a pane under 36 rem wide
    Then each entry's time sits under its line instead of before it
    And the line keeps the whole width, wrapping to a second line before it is cut

  Scenario: No "This day" section
    When I open any daily note
    Then nothing follows its words but its backlinks: no "This day" section and no "This day" count
