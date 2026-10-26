Feature: Turn selected text into a page
  Selected words become the body of an Idea, Task, or another page type.

  Scenario: Turn text into an idea with a project
    Given I have selected "Build a quiet reading corner" in a page
    When I choose "Turn into" in the selection toolbar
    Then the type is Idea and the suggested title is "Build a quiet"
    And the selected words are shown as the body to be kept
    When I choose the project "House" and press "Create idea"
    Then an Idea titled "Build a quiet" has the full selected words as its body
    And its Project is House
    And only the selected words in the original page become a link to the idea
    And both pages and the project relation survive a reload

  Scenario: Choose a title and a different type
    Given I have selected two paragraphs with bold words and a list
    When I choose "Turn into", choose Task, and enter "Plan the reading corner" as the title
    Then I can choose a project for the Task
    When I press "Create task"
    Then the Task has my title and the selected paragraphs, formatting, and list as its body
    And the surrounding words in the source are unchanged
    And a custom page type can be chosen too
    And app-created types and Daily notes are not offered

  Scenario: Use the first three words without losing the body
    Given I have selected fewer than three words or text with extra spaces and line breaks
    When I choose "Turn into" and leave the title empty
    Then saving uses up to the first three words as the title
    And all selected text stays in the body

  Scenario: Cancel or fail without changing the source
    Given the Turn into dialog is open
    When I cancel, press Escape, or saving fails
    Then the selected text is unchanged
    And cancelling creates no page from the selection
    And a save failure keeps my title and project choices for retry
    And pressing Create twice while saving creates only one page

  Scenario: Undo the conversion link
    Given I have turned selected words into an Idea
    When I undo in the source page
    Then the original words return
    And the created Idea is kept
    When I redo
    Then the same Idea is linked again without making another page

  Scenario: The source changes while the dialog is open
    Given the Turn into dialog holds a selection
    When another action changes the source before I create the new page
    Then creation asks me to select the words again and leaves the source unchanged
    And if the source changes while the new page is being saved, the new page is kept without replacing unrelated text

  Scenario: Read-only pages cannot be converted
    Given I am reading an agent report
    When I select its words
    Then Turn into is not offered
