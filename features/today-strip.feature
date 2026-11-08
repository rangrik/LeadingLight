Feature: Today says where things stand
  Opening Today answers "what is going on?" before anything else: which projects have agents at
  work and what each wants from me, where I was yesterday, and what this day holds so far. All of
  it reads from the records (tasks, agents, the Feed); nothing is written into the note.

  Names used below:
  - the strip: the rows under Today's day bar, above the daily card and Tail's rows, one per
    project in motion
  - in motion: a project with a task at work that isn't done; at work as in the project's Work
    table (work-table.feature): the task has an agent, or subtasks with agents
  - a row: the project's icon and name, then its counts in words, muted, then at most one button
    at the right edge, 14 px text on a 24 px line, like Tail's rows
  - counts: "N needs you · N ready · N working · N idle", zeros left out; working includes
    starting, idle includes stopped (task-work.feature)

  Background:
    Given the app is open in a browser at 1280x800 at "/?mac&demo"
    And LeadingLight has "Write the pricing page copy" (needs your input), "Audit the empty states"
      (ready for review), "Fix the tab row overflow" (working) and "Rename Pages to Notes" (done)
    And Home office has "Compare three desk lamps" (ready for review)

  Scenario: One row per project in motion, most urgent first
    When I open Today
    Then under the day bar the strip shows two rows, in this order:
      | project     | counts                              | button |
      | LeadingLight | 1 needs you · 1 ready · 1 working | Answer |
      | Home office | 1 ready                             | Accept |
    And a project ranks by its most urgent task: needs you, then ready, then working, then idle;
      two of the same rank, the one changed last first
    And the project's name is in the foreground, its counts muted, each row's button flush right
    And the done task is not counted

  Scenario: The name opens the project
    When I click "LeadingLight" in the strip
    Then the LeadingLight project opens in this pane
    When I go back to Today and Shift-click "Home office"
    Then Home office opens beside Today

  Scenario: Answer opens the Feed on the question
    When I press "Answer" on LeadingLight's row
    Then the bar opens on the Feed with "Claude asks: Should the pricing page lead with the monthly
      or the yearly price?" open and focused, as the Work table's Answer does

  Scenario: Accept accepts the ready task's own report
    When I point at "Accept" on Home office's row
    Then a tooltip says "Accept “Compare three desk lamps”"
    When I press it
    Then "Compare three desk lamps" is done and accepted with its agent's last report, as Accept
      on the task does (accept.feature)
    And Home office has nothing in motion, so its row goes; LeadingLight's stays

  Scenario: One button, the most urgent
    Given a project with a task that needs me and another ready for review
    Then its row shows "Answer" only
    Given a project whose ready task still has open subtasks
    Then its row shows no button, as the Work table shows no Accept
    Given a project whose tasks are only working or idle
    Then its row shows no button

  Scenario: States follow the runtime
    Given the strip shows LeadingLight's "1 working"
    When that agent stops working and its report is not ready
    Then the counts read "1 idle" in its place within a moment, without a reload and without the
      page moving

  Scenario: Nothing in motion
    Given no project has a task at work that isn't done
    When I open Today
    Then there is no strip and no empty row in its place

  Scenario: Where I was yesterday
    Given the last pages I was in yesterday are "Notes on Thinking in Systems" and "Design review
      with Sam", as yesterday's This day lists them, and I haven't edited either since
    When I open Today
    Then under the strip one muted line reads "Yesterday you were in Notes on Thinking in Systems
      and Design review with Sam", the two titles in the foreground
    When I click "Notes on Thinking in Systems"
    Then it opens in this pane; Shift-click opens it beside
    When I edit it and come back to Today
    Then the line is gone: I have picked up where I was

  Scenario: Nothing from yesterday
    Given I edited nothing yesterday
    Then there is no yesterday line
    And pages This day leaves out (tags, daily notes, agents, reports, pages under a page) never
      show in it

  Scenario: This day, folded under the strip
    When I open Today
    Then under the yesterday line a row reads "This day · N" with a chevron at its left, folded
    And the end of the note no longer has a This day section
    When I click it
    Then it opens in place, over 200 ms, to the rows This day lists (this-day.feature), and the
      chevron turns
    When I reload, or open another day
    Then This day is still open; folding it is remembered the same way
    And it keeps following the day live: a page I edit beside Today joins its rows and its count

  Scenario: Past days
    When I open yesterday's note
    Then there is no strip and no yesterday line, since they are about now
    And "This day · N" sits directly under the day bar, folded or open as I left it

  Scenario: No counts on a daily note
    Given Counts is on in the Writing menu
    When I open Today
    Then the pane's header shows no word count, reading time or part-of-speech dots
    When I open "Notes on Thinking in Systems"
    Then its header shows them as before (writing.feature)
