Feature: Compatible library updates preserve notes
  Scenario: Edit and reopen a page after the editor update
    Given a page with text and a list
    When I edit the text, undo the edit, and reopen the page
    Then the saved text and list are intact

  Scenario: Review a spelling suggestion after the editor update
    Given a page containing "I recieved a letter."
    When I review its writing and apply the suggested spelling
    Then the page contains "I received a letter."
    And undo restores the original spelling

  Scenario: Type on a long page
    Given a page containing 2000 paragraphs
    When I type in the page
    Then typing stays responsive and the typed text appears

  Scenario: Build the browser app
    When the workspace is installed from its lockfile and built
    Then its dependencies resolve and the browser app builds

  Scenario: Render math in an agent reply
    Given an agent reply contains "\(x^2\)" and a display formula between "$$" lines
    When the reply is shown
    Then both formulas render and invalid formulas remain visible as text
    And "$5 and $10" stays ordinary text
    And formulas inside inline code and ordinary code blocks stay ordinary code
    And math inside folded work renders when I expand it

  Scenario: Syntax colors follow the chosen theme
    Given a project file contains a keyword, a string, and a comment
    When I open its preview from the project chat in a built-in theme
    Then the three kinds of text use distinct readable colors

  Scenario: Previewing project code cannot edit the file
    Given a project turn has kept a version of a source file
    When I open the file and type in its preview
    Then its contents do not change
    When I choose Now and then Then
    Then each view shows the corresponding file contents
    And Change still shows the added and removed lines
