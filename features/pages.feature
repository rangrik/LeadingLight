Feature: Pages
  Pages appear in Library and in sidebar search. Pinned pages stay in the sidebar.
  Each page has a title field and a body (the block editor).

  Names used below:
  - sidebar row: search results or Pinned, one button per title ("Untitled" when empty)
  - "New page": the button near the top of Notes
  - "More": a row's menu with Open beside, Rename, Pin, Copy link and Delete
  - title field: textbox "Title"
  - body: textbox "Page body"

  Background:
    Given the app is open in a browser with no stored data

  Scenario: First run shows an empty state
    Then the sidebar explains "Pin pages from Library to keep them here."
    And the main area shows "No page open" and a "New page" button

  Scenario: Creating a page from the sidebar
    When I click "New page" in the sidebar
    Then Library lists one page named "Untitled" and it is marked as the current page
    And the title field is focused and empty
    And the body shows the placeholder "Type '/' for commands"

  Scenario: Creating a page from the empty state
    When I click "New page" in the main area
    Then Library lists one page named "Untitled"

  Scenario: Library lists all pages by name
    Given I have created a page titled "First"
    When I create a page titled "Second" and open Library
    Then Library lists "First" above "Second"
    And typing a title in Search library filters the list

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

  Scenario: Enter confirms the delete and Escape keeps the page
    Given I have created a page titled "Draft"
    When I hover the sidebar row "Draft", click "More" and choose "Delete"
    Then the dialog's "Delete" button has focus
    When I press Escape
    Then the dialog closes and "Draft" is still listed
    When I choose "Delete" in the menu of "Draft" again and press Enter
    Then "Draft" is no longer listed

  Scenario: Confirming delete removes the page and opens the next one
    Given I have created a page titled "Old"
    And I have created a page titled "New"
    When I delete the page "New" and confirm
    Then "New" is no longer listed
    And the page "Old" is open

  Scenario: Deleting the last page shows the empty state
    Given I have created a page titled "Only"
    When I delete the page "Only" and confirm
    Then sidebar search finds no pages
    And the main area shows "No page open"

  Scenario: A row's menu
    Given I have created a page titled "Draft"
    When I hover the sidebar row "Draft" and click "More"
    Then the menu reads "Open beside", "Rename", "Pin", "Copy link", a line, "Delete", each with a 16 px icon
    And "Delete" and its icon are in the destructive colour, in light and dark mode
    And on "Thoughts" or an essay under its page the menu reads "Copy link", a line, "Delete"
    And the page's own "Page options" menu ends with a line and "Delete page…" in the destructive colour
    And in Type settings "Delete type" is in the destructive colour, and so is the button confirming it

  Scenario: Renaming a page from the sidebar
    Given I have created pages titled "Draft" and "Other", and "Draft" is open
    When I choose "Rename" in the menu of "Draft"
    Then a field opens under the row holding "Draft", all of it selected
    When I type "Plan" and press Enter
    Then the field closes, the row reads "Plan", and the open page's title reads "Plan" at once
    And after a reload it still reads "Plan"
    When I rename "Other" to "Later" and click elsewhere instead of pressing Enter
    Then "Other" is renamed "Later"
    When I rename "Later", type "Nope" and press Escape
    Then it keeps the name "Later"
    When I rename "Later", clear the field and press Enter
    Then it keeps the name "Later"

  Scenario: Pinning a page
    Given I have created pages titled "Old" and "New"
    When I choose "Pin" in the menu of "Old"
    Then Pinned holds "Old", and Library still lists both pages
    And the menu of "Old" now reads "Unpin"
    And after a reload "Old" is still pinned
    When I choose "Unpin" in its menu
    Then Pinned has an empty hint and Library still lists both pages
    # Failure case: the open page saves its own properties, which must not undo the pin.
    When "Old" is open, I type "more" in its body and pin it at once, then reload
    Then "Old" is pinned and its body holds "more"

  Scenario: Copying a page's link
    Given I have created pages titled "Dune" and "Notes"
    When I choose "Copy link" in the menu of "Dune"
    Then a toast reads "Link copied"
    When I open "Notes", click into its body and paste
    Then the body holds a link to "Dune" (an @ mention), which opens "Dune" when clicked
    And renaming "Dune" to "Dune Messiah" changes the link's text

  Scenario: Long titles are truncated in the sidebar, not wrapped
    Given I have created a page titled "A very long title that goes on and on and on and on"
    Then the sidebar row is one line high and ends with an ellipsis
    And the title field wraps onto a second line instead of clipping

  Scenario: A title of only spaces counts as untitled
    Given I have created a page
    When I type "   " into the title field
    Then the sidebar row reads "Untitled"

  Scenario: Thoughts and essays sit under their page
    Given page "Article" has a Thoughts page and an essay titled "On small teams"
    Then Library lists "Article", its Thoughts page and its essay
    And pinning "Article" keeps its children under it in the sidebar
    When I open "Article"
    Then "Thoughts" and "On small teams" show under it on a small tree, after xevrion's sidebar submenu
    When I open "Thoughts"
    Then the branch from "Article" down to "Thoughts" is drawn in the primary colour
    When I open another page
    Then the tree under "Article" folds away
    When I delete "Article"
    Then its Thoughts page and essay stay, listed at the top level
