Feature: Reports an agent publishes
  A project's agent publishes what the person should read as a report: a new page, signed by the
  agent and dated, shown after the words of the page it is about. The page's own words are never
  touched, so typing in it while a report arrives loses nothing. A report never changes once
  published, not even by the agent that wrote it; a correction is a new report. Reports are pages,
  so they can be searched, linked and read by other agents, and the person's own text carries no
  agent label.

  Names used below:
  - "Research": a project page linked to "~/LL QA/My Project" (features/project-context.feature)
  - "Brief": a page "Research" links to, with the paragraph "Summarise the notes."
  - report: what an agent publishes with LeadingLight's publish tool
  - byline: the line above a report: the agent's name, when, and Open

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Research" is linked to "~/LL QA/My Project", and links to "Brief"

  Scenario: A report appears beside the page it is about
    Given "Brief" is open
    When I ask a chat in "Research" to read "Brief" and publish a short summary to it
    Then a report shows after the paragraph "Summarise the notes.", with a byline "Claude · just now"
    And the report's title and text are the agent's, and "Brief"'s own words are as they were
    And the chat's steps say "Published a report"

  Scenario: Published while the page is closed
    Given "Brief" is not open in any pane
    When an agent publishes a report to "Brief"
    Then opening "Brief" shows the report after its words

  Scenario: Published while LeadingLight is quit
    Given an agent is working and I quit LeadingLight
    When it publishes a report
    Then it is told the report is kept and will show when LeadingLight opens, not that it shows now
    When I open LeadingLight
    Then the report shows once on its page, and the agent's next publish of it changes nothing

  Scenario: Typing while a report arrives
    Given I am typing in "Brief", with words not yet saved and the cursor mid-sentence
    When a report arrives for "Brief"
    Then my words, the cursor and where I am scrolled to stay as they were
    And after a reload both my words and the report are there

  Scenario: The same report sent twice
    When an agent publishes a report and then publishes the same one again (a retry)
    Then "Brief" shows it once

  Scenario: A report can't be changed
    When I open a report
    Then its title and text can be read and selected but not edited, and it has no properties to change
    And its byline names the agent, links to the agent's page and says when
    And Ask can't change it either
    And the agent has no tool that edits or deletes, and a report published "to" an earlier report
      shows as a new report after it on the same page, saying it corrects the earlier one

  Scenario: Sources are checked
    When an agent publishes with a source quoting words "Brief" doesn't have
    Then the publish is refused, saying which source isn't in "Brief", and nothing shows
    And a source outside the project is refused the same way

  Scenario: Reports are pages
    Then Reports lists every report, each opens as its own page under the page it is about
    And search finds a report's words, and another agent can read it with read
    And the agent's own page lists its reports

  Scenario: Reports aren't offered in New
    When I type "@New thing" or open Reports
    Then neither the link menu nor Reports offers to make a report or an agent by hand
