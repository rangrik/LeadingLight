Feature: Pages
  Pages are the first kind of object. They are listed in the sidebar, newest first.
  Each page has a title field and a body (the block editor).

  Names used below are accessible names (aria-label or visible text):
  - sidebar: navigation "Pages"; one button per page, named by its title ("Untitled" when empty)
  - "New page" button at the right of the "Pages" label in the sidebar
  - "More" button on each row (the sidebar-08 "…", shown on hover), opening a menu with "Delete"
  - title field: textbox "Title"
  - body: textbox "Page body"

  Background:
    Given the app is open in a browser with no stored data

  Scenario: First run shows an empty state
    Then the sidebar shows the text "No pages yet"
    And the main area shows "No page open" and a "New page" button

  Scenario: Creating a page from the sidebar
    When I click "New page" in the sidebar
    Then the sidebar lists one page named "Untitled" and it is marked as the current page
    And the title field is focused and empty
    And the body shows the placeholder "Type '/' for commands"

  Scenario: Creating a page from the empty state
    When I click "New page" in the main area
    Then the sidebar lists one page named "Untitled"

  Scenario: New pages go to the top of the list
    Given I have created a page titled "First"
    When I create a page titled "Second"
    Then the sidebar lists "Second" above "First"

  Scenario: The title shows in the sidebar as I type
    Given I have created a page
    When I type "Trip to Kyoto" into the title field
    Then the sidebar row reads "Trip to Kyoto" right away, before any save

  Scenario: Enter in the title moves the cursor to the body
    Given I have created a page
    When I type "Notes" into the title field and press Enter
    Then the body is focused
    And the title still reads "Notes" on one line

  Scenario: Switching pages shows each page's own content
    Given I have created a page titled "A" with body text "alpha"
    And I have created a page titled "B" with body text "beta"
    When I click the sidebar row "A"
    Then the title reads "A" and the body contains "alpha" and not "beta"
    When I click the sidebar row "B"
    Then the title reads "B" and the body contains "beta"

  Scenario: Content survives a reload
    Given I have created a page titled "Keep me" with body text "still here"
    When I wait 1 second and reload the browser
    Then the sidebar lists "Keep me"
    And the page "Keep me" is open with body text "still here"

  Scenario: Edits made right before switching pages are not lost
    Given I have created a page titled "A"
    And I have created a page titled "B"
    When I click the sidebar row "A" and immediately type "quick" into the body
    And I click the sidebar row "B" within 200 ms
    And I reload the browser and open "A"
    Then the body contains "quick"

  Scenario: Delete asks for confirmation and Cancel keeps the page
    Given I have created a page titled "Draft"
    When I hover the sidebar row "Draft", click "More" and choose "Delete"
    Then a dialog titled "Delete “Draft”?" is shown
    When I click "Cancel"
    Then the dialog closes and "Draft" is still listed

  Scenario: Confirming delete removes the page and opens the next one
    Given I have created a page titled "Old"
    And I have created a page titled "New"
    When I delete the page "New" and confirm
    Then "New" is no longer listed
    And the page "Old" is open

  Scenario: Deleting the last page shows the empty state
    Given I have created a page titled "Only"
    When I delete the page "Only" and confirm
    Then the sidebar shows "No pages yet"
    And the main area shows "No page open"

  Scenario: Long titles are truncated in the sidebar, not wrapped
    Given I have created a page titled "A very long title that goes on and on and on and on"
    Then the sidebar row is one line high and ends with an ellipsis
    And the title field wraps onto a second line instead of clipping

  Scenario: A title of only spaces counts as untitled
    Given I have created a page
    When I type "   " into the title field
    Then the sidebar row reads "Untitled"
