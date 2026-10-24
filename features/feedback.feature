Feature: Sending feedback on an agent's work
  I read an agent's report at my own pace and write sidenotes on it, as on any page. The words of
  the report can't change, but they take notes. Some notes I want the agent to answer, some are
  mine alone: I tick the ones to send, add an overall comment if I like, and send them once, to the
  agent given the task. Nothing I didn't tick ever reaches an agent. What is sent is kept as it was
  sent, with the words each note is about, so it reads the same if the report or note changes later.

  Names used below:
  - "Write the summary": a task assigned to Claude, with its report "Summary" (features/reports.feature)
  - tick: the checkbox at the start of a note, on a page whose task has an agent
  - Send feedback: the button in the page's header while notes are ticked, with how many
  - stream: the reports and sent feedback after the task's own words, in order

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Write the summary" is assigned to Claude, and "Summary" is published to it

  Scenario: Notes on a report
    When I open "Summary", select a sentence and press Add sidenote (or ⌘⇧M)
    Then a note opens beside the sentence, as on any page
    And typing in the report itself changes nothing; its selection bar offers only Add sidenote and Ask

  Scenario: Choose which notes go
    Given I wrote four notes on "Summary"
    Then each note has a tick, labelled "Send note 1 to Claude" and so on
    When I tick notes 1, 2 and 3
    Then the header shows "Send feedback · 3"
    When I open another page and come back, or reload
    Then notes 1, 2 and 3 are still ticked, and note 4 isn't

  Scenario: See who gets what, then send once
    Given notes 1, 2 and 3 are ticked
    When I press Send feedback
    Then a dialog says "Send feedback to Claude", lists the three notes with the words each is about,
      and has an optional Overall comment
    When I leave out note 3 with its ×, write "Keep it short." and press "Send 2 notes"
    Then the dialog closes, saying it was sent to Claude
    And the stream of "Write the summary" shows "You sent feedback · 2 points to Claude · Sent", with
      both notes and the comment
    And the two notes show "Sent" where their ticks were, and Send feedback is gone

  Scenario: Private notes stay private
    Given note 4 was never ticked
    Then the agent's message has notes 1 and 2 and not note 4
    And reading the report's Thoughts page through LeadingLight's tools shows notes 1 and 2 only,
      and says one note is private

  Scenario: Sent as it was
    Given a batch was sent
    When I change note 1 afterwards, or the agent publishes a new report
    Then the batch still shows note 1 as sent, with the words it was about
    And an agent reading the Thoughts page reads note 1 as it was sent, not as changed

  Scenario: Delivery that fails
    Given the agent's conversation can't be reached
    When I send feedback
    Then the stream shows "Not sent" and why, with Try again, and the notes say "Not sent", not "Sent"
    When it can be reached again and I press Try again
    Then it says "Sent", and the agent has the batch once

  Scenario: Never to another agent
    Given the task's agent's conversation was removed from the runtime
    When I send feedback
    Then it says it can't be told, and no other agent or chat gets it

  Scenario: Feedback is explained in Settings
    When I open Settings › Objects
    Then Feedback says I make it by ticking notes, it never changes once sent, and where it shows
