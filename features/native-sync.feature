Feature: Connect the installed app to the same encrypted workspace
  Notes stay on each device while a signed-in browser approves a native connection.

  Scenario: Approve the iPad from the existing account
    Given the iPad has local notes and no cloud session
    And the browser is signed into my workspace with its recovery key
    When I choose to connect the iPad
    And I approve the named device in that browser
    Then the iPad receives the same account and an encrypted recovery key
    And its session credential is stored in the system Keychain
    And the cloud never receives the recovery key in plaintext
    And the local notes remain available

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
    And its native session cannot approve another device or use browser agent routes
    And a browser request cannot bypass its origin check using a native credential

  Scenario: Sign out revokes this native session
    Given the iPad has an active native session
    When I sign out on the iPad
    Then the server revokes that session and the Keychain credential is removed
    And that credential cannot read synced notes again
    And the local notes remain available
