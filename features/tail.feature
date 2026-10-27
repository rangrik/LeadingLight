Feature: Tail
  Tail reads along and offers one line I can nod at. It never asks, never writes into my words
  until I nod, and never moves anything. In a browser the stand-in plays the model and answers
  with the prototype's word rules; the timings are design mode (docs/TAIL.md).

  Names used below:
  - tail row: an icon, a muted sentence with names in the foreground, and one small verb button
  - the nod: the button, or ⌃↩ on the page in front
  - chip: a tail row's words placed in the margin beside a line, like a sidenote, with the nod under them
  - ignored: a line that left with no nod: a chip that expired, or whose page I left or wrote on
    elsewhere, or a row I saw on Today that a beat no longer shows
  - "Garden plan": a page with three paragraphs, the last unfinished, edited yesterday
  - seeded: `__tail.seed()` has made Garden (a project), Sam (a person), "Garden plan", three ideas
    tagged in-the-middle from Tuesday to Thursday with no project, a task "Call Sam about the invoice
    before Friday" with no due date, and an untitled page from Friday starting "Soil for the back bed"

  Background:
    Given the app is open in a browser at 1440x900, seeded

  Scenario: Three lines at day start
    When I open Today
    Then under the day bar there are three tail rows and nothing else new:
      | You left Garden plan mid-sentence yesterday.                    | Open      |
      | 3 ideas since Tuesday. 2 look like tasks for Garden.            | File them |
      | Call Sam about the invoice has no day.                          | Set Friday |
    And the rows are muted, the names in the foreground, each on one line
    And a name too long for the row ends in an ellipsis, and the words after it still show
    And the body placeholder sits below them, and nothing else on the page changed
    And no count shows in the sidebar

  Scenario: A nod files the ideas, and Undo takes it back
    Given Today shows its three rows
    When I press File them
    Then within a moment that row reads "Filed 2 as tasks in Garden." with an Undo button
    And "fix the gate latch before the weekend" and "ask Sam about the invoice" are now tasks in Garden
    And "a book about soil microbes" is still an idea
    When I press Undo
    Then the two are ideas again with no project, and the row reads as it first did
    When I press File them and wait eight seconds
    Then Undo is gone and the row still reads "Filed 2 as tasks in Garden.", so the other two rows have not moved
    When I leave Today and come back, or the next beat runs
    Then the done row is gone

  Scenario: A nod sets the day
    When I press Set Friday on Today
    Then "Call Sam about the invoice before Friday" has its due date on this Friday
    And the row reads "Due Friday." with Undo

  Scenario: Open goes beside
    When I press Open on the first row
    Then "Garden plan" opens beside Today, and Today stays where it was

  Scenario: The lines expire at the next beat
    Given Today shows its three rows and I press nothing
    When I leave the app for ten seconds and come back
    Then the rows are made again from the records: the same three, no duplicates
    And while I stay on Today, a beat changes nothing in front of me
    When I have named the untitled page and filed the ideas myself
    Then the next beat shows only what is still true
    When a beat was held while I was on Today, and I then press File them
    Then leaving the window and coming back never brings "3 ideas since Tuesday" back

  Scenario: A chip beside the line, after a pause, never while typing
    Given "Garden plan" is open with the sidebar open
    When I type "Need to call Sam about the invoice before Friday." on a new line and keep typing
    Then nothing appears
    When I stop for three seconds
    Then a chip appears in the margin, level with that line: "Make this a task?" over a "Make task" button and ⌃↩
    And the text did not narrow, the sidebar did not collapse, and nothing scrolled
    When I type again on the same line
    Then the chip leaves
    When I stop again for three seconds
    Then the chip is back

  Scenario: A line that only looks like a task
    Given "Garden plan" is open
    When I type "Friday was warm and the beans came up." and stop for three seconds
    Then nothing appears, and the stand-in's log holds no pause turn

  Scenario: Nodding the chip makes the task
    Given the chip "Make this a task?" shows beside the line
    When I press ⌃↩
    Then the line becomes a link to a new task "Call Sam about the invoice before Friday" with a checkbox
    And the task's due date is this Friday, and it is linked to Sam
    And the chip reads "Made a task, due Friday." with Undo, then leaves after eight seconds
    When I press Undo while it shows
    Then the page is exactly as it was before the nod, and the task page is gone

  Scenario: A word that is a page's name
    Given "Garden plan" is open, with People off in Reads on as it is by default
    When I type "Sam says the beans want more wind cover." and stop for three seconds
    Then the chip reads "Sam has a page." over Link
    When I press Link
    Then "Sam" in that line is a link to the person, and the chip reads "Linked." with Undo

  Scenario: Only one chip, and a narrow pane uses the row
    Given "Garden plan" is open beside Today, so neither pane has margin room
    When I type a task-like line and stop
    Then no chip appears in the margin; instead a tail row above the title quotes the line and offers Make task
    And the text column is as wide as before, and the words did not move

  Scenario: Coming back to a page
    Given "Garden plan" was last edited at "ask Sam whether the"
    When I open another page, wait ten seconds, and open "Garden plan" again
    Then a tail row above its title reads: You stopped at "ask Sam whether the". with a Show button
    And the title and the words are where they always are, and Add icon and Add cover wait while it shows
    When I press Show
    Then the page scrolls to that paragraph and it is lit for a moment, even when an earlier
      paragraph ends in the same words
    When I type anything in the body
    Then the row leaves, and the words do not move

  Scenario: The capture box guesses
    When I open New idea and type "fix the gate latch before the weekend"
    Then after a short pause the project button reads "Garden?" in muted text
    And the footer offers "⌃↩ Task in Garden" before "⌘↩ Save"
    When I press ⌃↩
    Then the box closes, and Today lists "fix the gate latch before the weekend" as a task in Garden
    When I open New idea, type "a book about soil microbes" and press ⌘↩
    Then it is saved as an idea with no project, as before, and nothing from tail shows

  Scenario: The guess yields to my choice
    Given New idea is open with "fix the gate latch" typed and "Garden?" showing
    When I pick the project "House" myself
    Then the button reads "House" with no "?", and the footer's ⌃↩ offer says "Task in House"

  Scenario: Quiet
    Given a page with three paragraphs of prose and no task-like line or unlinked name
    When I write in it for a while, with pauses
    Then tail shows nothing at all

  # The scenarios below are the real build (docs/PROJECT-3.md): the model behind the lines, what it
  # may read, and what it remembers. In a browser the stand-in plays the model and logs what was sent.

  Scenario: Every line names what it read
    When Today shows its rows
    Then each row names the page it read, in the foreground, and clicking the name opens that page
    And a count such as "3 ideas" is a name too: clicking it opens the list of those pages
    And no row refers to a page that isn't named in it

  Scenario: Tail reads only the types I tick
    Given Settings › AI › Tail › Reads on has People unticked
    When I write "Need to call Sam about the invoice before Friday." on Sam's page and stop
    Then no chip appears
    When I write "Sam says the beans want more wind cover." on "Garden plan" and stop
    Then "Sam has a page." still shows, since a title is what I type to link and the sidebar shows it anyway
    And the next beat sends no Person page's summary or words, and the stand-in's log holds none

  Scenario: Sidenotes stay private
    Given "Garden plan" has a sidenote "Is gravel really needed?" that was never sent as feedback
    When a beat runs and a chip is offered on that page
    Then no line quotes or refers to the note
    And the stand-in's log holds the page's words but not the note's

  Scenario: A beat sends a digest, not the space
    Given twenty pages, of which two changed since the last beat
    When a beat runs
    Then the stand-in's log shows a summary line per page and the body of the two that changed only
    And a body keeps the names of the pages it mentions, as "@Sam"
    And the same page's body is not sent again at the next beat unless it changed

  Scenario: A chip and the guess come from a tail turn
    When I write "Need to call Sam about the invoice before Friday." on "Garden plan" and stop
    Then the stand-in's log holds a pause turn: that line, the blocks around it, the page's
      title, type and properties, and the titles and types of pages tail may read, and no body
    When I open New idea and type "fix the gate latch before the weekend"
    Then 600 ms after I stop, the log holds a capture turn: those words, the projects and the
      last few captures, and "Garden?" shows only once it has answered

  Scenario: A wrong answer is silence
    Given the browser build is opened with ?tail=garbled, so the stand-in answers in words, not JSON
    When I open Today
    Then no tail row shows and no error shows, and the stand-in's log holds the beat that was sent

  Scenario: Ignored twice, quiet
    Given a Link chip on a Meeting page that I ignored, and another on a second Meeting page
    When I write an unlinked name on a third Meeting page and stop
    Then no chip appears
    And the page about how I work has a dated line "Links on Meeting pages are quiet."
    When I delete that line
    Then the next unlinked name on a Meeting page gets its chip again

  Scenario: The page about how I work
    Given I have pressed File them for Garden on three days
    When I open the page from Settings › AI › Tail
    Then it holds dated sentences, among them one like "Most ideas go to Garden."
    And it never exceeds about forty lines
    When I change a line to "Most ideas go to House." and a beat runs
    Then the next filing offer names House
    And the page never shows in New, and search finds it

  Scenario: The last beat, in Settings
    When I open Settings › AI › Tail
    Then the Last beat row says when the last beat ran and how many lines it gave, as "10:32, 3 lines"
    When I press Run now
    Then a beat runs at once, and the row gives its time
    Given the browser build is opened with ?tail=garbled
    Then the row reads "Didn't go: the answer wasn't JSON" with the time

  Scenario: Off, Quiet, Normal
    Given Settings › AI › Tail is Off
    Then nothing from tail shows anywhere, and no beat runs, without a reload
    Given it is Quiet
    Then Today's rows and the "you stopped at" row show, and no chip or capture guess does
    Given it is Normal
    Then all four surfaces work

  Scenario: The model, and its spend
    Given the Mac app with Codex signed in and Settings › AI › Tail on GPT-6.1 Sol at high
    When a beat runs
    Then the rows come from the model, each still one line with one verb
    And a task-like line, after twenty seconds without typing, gets its chip from the model
    And the usage meter at the bottom of the sidebar moves for Codex
    Given Claude is chosen instead
    Then the beat runs through Claude Code the same way
