Feature: Desk
  A home view apart from the daily note: where I was, what each project's agents are doing, today's
  words and what I captured, on one calm page. It opens at launch when no panes come back.

  Names used below:
  - "Desk": the sidebar row above "Today" (layout-dashboard icon), and the pane it opens, whose
    header reads "Desk"
  - card: a region named by its title: "Continue", one per project in motion named by the
    project, "Today", "Captures to file"
  - the cards sit in a grid of at most two columns, 16 px apart, 24 px from the pane's edges

  Background:
    Given the browser build is open at "/?mac&demo" at 1280x800, with the demo space

  Scenario: The row and the key
    When I click "Desk" in the sidebar
    Then the focused pane shows the Desk, its header reads "Desk" and the "Desk" row is marked current
    When I open "Pricing notes" from Recent, then press ⌘1
    Then the Desk shows again in that pane
    And Keyboard shortcuts (⌘⌥/) lists ⌘1 under Go as "Where things stand: your pages, projects,
      today and captures", and the Mac menu bar's Go menu as "Desk"
    # ⌘0 is Actual size, so the Desk takes ⌘1.

  Scenario: Shift-click opens it beside
    Given "Pricing notes" is open
    When I Shift-click "Desk" in the sidebar
    Then the Desk opens in a pane beside "Pricing notes", and "Pricing notes" stays where it was

  Scenario: The cards, in order
    When I open the Desk
    Then the cards read, in order: "Continue", "LeadingLight", "Today", "Captures to file"
    And they sit where they end up from the first frame: no card moves to another row as the page
      loads (the project card waits for the runtime with its rows hidden, not missing)
    And two columns only from a pane about 900 px wide; narrower, one column, nothing cut or clipped
    And "Home office" has no card: none of its tasks has an agent

  Scenario: Continue
    When I open the Desk
    Then "Continue" lists three pages, most recently edited first: "Notes on Thinking in Systems",
      "Thinking in Systems", "Design review with Sam"
    And each row shows the page's icon and title, then in muted text its project's name if it has
      one and when it was edited ("3 hours ago", "yesterday")
    And "Design review with Sam" says "LeadingLight · " and when it was edited
    And "Notes on Thinking in Systems" says, under it, "You stopped at “feedback loop is that”":
      its last paragraph ends mid-sentence, as Tail reads it; Tail set to Off, or a type it may not
      read, shows no such line, and a list item without a full stop never counts
    And daily notes, tags, reports, agents, templates, tasks, captures still to file and projects
      with a card are never listed

  Scenario: Continue opens a page
    When I click "Notes on Thinking in Systems" in "Continue"
    Then it opens in the focused pane, in place of the Desk
    When I go back (⌘[) and Shift-click it instead
    Then it opens beside the Desk

  Scenario: A project in motion
    When I open the Desk
    Then the "LeadingLight" card shows the project's icon and name, and a quiet "Open" link
    And it lists the project's tasks at work that are not done, most urgent first, each a line
      naming the agent and the task with the one button the Work table would show, and under it
      the state, with what the agent says it is doing while it works:
      | line                                   | under it                       | button |
      | Claude: Write the pricing page copy    | Needs your input               | Answer |
      | Claude: Audit the empty states         | Ready for review               | Accept |
      | Codex: Fix the tab row overflow        | Working · Running the QA specs |        |
    And while the runtime has not answered yet, the project card waits rather than call every agent stopped
    And "Rename Pages to Notes in the sidebar", done, is not listed

  Scenario: Answer opens the Feed on the question
    When I click "Answer" on "Write the pricing page copy"
    Then the Feed opens in the bar, on "Should the pricing page lead with the monthly or the yearly price?"

  Scenario: Accept
    When I click "Accept" on "Audit the empty states"
    Then the task is done and accepted, and its line leaves the card

  Scenario: Continue a stopped agent
    Given an agent whose session has ended
    Then its line has a "Continue" button and "Stopped" under it, as in the Work table
    # The demo's runtime is read-only, so pressing it there says "That didn't go".

  Scenario: Open a project, or a task
    When I click "Open" on the "LeadingLight" card
    Then the project page opens in the focused pane
    When I click "Write the pricing page copy" in its line
    Then the task opens

  Scenario: Today
    When I open the Desk
    Then "Today" shows today's date under its title and today's note's words in the editor
    When I click at the end of its words and type " Desk test."
    Then after a moment the words are saved: opening Today from the sidebar shows " Desk test." at the end
    And the card has no block handles (no room in a card); "/" and ⌘/ still reach the blocks
    And Tail's rows, the leftover card and "This day" are not on the Desk; they stay on the daily note
    When I click "Open" on "Today"
    Then today's note opens in the focused pane, in place of the Desk

  Scenario: Today, while its note is open in a pane
    Given the Desk is open and today's note is open beside it
    Then "Today" says "Today's note is already open." with a "Go to it" button, and no editor
    When I click "Go to it"
    Then today's note's pane takes the keyboard, the cursor at the end of its words
    When I close today's note's pane
    Then "Today" shows the editor again, with what I wrote there

  Scenario: Writing on the Desk, then opening the note at once
    Given nothing is written today yet (the note is a draft, decisions 16)
    When I type "from the desk" in the "Today" card and at once Shift-click "Today" in the sidebar
    Then the note beside shows "from the desk", and Daily notes lists one note for today, not two
    When I type ", then the note" there and at once close its pane
    Then the "Today" card reads "from the desk, then the note"
    # Seam test: qa/desk.spec.ts. Each half failed before its fix: a draft being stored was not
    # found by its day, and a pane read a page before the editor closing it had saved.

  Scenario: Captures to file
    When I open the Desk
    Then "Captures to file" lists the four unreviewed ideas, newest first, each with a "Project"
      picker and a "Mark reviewed" tick, as the Captures panel shows them
    When I pick "LeadingLight" for "Fix the LeadingLight tab close button jumping on hover"
    Then its picker reads "LeadingLight"
    When I click "Mark reviewed" on it
    Then it leaves the card, and a line says "Marked reviewed: Fix the LeadingLight tab close button jumping on hover" with "Undo"
    When I click "Undo"
    Then it is back in the card, its project still "LeadingLight"
    And ticking the last one leaves the card with only that line until I undo or leave the Desk

  Scenario: More captures than fit
    Given seven unreviewed captures
    Then the card lists the newest five and a "See all 7" button that opens Captures in the bar

  Scenario: A card with nothing to show is hidden
    Given every capture is reviewed and no project has a task at work
    When I open the Desk
    Then there is no "Captures to file" card and no project card
    And "Continue" and "Today" still show

  Scenario: An empty space
    Given the app is open with no stored data
    Then it shows "No page open" with New page, as before: there is no newest page to replace
    When I click "Desk" in the sidebar
    Then the Desk shows "Your desk fills as you write, capture ideas and hand work to agents."
      and a "New page" button
    When I click "New page" on the Desk
    Then a new page opens in its place, its title focused

  Scenario: Launch opens the Desk
    Given no panes were kept from last time, and the space has pages
    When the app opens
    Then the Desk shows, not the newest page
    Given panes were kept from last time
    When the app opens
    Then those panes come back as they were, the Desk among them only if it was open
