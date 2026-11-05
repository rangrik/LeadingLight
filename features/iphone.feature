Feature: LeadingLight on iPhone
  Capture first, return easily, and keep one thing on screen.
  The iPhone shares the iPad app's editor, local database and encrypted workspace.

  Scenario: A quiet place to start
    Given I open LeadingLight on an iPhone
    Then Today shows a Capture a thought action and a daily note action
    And at most three recent captures are shown
    And Today has no unread counts, streaks or overdue warnings
    And Today, Capture and Notes are reachable at the bottom
    And the Mac and iPad keep their existing navigation

  Scenario: Capture without organizing
    When I tap Capture and write "Bring my headphones"
    Then I do not have to choose a project, tag or type
    When I tap Save
    Then the capture closes only after the idea is saved locally
    And I return to where I was
    When I open Captures from Notes
    Then "Bring my headphones" is available

  Scenario: Interrupted and failed captures
    Given I am writing a capture without a network connection
    When I background the app or tap Close
    Then my words are saved locally without needing a network connection
    When a local save fails and I tap Save or Close
    Then the capture stays open with my words and a retry message
    And the retry message scrolls into view even above a landscape keyboard
    And I can retry without creating a second idea

  Scenario: Find a note without remembering its type
    Given I have a note titled "Train" containing "headphones"
    When I open Notes and search for "headphones"
    Then I can open "Train" from the results
    And clearing search returns to recent notes
    And an unmatched search says no notes were found
    And I can browse Captures and my page types from Notes

  Scenario: Leave a page and come back
    Given I have opened a note from Notes
    When I write "Remember the charger" and immediately tap Today
    And I tap Continue writing
    Then I return to that note with my words intact
    And my scroll position and editor selection are kept
    When I reload offline after the save finishes
    Then the note still contains "Remember the charger"
    And Continue writing opens that note

  Scenario: One page at a time
    Given I follow a page link or open a captured idea
    Then the chosen page fills the available width
    And there are no split panes or desktop tab strips on the phone
    And Back returns to the preceding page when one exists
    And Notes and Today remain reachable

  Scenario: Small phones, keyboard and rotation
    Given the app is open on an iPhone 375 pixels wide
    When I edit a note or capture with the onscreen keyboard open
    Then the caret and Save and Close controls remain above the keyboard
    And navigation respects the status bar and home indicator
    And primary touch controls are at least 44 pixels tall
    When I rotate to landscape
    Then the phone navigation remains and my words and selection are kept
    And content does not overflow horizontally

  Scenario: Native rotation keeps the keyboard and safe areas aligned
    Given the installed iPhone app is editing a capture with the touch keyboard open
    When I rotate from portrait to landscape and back
    Then the keyboard rotates with the app
    And Save and Close stay reachable outside the keyboard and camera cutout
    And the capture body scrolls when the keyboard leaves only 150 pixels of height
    And my capture text remains unchanged
    When I background and reopen the app
    Then the same local notes are available

  Scenario: Identify the phone when connecting a workspace
    Given I open Account and sync in the installed iPhone app
    When I choose Connect your workspace
    Then the browser approval names the device "LeadingLight on iPhone"
    And the connection code matches the one shown on the phone
    And the iPad and Mac keep their own device names

  Scenario: Build one iOS app for iPhone and iPad
    When I build the iOS target
    Then its device families include iPhone and iPad
    And iPhone supports portrait and landscape
    And the app bundles its editor for offline use
    And it uses the existing local storage, attachment preview and encrypted sync
    And no Mac executables are bundled

  Scenario: Install the production app with its own identity
    Given LeadingLight development apps are installed on my iPhone and iPad
    When I install the signed release build on both devices
    Then its name is "LeadingLight" and its identifier is "com.leadinglight.app"
    And its Home Screen icon is the existing cream LeadingLight mark on an ink background
    And all bundled icon sizes use that mark without transparency
    And the development apps and their local notes remain available
    And the release app can connect to my existing encrypted workspace
    When paid signing is unavailable
    Then the installation report states the signing profile's actual expiry
