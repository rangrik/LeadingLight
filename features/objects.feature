Feature: Settings › Objects explains everything LeadingLight keeps
  One list in Settings says, for each kind of object and widget, what it is for, who makes it,
  what can change and where it shows, with a way to open its examples. It covers the kinds agents
  and the app make that New never offers. A kind backed by a type shows the type's current name,
  so a renamed or customised type reads as the person made it.

  Names used below:
  - Objects: the Settings section "Objects", after Properties
  - Show: the button on a kind's row that opens its list of pages, with how many there are

  Scenario: Every kind, explained
    When I open Settings › Objects
    Then it lists Project, Task, Agent profile, Agent and Report, each with what it is for,
      "Made by", "Changes" and "Shows in"
    And Report says agents make it, it never changes once published, and a correction is a new report

  Scenario: Examples open from the list
    Given an agent has published two reports
    When I press "Show 2" on Report
    Then Settings closes and the Reports list opens, listing both, with no "New report" button

  Scenario: A space's own types
    Given my space renamed Task to "To-do" and has its own type "Chore" with a Done property
    When I open Settings › Objects
    Then the task row reads "To-do, Chore", and Show opens "To-do"
