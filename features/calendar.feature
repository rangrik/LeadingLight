Feature: Personal and work calendars in one calm plan
  Scenario: Read about calendar data before connecting
    Given I have not signed in
    When I open the public LeadingLight homepage
    Then I can read what the app does and open its privacy policy
    And the policy explains Google calendar access, agent processing and disconnecting

  Scenario: Connect several Google accounts
    Given I am signed in to LeadingLight
    When I connect my personal Google account and my work Google account
    Then both accounts and their calendars are listed with their names
    And connecting the same account again replaces its connection without duplicates
    And cancelling Google consent leaves existing connections intact

  Scenario: See and shape today
    Given I have selected personal and work calendars
    When I open Calendar
    Then I see today's events in time order and the current timezone
    And I can move to another day or return to Today
    And I can hide a calendar without disconnecting it
    And I can add a 25 minute focus block in available time

  Scenario: Edit without losing someone else's changes
    Given an event belongs to a writable calendar
    When I change its title, time, notes or location and save
    Then Google Calendar receives the change
    And the refreshed event appears in my plan
    And reminder choices explain whether they keep the current settings
    And deleting an event confirms that it was deleted from Google Calendar
    But if the event changed in Google since I opened it
    Then saving fails with a message to refresh before trying again
    And the newer Google event is not overwritten

  Scenario: Recurrence and all-day events
    Given a recurring event has several occurrences
    When I edit or delete one occurrence
    Then only that occurrence changes
    And I can create a daily or weekly series with a bounded number of occurrences
    And an all-day event keeps its date across timezones

  Scenario: Agent calendar access
    Given I have connected a writable calendar
    When I ask a note agent to find time and schedule a focus block
    Then it can list calendars and events and create the event directly
    And updates and deletes use the event's latest version
    And calendar writes follow the same approval and plan-mode rules as note writes
    And an agent cannot access another LeadingLight account's connections

  Scenario: Unavailable or read-only calendars
    Given a calendar is read-only or Google access has been revoked
    When I try to change an event
    Then the app explains the restriction without claiming it saved
    And I can reconnect an expired account or disconnect it
    And a failed refresh keeps the current view with an explicit stale warning

  Scenario: Duplicate delivery and account isolation
    Given a create request succeeded but its response was lost
    When the same request is retried
    Then it does not create a second event
    And signing out clears the displayed calendar data
    And a calendar request for another workspace is refused

  Scenario: Read a calendar beside a note
    Given a note and Calendar share a 1024 pixel window
    When Calendar has a narrow pane
    Then event titles and times remain readable without overlapping calendar details
    And each calendar name appears below its event title until the pane has room for a column
