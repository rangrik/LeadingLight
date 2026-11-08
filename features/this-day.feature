Feature: What a day's note shows of the day
  Returning to any day shows which pages were made that day and which were edited that day, so
  the day's note is the record of the day even when nothing was written in it. A page keeps the
  days it was touched whatever it becomes later.

  Names used below:
  - "This day": the section at the end of a daily note, in place of "Created this day"
  - row: the page's icon and title, then "made" or "edited", then the time, most recent first

  Background:
    Given the app is open in a browser at 1280x800

  Scenario: Made and edited
    Given on Tuesday I made "Pricing page" at 10:12 and edited "Kickoff", made on Monday, at 15:40 or 3:40 PM,
      as the locale has it
    When I open Tuesday's note
    Then "This day · 2" lists "Kickoff · edited · 15:40" then "Pricing page · made · 10:12",
      each time as the locale has it
    And Monday's note lists "Kickoff · made"
    And pages the note's own words link are left out, as before; so are tags, daily notes, pages
      the app makes (agents, reports, feedback) and pages that belong to another (Thoughts, essays)

  Scenario: Edited on two days
    Given "Kickoff" was edited on Tuesday and again on Thursday
    Then Tuesday's note and Thursday's note both list it as edited

  Scenario: A converted idea stays on its day
    Given "Pricing page", made Tuesday, was assigned on Thursday and became a Task (assign.feature)
    Then Tuesday's note still lists it as made, now with the Task icon; Thursday's lists it as edited

  Scenario: Today, live
    Given today's note is open beside "Kickoff"
    When I type in "Kickoff"
    Then "This day" lists "Kickoff · edited" as soon as the edit is saved, without the note scrolling

  Scenario: A page made and edited the same day
    When I make "Draft" and edit it an hour later
    Then the day lists it once, as "made", at the time it was made
