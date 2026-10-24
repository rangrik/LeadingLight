Feature: A project's agents read its pages
  A project's agents (Claude and Codex, in its chats and in work assigned to them) read the
  project's pages in LeadingLight through LeadingLight's own tools, so they can answer from the
  project without every page being pasted into the chat. The runtime says which agent is calling;
  an agent can't name another project or person. Reading follows the project's links: the project
  page, what it links to, what links to it through a property (its tasks and meetings), what
  mentions it, and their reports and essays, a few steps out. The person's sidenotes are private:
  an agent never reads them, except the ones sent to it as feedback (features/feedback.feature).

  Names used below:
  - "Research": a project page linked to "~/LL QA/My Project" (features/external-projects.feature)
  - "Plan": a page "Research" links to, with properties Status "Active" and a file "budget.pdf",
    a paragraph "We ship in May" with a sidenote "ask Sam first", and a link back to "Research"
  - "Diary": a page that isn't linked to or from "Research"
  - LeadingLight's tools: project, read, search and attachment, as the agent sees them

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Research" is linked to "~/LL QA/My Project", and links to "Plan"

  Scenario: An agent answers from the project's pages
    When I ask a Claude chat in "Research" "What does Plan say about shipping, and what is its status?"
    Then the chat's steps show it read Research and Plan through LeadingLight's tools
    And it answers "May" and "Active", naming Plan
    And the same question in a Codex chat answers the same

  Scenario: What a read gives
    When an agent reads "Plan"
    Then it gets its title, type, its properties by id with their names and values, its text as
      Markdown, the pages it links to and those linking to it, its attachments, and a stable
      reference "ll:<id>" for each page
    And a long page comes a part at a time, with a cursor for the next part

  Scenario: Pages outside the project are refused
    When an agent in "Research" reads "Diary" by its id
    Then it is told "Diary" isn't part of "Research", and gets none of its text
    And searching for words only "Diary" holds finds nothing
    And a link to a page that was deleted reads as missing, not as an empty page

  Scenario: The person's sidenotes stay private
    When an agent reads "Plan", its Thoughts page, or searches for "ask Sam"
    Then "ask Sam first" is in none of the answers
    And reading the Thoughts page says how many notes are private, and shows none of them

  Scenario: Links in a circle
    Given "Plan" links to "Research", which links to "Plan"
    When an agent reads both and follows every link
    Then each page reads once, and nothing loops

  Scenario: A tag doesn't open the whole space
    Given "Plan" is tagged "work", and "Diary" is tagged "work" too
    When an agent reads the tag "work"
    Then it reads the tag page, and "Diary" stays outside the project

  Scenario: An attachment
    When an agent asks for "budget.pdf" on "Plan"
    Then it gets a path to a copy it can open, kept with its chat and outside the folder
    And "Plan" and the folder are as they were

  Scenario: LeadingLight closed
    Given a chat's agent is working and I quit LeadingLight
    When the agent reads a page
    Then within a few seconds it is told LeadingLight isn't open, and can still read the folder's files
