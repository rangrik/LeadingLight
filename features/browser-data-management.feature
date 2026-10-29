Feature: Browser preferences and browsing data
  The browser keeps its own history, site data and downloads on this Mac.

  Scenario: Find a visited page from the address
    Given I visited "A useful page" at "https://example.com/useful"
    When I type "useful" in Address
    Then the matching title and address appear below the field
    When I choose that suggestion with the keyboard
    Then the current browser tab opens that exact address
    And Escape dismisses suggestions without navigating

  Scenario: Remove selected history without changing the page
    Given this workspace has visits from today and last week
    When I clear history from the last hour
    Then only visits in that hour are removed
    And its open tabs, bookmarks, sign-ins and downloaded files remain
    When I remove a single visit
    Then only that visit disappears after reopening the app
    And restoring an already-open personal tab does not add the removed visit again
    When I navigate to that address again
    Then it appears as a new visit

  Scenario: Clear selected site data without clearing history
    Given this workspace has saved sign-ins and a visited-page history
    When I choose Cookies and site data in Clear browsing data
    Then the dialog explains that site data is removed for all time
    And history is not selected automatically
    When I confirm
    Then personal tabs close and this workspace is signed out
    And its history, bookmarks and downloaded files remain
    And agent tabs in another workspace remain signed in

  Scenario: Cancelling or failing a clear keeps local records
    Given the clear dialog is open with History selected
    When I cancel
    Then history is unchanged
    Given an agent tab is open in this workspace
    When I also try clearing website data
    Then the browser asks me to close that agent tab first
    And it keeps my history and saved tabs

  Scenario: Configure a download destination in the Mac app
    Given Browser settings use the system Downloads folder
    When I choose another folder using the native folder picker
    Then new personal-browser downloads are copied there after they finish
    And an existing file with the same name is never overwritten
    And partial or failed downloads are never reported as saved
    When I turn on Ask where to save downloads
    Then each completed personal download opens a Save dialog
    And the chosen download folder is the dialog's starting folder
    And at most one download Save dialog is open at a time
    When I reset the download location
    Then the system Downloads folder is selected again

  Scenario: Download export remains scoped and bounded
    Given a large personal-browser download finishes
    Then saving copies it in bounded chunks without loading it all into memory
    And agent-only downloads are not automatically exported
    And a website cannot choose a filesystem path through its filename
    And a failed copy keeps the original download available to save again
    And at most two automatic copies run in each workspace at once
    And an active copy or Save dialog keeps its record when download history is trimmed
    And reopening the app does not repeat an interrupted Save dialog

  Scenario: Leaving a browser before a save dialog opens
    Given Ask where to save downloads is enabled
    And a completed download is waiting for its first bytes or another save dialog
    When I close that browser pane
    Then it does not open a new save dialog afterward
    And the completed download remains available through Save in Downloads

  Scenario: A download prompt is not repeated
    Given Ask where to save downloads is enabled
    And the same workspace is open in two browser panes
    When a personal download finishes
    Then only one pane claims its Save dialog
    When I cancel the dialog or saving fails
    Then the original file remains available through Save in Downloads
    And reopening the pane or reloading the app does not prompt again
    And a download from another workspace uses that workspace's own record
    And agent-only downloads never open a Save dialog
