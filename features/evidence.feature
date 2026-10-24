Feature: Evidence inside a report
  An agent shows its work with the files that prove it: a screenshot, a recording, a document. It
  names them when it publishes, from its folder or from the outputs the runtime kept, and
  LeadingLight keeps its own copy inside the report, where images and videos play and documents
  open as any file on a page does. The copy is the version the agent published: changing or
  deleting the file in the folder later, or the folder's cleanup, leaves it as it was. A file that
  can't be kept is refused when the agent publishes, so a report never shows a hole.

  Names used below:
  - "Research" and "Brief" as in features/reports.feature
  - evidence: a file named in a publish, by its path in the folder or a kept output's id

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Research" is linked to "~/LL QA/My Project", and links to "Brief"

  Scenario: A screenshot made by a shell command shows in the report
    When I ask a chat to make chart.png in the folder with a shell command and publish a report to
      "Brief" with chart.png as evidence, captioned "Sales by month"
    Then the report shows the chart as an image after its words, with "Sales by month" under it
    And clicking the image opens it larger, as a file opens; it has no size bar, as the report can't change

  Scenario: A recording and a document
    When an agent publishes demo.mp4 and notes.pdf as evidence
    Then the video plays inside the report, and notes.pdf shows as a file card that opens it

  Scenario: The reviewed version stays
    Given a report shows chart.png as published
    When the agent changes chart.png and then deletes it from the folder
    Then the report still shows the chart as it was published
    And publishing the new chart.png makes a new report with the new version; the first is unchanged

  Scenario: A file that can't be kept
    When an agent publishes with evidence "missing.png", or a file outside its folder
    Then the publish is refused at once, saying which evidence and why, and no report shows

  Scenario: Published with LeadingLight quit
    Given I quit LeadingLight
    When an agent publishes a report with chart.png, then deletes chart.png
    Then opening LeadingLight shows the report with the chart as it was when published

  Scenario: Evidence is explained in Settings
    When I open Settings › Objects
    Then Evidence says agents name it when they publish, LeadingLight keeps its own copy, and it
      never changes
