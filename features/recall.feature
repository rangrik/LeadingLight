Feature: Recall
  What I note while reading is written once and rarely met again. Coming back to a page I noted
  things in, Tail offers one line: go through them once, one at a time, and say each in my own
  words. In Tail's manner (docs/TAIL.md): one line under twelve words with one verb button, never
  a question, nothing in the page moves, lines expire, and silence is the common case.

  Names used below:
  - noted things: a page's sidenotes whose thought still exists, and its highlighted words, in
    reading order
  - last open: when I last had the page open, kept on this Mac per page; a page never opened here
    counts from its last edit, and from its Thoughts page's last edit when that is later
  - quiet week: seven days after a recall, read from the Thoughts page's `recalled` property
  - demo: the browser build at `/?mac&demo` on an empty space. "Notes on Thinking in Systems" has
    three sidenotes, on "interconnections", "Resilience is a stock too" and "A delay in a
    balancing loop produces oscillation", written five days ago (Tuesday, when today is Sunday),
    the page last edited that evening and never opened here since

  Background:
    Given the demo, at 1440x900

  Scenario: The return row on a page I noted things in
    When I open "Notes on Thinking in Systems" from the sidebar
    Then above its title a tail row reads "You noted 3 things here on Tuesday." with a Recall button
    And no "You stopped at" row shows, though the page ends mid-sentence: the recall row takes its place
    And the title and the words are where they always are, and Add icon waits while the row shows
    When I type anything in the body
    Then the row leaves, and the words do not move

  Scenario Outline: When the return row stays silent
    Given <case>
    When I open the page
    Then no recall row shows above its title

    Examples:
      | case                                                                              |
      | a page with one sidenote and no highlights                                        |
      | "Notes on Thinking in Systems" opened and left less than three days ago           |
      | "Notes on Thinking in Systems" recalled less than seven days ago                  |
      | Tail is Off in Settings › AI › Tail                                               |
      | a Thoughts page, an essay, or an agent's report                                   |

  Scenario: Back within three days, the usual row
    Given I opened "Notes on Thinking in Systems" and left it without pressing Recall
    When I come back to it later today
    Then no recall row shows: it expired when I left
    And the "You stopped at" row shows as it would for any page left mid-sentence

  Scenario: The card, one noted thing at a time
    Given the return row shows on "Notes on Thinking in Systems"
    When I press Recall
    Then the row leaves, and a card sits under the page's properties, above the body
    And the body is below the card, unchanged, and no dialog or popup opened
    And the card reads "1 of 3", then the first note's words at the editor's text size
    And under them, muted and quoted, the words it was about: “interconnections”
    And a one-line field "In your own words" has the keyboard
    And three small buttons: Back (dimmed on the first), Next with its key Enter, Done with its key Esc
    When I press Enter with the field empty
    Then the card reads "2 of 3" with the second note, and nothing was saved
    When I press Back
    Then the card reads "1 of 3" again
    When I press Esc
    Then the card closes, the body is where it always is, and no row comes back above the title

  Scenario: A line in my own words becomes a thought
    Given the card shows "1 of 3"
    When I type "The links between notes matter more than the notes" and press Enter
    Then the card reads "2 of 3"
    And a new sidenote with my words sits in the margin by "interconnections", under the first one
    And the page's Thoughts page holds a new thought block with my words and the same quoted words,
      the shape a sidenote's thought has
    And the sidebar stays as it was: saving a line makes no room for itself
    When I press Back
    Then the field holds my line again
    When I change it to "Links matter more than parts" and press Enter
    Then the same sidenote now reads "Links matter more than parts", and there is no second one
    When I press Back, clear the field and press Enter
    Then that sidenote and its number are gone, and the Thoughts page no longer holds it

  Scenario: The end of the round, and Write it up
    Given the card shows "3 of 3"
    When I press Enter
    Then the card reads "3 of 3 recalled." with Write it up and Done
    When I press Write it up
    Then the page's essay opens beside the page (made the first time), and the card closes
    Given another round ends
    When I press Done or Esc
    Then the card closes

  Scenario: A week of quiet after a recall
    Given I went through two of the three notes with Next and pressed Done
    Then the Thoughts page has a property `recalled` with one entry `{ thought, at }` per note I
      passed, `thought` being that sidenote's id and `at` the time
    And it shows nowhere as a property row: it is plain data on the Thoughts page
    When I come back four days later
    Then no recall row shows, though the page was last open three or more days ago
    When I come back eight days after the recall, the page last open three or more days ago
    Then the return row shows again
    Given a round where I press Esc on "1 of 3" without pressing Next
    Then nothing is added to `recalled`

  Scenario: Highlights count as noted things
    Given a page with one sidenote and one highlighted sentence, last open four days ago
    When I open it
    Then the return row reads "You noted 2 things here on <weekday>." with Recall
    And in the card the highlight reads as its sentence, with no quoted words under it
    When I type a line for the highlight and press Enter
    Then a new sidenote with my line is anchored to the highlighted words
    And `recalled` lists the highlight by its words: `{ quote, at }`

  Scenario: Today's row
    When I open Today
    Then among Today's tail rows one reads "3 things to recall in Notes on Thinking in Systems." with Open
    And there is no "You left Notes on Thinking in Systems mid-sentence" row: the recall row speaks for that page
    When I press Open
    Then "Notes on Thinking in Systems" opens beside Today, and its return row shows with Recall
    And Today's row reads as it did, as an Open row does

  Scenario: Today's row with several pages
    Given two more pages qualify, each with two or more noted things and last open three or more days ago
    When the next beat runs and I open Today
    Then the row reads "3 notes to recall, starting with <the most recent one>." with Open
    And Open opens that page beside Today

  Scenario: Today's row follows Tail's beat and expiry
    Given Today shows the recall row
    When I recall "Notes on Thinking in Systems" and the next beat runs
    Then the recall row is gone from Today
    And while I stay on Today, a beat changes nothing in front of me
    When Today showed the recall row on two days and I never pressed Open
    Then it stays out until the page changes: "Not asking again about Notes on Thinking in Systems for now."

  Scenario: Sidenotes stay private
    When a beat or a return row's turn is sent
    Then the stand-in's log holds the count of noted things and the page's words, never a note's words
