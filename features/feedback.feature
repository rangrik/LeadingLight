Feature: Sending feedback on an agent's work
  I read an agent's report where it shows, on the task, and write sidenotes on it as on any page.
  The words of the report can't change, but they take notes. Some notes I want the agent to
  answer, some are mine alone: I tick the ones to send and press Send on the task's card. There is
  no dialog. A remark about the work as a whole is a note on the task's own words, ticked like any
  other. Nothing I didn't tick ever reaches an agent. What is sent is kept as it was sent, with the
  words each note is about, so it reads the same if the report or note changes later.

  Names used below:
  - "Write the summary": a task assigned to Claude, with its report "Summary" (features/reports.feature)
  - tick: the checkbox at the start of a note, on a task with an agent or a report of such a task
  - "Send 3 notes": the button on the task's card while notes are ticked, with how many; on a
    report's own page the same button sits in the header
  - stream: the reports and sent feedback under the task's own words, newest first

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Write the summary" is assigned to Claude, and "Summary" is published to it

  Scenario: Notes on the report where it shows
    Given "Write the summary" is open
    When I select a sentence of "Summary" under the brief and press Add sidenote (or ⌘⇧M)
    Then a note opens in the margin level with the sentence, as on any page
    And typing in the report itself changes nothing; its selection bar there offers only Add sidenote
      (Ask stays on the report's own page, where it can point at the report's words)
    And opening "Summary" as its own page shows the same note; a note written there shows on the task
    When "Summary" is open on its own page beside the task and I write a note in each
    Then both notes are kept, on both

  Scenario: Choose which notes go
    Given I wrote four notes on "Summary", from the task
    Then each note has a tick, labelled "Send note 1 on “Summary” to Claude" and so on
    When I tick notes 1, 2 and 3
    Then the card shows "Send 3 notes"
    When I open another page and come back, or reload
    Then notes 1, 2 and 3 are still ticked, and note 4 isn't

  Scenario: A remark on the whole
    When I select the brief's first sentence on "Write the summary", add a note "Keep it short." and tick it
    Then the card counts it: "Send 4 notes"

  Scenario: Send once
    Given notes 1, 2 and 3 on "Summary" and the note on the brief are ticked
    When I press "Send 4 notes"
    Then it is sent at once, no dialog, and a toast says "Sent to Claude"
    And the stream of "Write the summary" shows "You sent feedback · 4 points to Claude · Sent", with
      the four notes and the words each is about
    And the four notes show "Sent" where their ticks were, and the button is gone

  Scenario: Private notes stay private
    Given note 4 was never ticked
    Then the agent's message has notes 1, 2 and 3 and not note 4
    And reading the report's Thoughts page through LeadingLight's tools shows the sent notes only,
      and says one note is private

  Scenario: The answer lands on the task
    When the agent answers the batch with one publish
    Then its response shows on the task newest first, saying it answers my feedback, with a part
      per point (response.feature), and the Feed says Claude answered my feedback

  Scenario: Sent as it was
    Given a batch was sent
    When I change note 1 afterwards, or the agent publishes a new report
    Then the batch still shows note 1 as sent, with the words it was about
    And an agent reading the Thoughts page reads note 1 as it was sent, not as changed

  Scenario: Delivery that fails
    Given the agent's conversation can't be reached
    When I press Send
    Then the stream shows "Not sent" and why, with Try again, and the notes say "Not sent", not "Sent"
    When it can be reached again and I press Try again
    Then it says "Sent", and the agent has the batch once

  Scenario: Never to another agent
    Given the task's agent's conversation was removed from the runtime
    When I press Send
    Then it says it can't be told, and no other agent or chat gets it

  Scenario: Feedback is explained in Settings
    When I open Settings › Objects
    Then Feedback says I make it by ticking notes and pressing Send on the task, it never changes
      once sent, and where it shows
