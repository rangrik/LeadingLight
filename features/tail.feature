Feature: Tail
  Tail reads along and offers one line I can nod at. It never asks, never writes into my words
  until I nod, and never moves anything. In a browser the stand-in plays the model and answers
  with the prototype's word rules; the timings are design mode (docs/TAIL.md).

  Names used below:
  - tail row: an icon, a muted sentence with names in the foreground, and one small verb button
  - the nod: the button, or ⌃↩ on the page in front, never under Settings, a dialog or a menu
  - suggestion: a tail row in the bar's Suggestions panel about a block I wrote (suggestions.feature)
  - ignored: a line that left with no nod: a suggestion whose page I left once the open panel had
    shown it thirty seconds (counted once; it stays under Elsewhere), the row above a page's title
    once I wrote, or a row I saw on Today that a beat no longer shows
  - "Garden plan": a page with three paragraphs, the last unfinished, edited yesterday
  - seeded: `__tail.seed()` has made Garden (a project), Sam (a person), "Garden plan", three ideas
    tagged in-the-middle from Tuesday to Thursday with no project, a task "Call Sam about the invoice
    before Friday" with no due date, and an untitled page from Friday starting "Soil for the back bed"

  Background:
    Given the app is open in a browser at 1440x900, seeded

  Scenario: Three lines at day start
    When I open Today
    Then under the day bar, below the daily card for the three ideas (suggestions.feature), there
      are three tail rows and nothing else new:
      | You left Garden plan mid-sentence yesterday.                    | Open      |
      | 3 ideas since Tuesday. 2 look like tasks for Garden.            | File them |
      | Call Sam about the invoice has no day.                          | Set Friday |
    And the rows are muted, the names in the foreground, each on one line
    And a name too long for the row ends in an ellipsis, and the words after it still show
    And the body placeholder sits below them, and nothing else on the page changed
    And no count shows in the sidebar
    When I write in Today's body
    Then the three rows stay where they are, and none counts as ignored
    When I click "3 ideas"
    Then the bar opens on Captures, and Today stays in its pane

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
    Given Today alone again, with its Type menu opened and closed with Escape
    When I press ⌃↩
    Then "Garden plan" opens beside Today the same way
    And while a menu, a dialog or the Type menu is still open, ⌃↩ does nothing

  Scenario: The lines expire at the next beat
    Given Today shows its three rows and I press nothing
    When I leave the app for ten seconds and come back
    Then the rows are made again from the records: the same three, no duplicates
    And while I stay on Today, a beat changes nothing in front of me
    When I have named the untitled page and filed the ideas myself
    Then the next beat shows only what is still true
    And a row that goes fades out over 150 ms, the last one too, before the room it took closes
    When a beat was held while I was on Today, and I then press File them
    Then leaving the window and coming back never brings "3 ideas since Tuesday" back

  Scenario: A suggestion after a pause, never while typing
    Given "Garden plan" is open with the sidebar and the Suggestions panel open
    When I type "Need to call Sam about the invoice before Friday." on a new line and keep typing
    Then nothing appears
    When I stop for three seconds
    Then "On this page" lists "Make this a task?" with Make task
    And nothing appeared in the text, the text did not narrow, the sidebar did not collapse, and nothing scrolled
    When I press Enter after the line, write "The shed roof leaks again." below it, and stop for a minute
    Then the row is still there, and nothing counts as ignored
    When I type again on the same line
    Then the row leaves, and nothing counts as ignored
    When I stop again for three seconds
    Then the row is back, since those are new words
    When I write "Email Sam the soil order before Monday." on a new line and press Enter after it
    Then a second row, for that line, shows at once under the first
    When I open another page at once
    Then both rows are under Elsewhere, and neither counts as ignored, since the panel showed them under thirty seconds
    When the panel has shown a row thirty seconds and I open another page
    Then it is under Elsewhere and counts as ignored, once

  Scenario: A line that only looks like a task
    Given "Garden plan" is open
    When I type "Friday was warm and the beans came up." and stop for three seconds
    Then nothing appears, and the stand-in's log holds no pause turn

  Scenario: Nodding makes the task
    Given "Make this a task?" shows under On this page for the line
    When I press ⌃↩
    Then the line becomes a link to a new task "Call Sam about the invoice before Friday" with a checkbox
    And the task's due date is this Friday, and it is linked to Sam
    And the row reads "Made a task, due Friday." with Undo, then leaves after eight seconds
    And typing on keeps it and its Undo for those eight seconds, and Undo keeps what I typed since
    When I press Undo while it shows
    Then the page is exactly as it was before the nod, and the task page is gone
    And the row leaves, and that line gets no offer again until its words change

  Scenario: A word that is a page's name
    Given "Garden plan" is open, with People off in Reads on as it is by default
    When I type "Sam says the beans want more wind cover." and stop for three seconds
    Then the panel lists "Sam has a page." with Link
    When I press Link
    Then "Sam" in that line is a link to the person, and the row reads "Linked." with Undo

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
    When I open another page and come back three times without typing
    Then the row shows each time, and nothing counts as ignored

  Scenario: The capture box guesses
    When I open New idea and type "fix the gate latch before the weekend"
    Then after a short pause the project button reads "Garden?" in muted text
    And the footer offers "⌃↩ Task in Garden" before "⌘↩ Save"
    When I press ⌃↩
    Then the box closes, and Today lists "fix the gate latch before the weekend" as a task in Garden
    When I open New idea and type "a book about soil microbes"
    Then the project button reads "Garden?" and the footer offers "⌃↩ In Garden", since it is not a task
    When I press ⌃↩
    Then the box closes, and it is saved as an idea in Garden; this and the task each count as a nod
    When I open New idea, type "a recipe for lentil soup" and press ⌘↩
    Then it is saved as an idea with no project, as before, and nothing from tail shows
    When I open New idea and type "Grammar notes"
    Then the log holds no capture turn, since the guess waits for three words

  Scenario: The guess lands while I type
    Given the model takes two seconds to answer
    When I open New idea, type "fix the gate latch" and stop for a second
    Then the log holds one capture turn, for those words
    When I type " before the weekend" while it thinks and stop
    Then no second turn starts while the first runs
    And when the first answers, "Garden?" shows, though the words changed since
    And then a second turn asks about "fix the gate latch before the weekend", since three words changed
    When I add one word and stop
    Then no turn starts, since fewer than three words changed

  Scenario: The guess yields to my choice
    Given New idea is open with "fix the gate latch" typed and "Garden?" showing
    When I pick the project "House" myself
    Then the button reads "House" with no "?", and the footer's ⌃↩ offer says "Task in House"
    Given New idea is open with "a book about soil microbes" typed and "Garden?" showing
    When I pick the project "House" myself
    Then the footer shows no ⌃↩ line, since ⌘↩ already saves it in House

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
    Then no suggestion shows
    When I write "Sam says the beans want more wind cover." on "Garden plan" and stop
    Then "Sam has a page." still shows, since a title is what I type to link and the sidebar shows it anyway
    And the next beat sends no Person page's summary or words, and the stand-in's log holds none

  Scenario: Sidenotes stay private
    Given "Garden plan" has a sidenote "Is gravel really needed?" that was never sent as feedback
    When a beat runs and a suggestion is offered on that page
    Then no line quotes or refers to the note
    And the stand-in's log holds the page's words but not the note's

  Scenario: A beat sends a digest, not the space
    Given twenty pages, of which two changed since the last beat
    When a beat runs
    Then the stand-in's log shows a summary line per page and the body of the two that changed only
    And a body keeps the names of the pages it mentions, as "@Sam"
    And the same page's body is not sent again at the next beat unless it changed
    And each beat starts a new thread: the log shows it resumes none

  Scenario: A suggestion and the guess come from a tail turn
    When I write "Need to call Sam about the invoice before Friday." on "Garden plan" and stop
    Then the stand-in's log holds a pause turn: that line, the blocks around it, the page's
      title, type and properties, and the titles and types of every page, as the page's first; no body
    When I open New idea and type "fix the gate latch before the weekend"
    Then a second after I stop, the log holds a capture turn: those words, the projects and the
      last few captures, and "Garden?" shows only once it has answered
    And both turns ask for low effort, while a beat asks for the effort set in Settings
    And a page's turns share one thread, each resuming the one before, and the titles of every
      page go in its first turn only, then only those that changed

  Scenario: A wrong answer is silence
    Given the browser build is opened with ?tail=garbled, so the stand-in answers in words, not JSON
    When I open Today
    Then no tail row shows and no error shows, and the stand-in's log holds the beat that was sent

  Scenario: Ignored three times, quiet
    Given a Link suggestion on each of three Meeting pages, each shown in the open panel thirty
      seconds before I left its page
    When I write an unlinked name on a fourth Meeting page and stop
    Then no suggestion comes
    And the page about how I work has a dated line "Links on Meeting pages are quiet."
    When I delete that line
    Then the next unlinked name on a Meeting page gets its suggestion again
    Given Today showed "You left Garden plan mid-sentence yesterday." on two days and I nodded at neither
    Then the next beat leaves out that row, not its kind, and the page has a dated line
      "Not asking again about Garden plan for now." until Garden plan is edited or I delete the line

  Scenario: A new ledger lifts an older build's quiet
    Given an older build's ledger, and the page about how I work has "Offers to make a task on Daily
      note pages are quiet." beside "Most ideas go to Garden." and a line I wrote myself
    When this build starts
    Then the ledger holds no entries, the quiet line is gone, and the other two lines stay
    And a task-like line on Today gets its suggestion again

  Scenario: The page about how I work
    Given I have pressed File them for Garden three times
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
    Then Today's rows and the "you stopped at" row show, and no suggestion or capture guess does
    Given it is Normal
    Then all four surfaces work

  Scenario: The model, and its spend
    Given the Mac app with Codex signed in and Settings › AI › Tail on GPT-6.1 Sol at high
    When a beat runs
    Then the rows come from the model, each still one line with one verb
    And a task-like line, on Enter at its end or ten seconds after its full stop, gets its suggestion from the model
    And an Enter, or words in another paragraph, while the model thinks still brings it
    But changing that line's words while the model thinks brings none
    And the usage meter at the bottom of the sidebar moves for Codex
    Given Claude is chosen instead
    Then the beat runs through Claude Code the same way
