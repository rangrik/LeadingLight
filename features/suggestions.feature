Feature: Suggestions
  Tail's offers live in the bar's Suggestions panel, not in the text. Tail reads a block when I finish
  it: Enter at its end, a full stop followed by ten seconds of quiet, or twenty seconds of quiet in any
  case; both numbers are in Settings › AI › Tail, and a browser's design mode starts them at three and
  five. A block is judged once per wording and never sent again while its words stand. A new offer raises the count on the Suggestions icon and moves
  nothing in the text. Today's rows and the daily card are on Today itself.

  Names used below:
  - a suggestion row: tail's row (tail.feature), with the words it is about in the foreground; hovering or
    selecting it lights those words in the page; the nod is on the row, and Undo after it
  - "On this page" / "Elsewhere": the panel's two groups; Elsewhere holds offers about other pages and
    the day's rows, each opening its page beside when clicked. On Today, the day's rows are under the
    day bar and not in the panel, so On this page holds only offers about the note's own blocks
  - seen: a suggestion the panel has shown while open; counts are of unseen ones
  - the daily card: on Today, once a day, when earlier days left suggestions or unreviewed captures:
    "Yesterday left 4 things." when all are from yesterday, else "Left over: 5 things.", with Go
    through, Dismiss all and Hand off

  Background:
    Given the app is open in a browser at 1440x900, seeded as in tail.feature

  Scenario: A finished block is read once
    Given "Garden plan" is open and the panel is collapsed
    When I type "Need to call Sam about the invoice before Friday." and press Enter
    Then within a moment the Suggestions icon shows 1 and nothing in the text changes
    When I open Suggestions
    Then "On this page" lists "Make this a task?" with Make task, the count goes, and hovering the row lights the line
    When I press Make task
    Then the line becomes the task, the row reads "Made a task, due Friday." with Undo, and leaves after eight seconds
    When I type the same line again on a new paragraph and press Enter
    Then no turn is sent, since those words were judged already

  Scenario: Quiet after a full stop, and the fallback
    When I type "Ask Sam about the beans." and stop
    Then after ten seconds the block is read, and the count goes up if it is worth a line
    When I type "Ask Sam about the stakes" with no full stop and stop
    Then after twenty seconds it is read
    When I set Settings › AI › Tail › Read a block after to 5 and 8 seconds
    Then the next two blocks are read after five and eight seconds

  Scenario: Nothing is sent twice
    Given the stand-in's log is open
    When I finish three blocks on one page, then go back and change the words of the second
    Then the log holds four turns, one per wording, and the index of titles only in the first
    And while a turn runs, a second finished block waits and goes only if its words are still new

  Scenario: Elsewhere
    Given Today's beat left "You left Garden plan mid-sentence yesterday." and I am on "Sam"
    When I open Suggestions
    Then "Elsewhere" lists that row with Open, and clicking the name opens "Garden plan" beside "Sam"
    When I open Today and write "Call Sam before Friday." in its body and press Enter
    Then "On this page" lists only "Make this a task?", and the day's three rows show under the day
      bar and nowhere in the panel
    When the window is 1000 px wide and Suggestions is a pane
    Then its group labels and rows start under the pane's title

  Scenario: Chips are gone
    When a block is read and judged worth a line
    Then no chip appears beside it in the margin or after its words, and the row above the title is not used

  Scenario: The daily card
    Given seeded, with its three ideas from last week unreviewed
    When I open Today
    Then under the day bar a card reads "Left over: 3 things." with Go through, Dismiss all and Hand off
    Given yesterday left two suggestions and two unreviewed captures, and nothing older waits
    When I open Today
    Then the card reads "Yesterday left 4 things."
    When I press Dismiss all
    Then the captures are reviewed, the suggestions are gone, nothing is counted as ignored, and the card leaves
    When the card shows again another day and I press Go through
    Then the first item opens beside Today, and the card counts down as I act on each
    When I press Hand off, with Projects on
    Then a task "Review yesterday's leftovers" is assigned to an agent whose brief names each item and the pages it links to, and the card reads "Handed to an agent" until its report comes back under Feed
    And with Projects off, Hand off is muted with "Needs Projects on in Settings"
