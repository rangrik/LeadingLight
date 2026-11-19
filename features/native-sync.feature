Feature: Connect the installed app to the same encrypted workspace
  Notes stay on each device. A signed-in browser, or an app that already syncs, approves a new device.

  Scenario: Production devices connect at the current workspace address
    Given workspace sign-in is available at https://leadinglight.app
    When I connect the installed iPhone or iPad app
    Then its approval page opens at https://leadinglight.app with the matching code
    And its sync requests use that same fixed HTTPS origin
    And an approval URL for another origin is rejected

  Scenario: Approve the iPad from the existing account
    Given the iPad has local notes and no cloud session
    And the browser is signed into my workspace with its recovery key
    When I choose to connect the iPad
    And I approve the named device in that browser
    Then the iPad receives the same account and an encrypted recovery key
    And its session credential is stored in the system Keychain
    And the cloud never receives the recovery key in plaintext
    And the local notes remain available

  Scenario: The approving browser has no recovery key
    Given the browser is signed into my workspace and has never synced at this address
    And the account already has synced notes
    When I open the approval link
    Then the page says to type the code on a device that already syncs, or to paste its key from Account and devices, Recovery key, Show…
    When I press Connect this device with the key left blank
    Then I read "This account already has synced notes. Enter its recovery key to connect."
    And the request stays pending and the browser saves no key

  Scenario: An expired approval link asks for nothing
    Given a native connection request has expired
    When I open its approval link in a signed-in browser with no recovery key
    Then I read that the connection expired and to start again on the new device
    And no recovery key field is shown and Connect this device is disabled

  Scenario: Connect a signed-in Mac to a library
    Given my first Mac already syncs this library
    When I choose Connect a device in Account and devices on the new Mac
    Then the new Mac shows one number and the first Mac shows three
    When I choose the matching number on the first Mac
    Then the new Mac receives the library key encrypted for that approval
    And I can sync without typing a recovery key

  Scenario: An older app’s wrong or guessed sign-in code approves nothing
    Given LeadingLight on my Mac is signed in and syncing
    When I type a code that no waiting device shows and press "Continue"
    Then it says "No device is waiting with that code. Check the code on your new device."
    And after ten codes in ten minutes it says "Too many codes tried. Wait ten minutes, then try again."
    And a code shared by two waiting devices is refused until one of them starts again

  Scenario: A device that does not sync cannot approve another
    Given LeadingLight is signed in but sync is off or paused on this device
    When I open Account and devices
    Then "Add a device" is disabled and I read "Turn on sync here to add another device."

  Scenario: Sign out all devices from the browser
    Given my Mac and iPad are connected and a third device is approved but has not finished connecting
    When I press "Sign out all devices" at leadinglight.app and confirm
    Then the Mac and iPad can no longer read synced notes
    And the third device cannot finish connecting
    And the notes on each device remain available
    And an installed app cannot sign out other devices

  Scenario: An unapproved or expired connection cannot obtain a session
    Given a native connection request is waiting for approval
    When a different polling verifier is used or ten minutes pass
    Then no session or encrypted recovery key is returned
    And an expired request cannot be approved

  Scenario: A connection can be claimed only once
    Given the browser approved a native connection
    When the native app claims the connection with its verifier
    Then a second claim cannot issue another session

  Scenario: A failed key handoff keeps the previous connection
    Given the installed app already has a saved account connection
    When a new approval cannot unlock the synced workspace
    Then its provisional session is discarded
    And the previous Keychain connection remains unchanged

  Scenario: Native credentials stay within their account and scope
    Given two accounts have different native sessions
    When one account requests synced notes
    Then it receives only that account's encrypted events
    And its native session can approve a device only into its own account
    And its native session cannot use browser agent routes or sign out other devices
    And a browser request cannot bypass its origin check using a native credential

  Scenario: Sign out revokes this native session
    Given the iPad has an active native session
    When I sign out on the iPad
    Then the server revokes that session and the Keychain credential is removed
    And that credential cannot read synced notes again
    And the local notes remain available

  Scenario: A device in use stays signed in
    Given the installed app's sign-in would end in 1 day
    When the app makes any request to the cloud
    Then its sign-in ends 30 days from that request

  Scenario: A sign-in that ended is not brought back
    Given the installed app was not used for 30 days and its sign-in ended 1 second ago
    When the app makes a request to the cloud
    Then it reads "This connection expired or was revoked. Reconnect this device."
    And the sign-in's end time has not moved

  Scenario: Initial sync crosses multiple history pages without missing notes
    Given the account has 121 encrypted history events numbered 1 through 121
    When a new device fetches them in pages of at most 50 events
    Then each page is ordered by the numeric sequence
    And all 121 event IDs arrive exactly once
    And advancing the cursor never skips events 6 through 9
