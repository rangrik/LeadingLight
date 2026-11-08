Feature: LeadingLight on iPhone
  Capture first, return easily, and keep one thing on screen.
  The iPhone shares the iPad app's editor, local database and encrypted workspace.

  Scenario: A quiet place to start
    Given I open LeadingLight on an iPhone
    Then Today shows a Capture a thought action and a daily note action
    And at most three recent captures are shown
    And Today has no unread counts, streaks or overdue warnings
    And Today and Notes are tabs in a floating bar at the bottom, with a round Quick capture button beside it
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
    And Back returns to the preceding page, or to Today or Notes when there is none
    And Notes and Today remain reachable

  Scenario: Small phones, keyboard and rotation
    Given the app is open on an iPhone 375 pixels wide
    When I edit a note or capture with the onscreen keyboard open
    Then the caret and Save and Close controls remain above the keyboard
    And the tab bar is hidden while the onscreen keyboard is open
    And navigation respects the status bar and home indicator
    And primary touch controls are at least 44 pixels tall
    When I rotate to landscape and the keyboard closes
    Then the tab bar returns with the same tab selected, and my words and selection are kept
    And content does not overflow horizontally

  Scenario: Native rotation keeps the keyboard and safe areas aligned
    Given the installed iPhone app is editing a capture with the touch keyboard open
    When I rotate from portrait to landscape and back
    Then the keyboard rotates with the app
    And Save and Close stay reachable outside the keyboard and camera cutout
    And the capture body scrolls when the keyboard leaves only 150 pixels of height
    And the tab bar stays hidden until the keyboard closes and never covers the caret
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

  Scenario: The tab bar floats over the content
    Given I have 30 notes on an iPhone 390 pixels wide
    When I open Notes
    Then Today and Notes sit together in one rounded glass bar, 16 pixels from each side and above the home indicator
    And Notes has a lighter pill behind it and Today has none
    And Quick capture is a separate round button in the theme's primary colour at the trailing end
    And no line or full-width background separates the bar from the content
    When I scroll the list
    Then rows pass beneath the bar, show faintly through it and fade out toward the bottom edge
    And the tab labels stay readable
    When I scroll to the end
    Then the last row and Account and sync sit fully above the bar
    When I open a note from Notes
    Then Notes stays selected in the bar
    When I tap Notes
    Then I am back on Notes where I left it
    When I open Settings
    Then no part of the tab bar shows below Settings
    When I rotate to landscape
    Then each tab shows its icon beside its label, and the bar is centred and clear of the camera cutout
    When only a hardware keyboard's shortcut bar is showing
    Then the tab bar stays visible

  Scenario: Top bars without dividers
    Given I am on Today
    Then the top bar shows only a round Settings button, 16 pixels from the right edge, and no app name
    And "Today" is a 34 pixel bold title below the bar
    When I open Notes
    Then New page and Settings share one glass button group in the top bar
    When I scroll down
    Then the content fades out under the top bar instead of meeting a line
    And at the top of the screen no text sits under that fade
    When I open a note
    Then Back is a round button with only a chevron, 16 pixels from the left edge, and there is no Forward button
    And History and authorship is a round button 16 pixels from the right edge
    And the Today, Notes and page top bars are the same height
    When I open Captures from Notes
    Then the top bar shows Back and no empty round button

  Scenario: Back at the first page goes home
    Given I create a new page from Notes and write "Remember the charger"
    When I tap Back
    Then I am on Notes and the page keeps "Remember the charger"
    When I open a page from Today and follow a link in it
    And I tap Back twice
    Then I see the first page and then Today

  Scenario: Capture opens as a sheet
    When I tap Quick capture
    Then the capture is a sheet with rounded top corners that reaches the bottom and side edges of the screen
    And the page behind it is dimmed but not blurred
    And Close is a round ✕ button at the leading end and Save a filled rounded button at the trailing end
    And there is no line under its header
    And Save, Close and the text stay clear of the status bar, camera cutout and home indicator in portrait and landscape

  Scenario: Account and sync opens as a bottom sheet
    When I open Account and sync on an iPhone in portrait
    Then it rises from the bottom edge across the full width with rounded top corners
    And its last control sits above the home indicator

  Scenario: Glass stays readable in every theme and setting
    Given each of the 23 built-in themes, in light and in dark
    Then words on the tab bar keep 4.5:1 contrast even with text of their own colour beneath the glass
    And menus, sheets, dialogs and toasts keep their opaque surfaces
    When Increase Contrast is on
    Then the tab bar and round buttons are opaque, unblurred and edged in the text colour
    When Reduce Motion is on
    Then nothing on the bars moves
    When a local save fails on Today
    Then the error toast appears above the tab bar, not over it or the home indicator
    When a save fails while the keyboard is open
    Then the toast appears just above the keyboard

  Scenario: The Home Screen icon uses the system's Liquid Glass looks
    When I build the iOS app with Xcode 27
    Then its icon is a layered Icon Composer icon: the cream mark over an ink background
    And the default, dark, clear and tinted Home Screen looks keep the mark readable
    And iOS versions before 26 get flat icons made from the same file
    When the Xcode project is generated again
    Then the layered icon is still the app's icon
