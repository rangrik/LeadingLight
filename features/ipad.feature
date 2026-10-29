Feature: LeadingLight on iPad
  The iPad app uses the same pages and editor, with local storage on the device.
  Account sync is supplied by the cloud work described in cloud-web.feature.

  Scenario: Write without a connection
    Given I open LeadingLight on an iPad without a network connection
    When I create a page and write "Ideas on the train"
    And I leave the app and reopen it
    Then the page and its words are still available
    And saving does not wait for a cloud connection

  Scenario: Navigate in a narrow iPad window
    Given the app is 600 pixels wide in iPad multitasking
    When I open the sidebar and choose a page
    Then the sidebar closes and the chosen page fills the available space
    And the page, toolbar and quick capture remain within the window
    When I open Settings and choose Appearance
    Then the settings sidebar closes and the section is visible
    And theme descriptions refer to the current device's system appearance

  Scenario: Type with the onscreen keyboard
    Given I am editing a page on an iPad
    When the onscreen keyboard opens or the device rotates
    Then the app follows the visible viewport
    And the editor can scroll above the keyboard
    And controls avoid the status bar and home indicator

  Scenario: Rotation keeps the writing position visible
    Given I am writing the fifth paragraph with the onscreen keyboard open
    When I rotate the iPad from portrait to landscape
    Then the caret is visible above the keyboard without typing another character
    And the editor keeps focus, its selection and all written text
    When I repeatedly rotate between portrait and a short landscape window
    Then the caret stays visible after the browser finishes adjusting its scroll position
    When I scroll up to read immediately after rotating
    Then the app does not pull me back to the caret
    When I return to LeadingLight after it was in the background
    Then the app measures the visible viewport again without requiring a tap

  Scenario: Quick capture does not require a keyboard
    When I tap Quick capture and enter "Remember this"
    And I tap Save
    Then the idea is saved and the capture box closes
    When I reopen Quick capture
    Then I can tap Close without using Escape
    And Save and Open beside work by touch for a webpage too
    When I open an idea beside the page in a narrow window
    Then the active page still has a sidebar button

  Scenario: Native storage does not imply Mac features
    Given I open the native iPad app
    Then pages use the app's local SQLite database
    And the app does not reserve room for Mac traffic lights
    And quick capture opens inside the app
    And it does not start Mac command-line agents, global shortcuts or login items
    And unavailable agent features do not show simulated replies

  Scenario: Preview a saved attachment
    Given I have attached a PDF to a page on the iPad
    When I tap the file
    Then the system previews the saved file without a network connection
    When I dismiss the preview
    Then I return to the same page
    When a file is missing or its format cannot be previewed
    Then I see a clear error and stay on the page
    And the preview command refuses paths outside the app's assets folder

  Scenario: Keep saved media after an app update
    Given a page has an imported image, audio, video and a PDF saved on the iPad
    And its cover and icon use imported images
    When an app update moves its data to a new iOS sandbox directory
    And I reopen the page without a network connection
    Then the saved media uses the same files in the current app's assets folder
    And the images display and the audio, video and PDF can still open
    And no reimport is needed and the page's text and dates are unchanged
    And remote URLs, data URLs and malformed attachment paths are left unchanged

  Scenario: Build an iPad app without desktop executables
    When I build the iOS target
    Then the app has one main window and supports portrait and landscape on iPad
    And it contains no Mac agent runtime, terminal multiplexer or transcription executable
    And the macOS build keeps its existing desktop features

  Scenario: Prepare a TestFlight build
    When I build the iOS release for TestFlight
    Then the archive uses the release configuration and a distinct iOS build number
    And the app includes its icons and required privacy declarations
    And distribution uses App Store Connect signing
    When Apple account access or distribution signing is unavailable
    Then the release archive remains available locally
    And the build is not described as uploaded or installable from TestFlight

  Scenario: Test directly on a connected iPad
    Given my iPad is paired with this Mac and Developer Mode is enabled
    When I install a development-signed build on that iPad
    Then it appears as "LeadingLight Dev" with its own app data
    And it contains the editor so it opens without a development server
    And installation does not replace the production app or install on another device

  Scenario: Existing cloud work owns cross-device access
    Given the account and encrypted sync work has not been integrated into this build
    Then this build does not claim my Mac's notes are already on the iPad
    And it does not create a second cloud service or copy the live Mac database

  Scenario: Approve a device with the existing workspace account
    Given I am signed into my workspace in the browser with encrypted sync enabled
    When the installed app requests a connection
    And I open its link and choose Connect this device in the browser
    Then only that device can retrieve the approved account and decrypt its recovery key
    And the browser never receives the device's session credential
    And a request that was already claimed cannot be claimed again

  Scenario: A failed connection preserves existing keys
    Given this browser's notes and recovery key belong to one workspace account
    When I sign into another account and try to approve a device
    Then approval is refused and the original recovery key is unchanged
    When I open an invalid or expired connection link
    Then I see an error and cannot approve it
    When I open a connection link while signed out
    Then I must sign in before I can approve the device

  Scenario: An account change while approval is open does not consume the request
    Given I opened a device connection link while signed into one account
    When the browser signs into another account before I approve
    Then approval fails with an account changed message
    And the connection is still waiting for approval
    And my existing recovery key remains unchanged

  Scenario: Keychain failure preserves the prior workspace
    Given the installed app has an existing recovery key and paused sync
    When a verified connection cannot be saved to Keychain
    Then its provisional session is discarded
    And the prior account, recovery key, backup key, and paused state remain unchanged
    And no notes are uploaded before the connection is confirmed

  Scenario: A failed browser approval does not link a new workspace
    Given this browser has no recovery key and no linked account
    And a device connection was approved elsewhere after I opened its dialog
    When I try to approve that connection here
    Then I see that the connection was already approved
    And this browser remains unlinked without a new recovery key
    And no notes are uploaded
