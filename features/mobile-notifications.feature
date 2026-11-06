Feature: Respond to Mac agents from an iPhone or iPad notification
  Push notifications contain a connection identifier, an encrypted target and a generic alert.
  Questions, permission details and responses travel through the encrypted connection.

  Scenario: Ask for notification permission explicitly
    Given my iPhone is paired with a Mac
    When I inspect notification status
    Then iOS does not ask for permission
    When I enable agent notifications
    Then iOS asks for alert and sound permission
    And declining permission leaves the agent connection usable

  Scenario: Receive an agent request while the app is closed
    Given I allowed notifications on my paired iPhone or iPad
    And this signed app has the Push Notifications entitlement
    When a shared Mac agent needs permission or asks a question
    Then the device receives "An agent on your Mac needs your response"
    And the notification contains no project name, prompt, command or answer
    And there are no approval actions on the lock screen

  Scenario: Open a request from a notification
    Given an agent notification arrived while LeadingLight was closed
    When I tap the notification
    Then LeadingLight opens the paired Mac's pending requests
    And it fetches request details through the encrypted connection
    And I can approve, deny or send the requested feedback from the app
    And an unrelated or malformed connection identifier cannot switch my paired Mac

  Scenario: Preserve permission and registration failures
    Given notifications are denied or this app lacks a signed push entitlement
    When I enable agent notifications
    Then LeadingLight explains why background notifications are unavailable
    And it does not report the device as registered
    And I can still read and answer requests with the app open

  Scenario: Keep development tokens out of the production push topic
    Given I installed a development app with a different bundle identifier
    When I enable agent notifications
    Then the app explains that background alerts require the signed LeadingLight app
    And it does not register that app's token with the production push topic

  Scenario: Alert only for requests the device can answer
    Given a Mac agent is waiting for an answer
    When its project is unshared, its connection is revoked or its request is resolved
    Then no new notification is sent for that request
    When I tap an earlier notification
    Then the app checks the request's current state before offering a response

  Scenario: Deliver a pending request once per device
    Given an agent request is still waiting for an answer
    When the Mac retries a notification after losing its connection
    Then the same device does not receive a duplicate alert
    When I enable notifications on another paired device
    Then that device can receive the still-pending request
    When the agent replaces the question with a new generation
    Then each registered device can receive a new alert

  Scenario: Keep delivery receipts while Apple restores registration
    Given notifications are enabled and authorized on a registered device
    And a pending request has already alerted that device
    When LeadingLight reopens before Apple returns its notification token
    And Apple has not returned a token or reports a temporary registration error
    Then LeadingLight checks the existing subscription without removing it
    When Apple returns the same token
    Then registration preserves the request's delivery receipt
    And the pending request does not alert that device again
    When I disable notifications or deny permission in iOS Settings
    Then LeadingLight removes the subscription

  Scenario: Finish removing alerts after an offline disconnect
    Given I enabled notifications and then lost my internet connection
    When I disconnect my Mac from this device
    Then the agent encryption key is removed
    And Keychain retains only the relay credentials needed to remove its notification subscription
    When I reopen LeadingLight online, even without a paired Mac
    Then the app retries removing that subscription
    And a failed retry remains saved without dropping other pending removals
    And reconnecting the same Mac keeps its new notification registration

  Scenario: Preserve pending cleanup when its storage limit is reached
    Given sixteen old notification subscriptions still need removal
    When I try to forget another Mac
    Then the app asks me to reconnect and finish notification cleanup first
    And it keeps the current connection and every pending removal

  Scenario: Match the APNs environment to the signed app
    Given the installed app was signed for production push notifications
    When APNs registers this device
    Then LeadingLight registers its token with the production push service
    And a development signature instead uses the sandbox push service
    And the build's debug flag does not choose the push service

  Scenario: Keep existing iOS app behavior
    Given LeadingLight handles notifications and scene lifecycle events
    When I open a notification, rotate my iPad or return to the app
    Then the existing app and notification delegates receive their callbacks
    And a cold-start notification remains available until the app consumes it

  Scenario: Retain a tap until the app handles it
    Given I opened LeadingLight by tapping an agent notification
    Then the app saves the encrypted target before telling iOS it finished handling the tap
    When Keychain is temporarily unavailable while the app opens its encrypted target
    Then the notification remains available to retry
    When a newer notification is tapped before the old target is acknowledged
    Then acknowledging the older target does not clear the newer one
