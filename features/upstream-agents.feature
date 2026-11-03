Feature: Codex note turns isolate configured integrations
  Note conversations use the person's Codex account without starting their configured helpers.

  Scenario: A local note turn starts with configured MCP servers and notifications
    Given Codex has an enabled MCP server and a notification command in its settings
    When I ask a note question using Codex on this Mac
    Then the note turn disables those integrations without changing my Codex settings
    And the note's tools remain available

  Scenario: A paired note turn starts with configured integrations
    Given Codex has an enabled MCP server and a notification command in its settings
    When I ask a note question from a paired browser
    Then the note turn disables those integrations without changing my Codex settings
    And the note's tools remain available

  Scenario: Codex cannot verify the isolated configuration
    Given Codex cannot report a safe note-only configuration
    When I ask a note question using Codex
    Then no note thread starts
    And I see an explanation that the configuration could not be isolated

  Scenario: Codex reports a failure before its final result
    Given Codex reports a non-retrying failure for the current note turn
    When that turn fails without its own error message
    Then the conversation shows the reported failure instead of a generic error

  Scenario: Codex recovers after a retry
    Given Codex reports a retrying error for the current note turn
    When that turn completes successfully
    Then the conversation does not report a failure

  Scenario: A note turn is stopped while Codex is starting
    Given Codex is still checking its features and configured integrations
    When I stop the note turn
    Then no Codex note thread starts after the checks finish
    And the turn does not leave an app server running
