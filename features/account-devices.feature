Feature: One place for your account and devices
  Settings › Account and devices says who you are signed in as, lists the devices on the
  account, and is where a device is added or removed. It takes the place of the Account and
  sync dialog and of Settings › Devices.

  Scenario: The sidebar row opens the one place
    When I press "Account and sync" in the sidebar
    Then Settings opens on "Account and devices"
    And no "Your workspace, everywhere" dialog opens
    And Settings no longer lists "Devices"

  Scenario: See which account this device uses
    Given I signed in at leadinglight.app with Google as alex@example.com
    When I open Account and devices
    Then I read my name with "alex@example.com · Google" under it
    And the installed apps on that account show the same line
    And an account whose provider is not known yet shows its name alone

  Scenario: The sign-in buttons remember the one used here
    Given I signed in with Google in this browser and then signed out
    When I open Account and devices
    Then "Continue with Google" says "Last used here"
    And "Continue with GitHub" does not

  Scenario: List the devices on the account
    Given my Mac, iPad and iPhone apps are signed in to one account
    When I open Account and devices on the Mac
    Then Devices lists the Mac first, marked "This Mac"
    And the iPad and iPhone follow, most recently online first, each with "Online now" or "Last online" and how long ago
    And a device that joined in the last day is marked "New"
    And browsers are not listed, and the page says so

  Scenario: Name this device
    Given the installed Mac app is signed in
    When I press "Rename" in its own row, type "MacBook Air" and press Save
    Then my other devices list it as "MacBook Air"
    And a name cannot be saved empty or typed past 40 characters
    And a name typed and abandoned with Escape is gone when I open Rename again

  Scenario: Remove a lost device in the browser
    Given I am signed in at leadinglight.app and my iPad app is on the account
    When I press "Remove" on the iPad and confirm "Remove iPad"
    Then the iPad can no longer read or send synced notes
    And the list no longer shows it
    And the notes already on the iPad stay on it
    And another account cannot remove it

  Scenario: An installed app does not remove other devices
    Given the installed Mac app is signed in
    When I open Account and devices
    Then no device row has "Remove"
    And I read "To remove a device, sign in at leadinglight.app."

  Scenario: Add a device from one that syncs
    Given this device is signed in and syncing
    And my new Mac shows code "3F9A1C07"
    When I press "Add a device" and type "3f9a 1c07"
    Then I read "Let LeadingLight on Mac open your notes?" with my account under it
    When I press "Approve"
    Then I read "LeadingLight on Mac is connected. It will finish syncing by itself."
    And the new Mac is in Devices, marked "New"
    And no recovery key was typed anywhere

  Scenario: A wrong code adds nothing
    Given the Add a device dialog is open
    When I type a code that no waiting device shows
    Then I read "No device is waiting with that code. Check the code on your new device."
    And the boxes are emptied with the first one ready, so the next code is typed afresh

  Scenario: A device that does not sync cannot add another
    Given this device is signed in but sync is off or paused
    When I open Account and devices
    Then "Add a device" is disabled
    And I read "Turn on sync here to add another device."

  Scenario: A new app shows its code and both ways in
    Given the installed app has no account
    When I press "Connect this Mac"
    Then I read an 8-character code
    And I read to type it in LeadingLight on a device that already syncs: Settings, Account and devices, Add a device
    And the browser does not open by itself
    When I press "Continue in the browser"
    Then leadinglight.app opens on the approval page with the same code

  Scenario: A sign-in that ended says so
    Given this device was signed in, and its sign-in ended or it was removed
    When I open the app
    Then the sidebar row says "Sign in"
    And Account and devices says "This Mac is signed out of sync" with the account it used
    And it says the notes are safe here
    And "Sign in again" starts a connection for the same account
    And the recovery key can still be shown

  Scenario: Offline is not signed out
    Given this device is signed in and the network is off
    When I open the app
    Then the sidebar row says "Offline"
    And Account and devices does not say the device is signed out
    And it says so in plain grey words, not as a red error

  Scenario: Signing out on purpose asks first and stays quiet after
    Given this device is signed in and syncing
    When I press "Sign out"
    Then I am asked "Sign out of this Mac?" (or iPad, iPhone, browser) and told the notes and the key stay here
    When I confirm
    Then the sidebar row says nothing beside its name
    And there is no signed-out warning
    And the page says which account these notes sync with

  Scenario: Signed in with the wrong account
    Given this device's notes sync with alex@example.com · Google
    When I sign in as a different account
    Then I read "These notes sync with alex@example.com · Google"
    And I read which account I am signed in as
    And sync stays off for these notes
    And the page shows no Sync, Devices or Recovery key parts for the other account
    And "Sign out" lets me switch

  Scenario: Save the recovery key once
    Given I am signed in on my first device with sync off
    When I press "Turn on sync"
    Then a dialog shows the recovery key with "Copy"
    And "Done" stays disabled until I tick "I saved it somewhere safe"
    And if I close the dialog without ticking, Account and devices keeps "Save your recovery key"
    And a device that got its key from another device, or by pasting it, does not ask

  Scenario: Show the recovery key
    Given this device holds a recovery key
    When I press "Show…" on Recovery key
    Then a dialog shows the whole key, wrapped to fit a phone, with "Copy"
    And closing the dialog hides the key again

  Scenario: The sidebar's cloud says where sync stands
    Then with no account it is a plain cloud named "Account and sync"
    And signed in and current it is a cloud with a tick, named "Account and sync · Synced"
    And while changes move it is a cloud with arrows, "Syncing"
    And offline, with sync off or paused it is a crossed-out cloud, "Offline", "Sync off" or "Paused"
    And when a page could not sync, the account is the wrong one, or sign-in ended, it is an amber
      cloud with "!", "Check" or "Sign in"
    And its tooltip and its name for a screen reader carry the same words

  Scenario: Agents keep working from the same page
    When I open Account and devices on the Mac
    Then "Agents from a browser" holds the connection that the Agents tab had
    And "Agents from iPhone and iPad" holds what Settings › Devices had
    And an existing connection still works without pairing again
    And a browser outside development has no "Agents from iPhone and iPad", which needs the Mac app

  Scenario: The page fits a phone
    When I open Account and devices at 390 points wide
    Then nothing scrolls sideways
    And in the iPhone app each row's control sits under its words
