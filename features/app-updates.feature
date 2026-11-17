Feature: The Mac app updates itself
  The Mac app looks for a newer release on GitHub, says when one is ready, and installs it with
  one click. It installs an update only if it carries LeadingLight's update signature. Nothing is
  downloaded before the click. In a browser build a stand-in plays the updater: ?update=0.9.0
  offers that version, ?update=fail offers it and makes the install fail, and ?update=offline
  makes the check fail. An iPhone or iPad app cannot replace itself, so there the button opens
  the release's install link and iOS asks before installing (the last scenario); ?ipad or ?iphone
  with ?update shows it in a browser.

  Names used below:
  - the update toast: a toast titled "LeadingLight 0.9.0 is ready", where the tools' toast shows
  - the version row: row "Version" in Settings › About

  Scenario: A newer version is found
    Given a release newer than this app is GitHub's latest
    And the app has been open for about 30 seconds, so the tools' update toast has had its turn
    Then the update toast shows with the buttons "Update and restart" and "Later"
    And left alone it stays until I choose Update or Later
    And the version row reads "0.9.0 is ready" beside an "Update and restart" button

  Scenario: Return to the app or reconnect
    Given a newer release becomes available while I am away or offline
    When I return to the app or regain a connection
    Then the app checks for the new release and shows the update toast
    And repeated foreground or connection events within five minutes share one scheduled check

  Scenario: Update with one click
    When I click "Update and restart" in the update toast or in the version row
    Then a toast reads "Updating to LeadingLight 0.9.0…" with a spinner
    And the app downloads the update, checks its signature, installs it and reopens as 0.9.0
    And my pages are as I left them

  Scenario: Later
    When I click "Later" in the update toast
    Then the toast goes and does not come back for 0.9.0, even after a relaunch
    And the version row still offers "Update and restart"
    And a release newer than 0.9.0 brings the toast back

  Scenario: Up to date
    Given this app is GitHub's latest release
    Then no update toast shows
    When I click "Check for updates" in the version row
    Then the row reads "Up to date"

  Scenario: The check fails
    Given the Mac is offline
    Then no toast shows, and the app checks again later
    When I click "Check for updates" in the version row
    Then the row reads "Couldn't check for updates" and keeps its button

  Scenario: The install fails
    Given the download breaks, or its signature is not LeadingLight's
    When I click "Update and restart"
    Then a toast reads "Couldn't update LeadingLight" with the reason and a "Download" button
    And "Download" opens the release page in the browser and closes the toast
    And "Dismiss" closes the toast
    And trying again takes the old message away, so there is never more than one
    And a background check for the same version keeps the error and its reason visible
    And the installed app is unchanged and keeps running

  Scenario: iPhone and iPad install the release by its link
    Given a release newer than this app is GitHub's latest
    Then a toast reads "LeadingLight 0.9.0 is ready" with the buttons "Update" and "Later"
    And the version row reads "0.9.0 is ready" beside an "Update" button
    When I tap "Update"
    Then iOS asks whether to install LeadingLight, and Install replaces the app in place
    And my pages are as I left them
    And nothing goes through TestFlight or the App Store

  Scenario: Not the released app
    Given a dev app from pnpm install:dev-app, the web app, or a browser build without ?update
    Then it never offers an update
