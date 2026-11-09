Feature: Mermaid diagrams in notes
  Mermaid is a code block language. The source stays editable and saves with the page.

  Scenario: Insert and edit a diagram
    Given I am writing in a page
    When I choose Mermaid diagram from the slash menu
    Then I see a Mermaid code block with a hint to enter a diagram
    When I type "flowchart LR" followed by "A[Draft] --> B[Published]"
    Then a diagram showing Draft pointing to Published appears below the source
    When I change Published to Reviewed
    Then the diagram shows Reviewed
    And undo and redo update both the source and diagram

  Scenario: Paste and reopen diagrams
    When I paste a fenced mermaid block containing a sequence diagram
    Then its source and rendered sequence diagram appear
    When I reopen the page
    Then the source and diagram are still there
    And Copy code and Download code keep the Mermaid source
    And the download has the mmd extension

  Scenario: Change an existing code block's language
    Given a plain text code block contains "flowchart LR; A --> B"
    When I choose Mermaid from its Language menu
    Then the diagram appears below the source
    When I choose Plain text
    Then only the source remains

  Scenario: Recognize diagrams in Markdown-created objects
    When an agent creates a page from Markdown containing a fenced mermaid block
    Then opening the page shows its rendered diagram automatically
    And reading the page as Markdown keeps the mermaid fence and source
    When that content belongs to a task, idea, project or custom object type
    Then its diagram renders in the object's body without changing its language manually

  Scenario: Recover from invalid source
    Given a Mermaid block shows a valid diagram
    When I replace its source with "not a diagram"
    Then an error replaces the old diagram
    And the source remains editable
    When I replace it with "flowchart LR; A --> B"
    Then the diagram appears again without an error

  Scenario: Read diagrams in different layouts
    Given a page contains multiple Mermaid diagrams
    When I switch between light and dark mode
    Then each diagram uses readable theme colours
    And diagrams fit the page in a narrow pane without widening it
    And the Language, Copy code and Download code controls do not overlap the source
    And editing one diagram does not replace another diagram

  Scenario: Diagram text cannot execute code
    When I paste Mermaid source containing HTML or a click callback
    Then no script or callback runs
    And my source is preserved

  Scenario Outline: Edit diagrams with touch on iOS
    Given I am using the <device> app
    When I create a page and choose Mermaid diagram from the slash menu
    Then I can type source and see the rendered diagram
    And I can tap Language without hovering or covering the source
    When I edit the source while offline
    Then the preview updates and the page saves
    When I reopen the app and return to the page
    Then its source and diagram are still there

    Examples:
      | device |
      | iPad   |
      | iPhone |
