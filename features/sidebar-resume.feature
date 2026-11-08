Feature: Resume rows in the sidebar
  A "Resume" group sits directly under Today and leads back to work: up to three rows, made
  from the records each time the sidebar draws (nothing is stored, as with the Feed). Pinned and
  Recent come next, then Types, which folds.

  Names used below:
  - Resume: navigation "Resume", under Today, Calendar and Browser
  - a row's first line: the page's icon and title; its second line: 12 px, muted, the page's
    project when it has one, then what changed since you left, joined by " · "
  - a page's project: a page it links to through a relation property of type Project; a
    Project page is its own project and doesn't name itself
  - your pages: every page except daily notes, tags, templates, the app's own pages (agents,
    reports, feedback) and tasks given to an agent (those come back through the second row)

  The rows, in order, never the same page twice:
  1. Where you were: the page among your pages with the latest edit.
  2. What needs you: the task whose agent most recently asked a question, asked for approval
     or said it is ready for review, from the Feed's items, newest first. None, no row.
  3. The other thread: the page among your pages with the latest edit whose project differs
     from row 1's (no project counts as one). None, no row.

  The second line says, in this order of choice:
  - "Asks a question" (or "Asks for approval") when the task's agent waits on you
  - "Report ready" when the task's agent says it is ready for review
  - "Report arrived" when a report on the page came after your last edit of it
  - else when you last edited it, as "2 hours ago" or "yesterday"

  Background:
    Given the app is open in a browser at 1280x900

  Scenario: The demo space
    Given the demo space ("?mac&demo")
    Then Resume shows three rows:
      | row                          | second line                     |
      | LeadingLight                 | 2 hours ago                     |
      | Write the pricing page copy  | LeadingLight · Asks a question  |
      | Read chapter 3 of Thinking in Systems | 2 hours ago            |
    And "Fix the tab row overflow", edited 50 minutes ago, isn't row 1: Codex has it
    And Recent and Pinned come before Types, and at 900 px the first Recent rows show without
      scrolling

  Scenario: Where you were
    Given I edit "Pricing notes" and then "Feedback loops"
    Then row 1 is "Feedback loops", and its second line reads "just now"
    When I edit "Pricing notes" again
    Then row 1 is "Pricing notes"
    And a daily note, a tag or a report edited later never takes row 1

  Scenario: A report arrived after you left
    Given I last edited "Pricing notes" an hour ago
    When an agent publishes a report on "Pricing notes" that isn't ready for review
    Then the row for "Pricing notes" reads "Report arrived" on its second line

  Scenario: What needs you
    Given two tasks with agents: "A" asked a question 6 minutes ago, "B" is ready for review
      since 55 minutes ago
    Then row 2 is "A", reading "<project> · Asks a question"
    When I answer "A"'s question
    Then row 2 is "B", reading "Report ready"
    When I accept "B"
    Then there is no second row, and the third row moves up

  Scenario: The other thread
    Given row 1 is a page in project "LeadingLight"
    Then row 3 is the latest page that isn't in "LeadingLight", such as a reading note with no
      project
    Given row 1 has no project
    Then row 3 is the latest page in any project
    And when every page shares row 1's project, there is no third row

  Scenario: No duplicates
    Given my latest edit is in a task whose agent asks a question
    Then that task is row 2, never also row 1
    And no page shows in two Resume rows

  Scenario: Opening a row
    When I click a Resume row
    Then its page opens in the focused card and the row shows as current
    When I Shift-click another Resume row
    Then it opens beside the one in front
    When I ⌘-click a row
    Then it opens in a new tab
    And dragging a row beside the open page opens it there, as with Recent's rows

  Scenario: An empty space
    Given a new, empty space with only today's daily note
    Then there is no Resume group and no "Resume" label
    When I create a page and type in it
    Then Resume shows it as its only row

  Scenario: Types folds
    Then Types sits below Recent, open, with a chevron after its label
    When I click the "Types" label
    Then its rows fold away in 200 ms and the chevron turns
    When I reload
    Then Types is still folded
    When I click it again
    Then its rows show again

  Scenario: Nothing else moves
    Then Today, Calendar and Browser are still the first three rows
    And Recent's sort and New page, row menus, rename, the footer and the bar work as before
