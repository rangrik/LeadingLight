Feature: Runtime work finishes and cancels predictably
  Scenario: A worker reports while its caller is busy
    Given a worker's caller has started a turn
    When the worker finishes
    Then its report stays queued without interrupting the caller
    When the caller announces that it has finished
    Then the same report is delivered once
    And repeating the worker's finish event does not deliver another report

  Scenario: Setup starts the project's services
    Given a worktree has a setup script and an autostart service
    When the runtime creates or opens the worktree
    Then the request returns while setup runs
    And setup completes after service discovery and startup finish

  Scenario: Service setup is cancelled
    Given the service manager is not answering a setup command
    When setup is cancelled or reaches its deadline
    Then the manager command ends within its cancellation bound
    And no later startup command is sent
    And setup reports failure instead of success

  Scenario: A browser command is cancelled in the queue
    Given another command is using the browser tab
    When a queued command is cancelled
    Then the queued request returns without waiting for the active command
    And it is never sent to Chromium later
    And the tab accepts a new command when the active command ends

  Scenario: A service installation is retried after interruption
    Given a service definition was written but its manager did not acknowledge loading it
    When setup retries that same service
    Then the definition is loaded before startup is considered successful
    And concurrent requests do not load the same definition twice
    And unrelated changes to the definition are preserved on rollback

  Scenario: Navigation is cancelled before Chromium receives it
    Given another command is blocking the Chromium writer
    When a navigation request is cancelled or replaced
    Then the unsent navigation returns without waiting for that command
    And it never navigates the page later
    But a navigation whose command was fully sent can finish after its HTTP request ends

  Scenario: A viewport change is cancelled while waiting
    Given another operation owns the browser's viewport
    When a queued viewport change is cancelled
    Then the saved viewport remains unchanged

  Scenario: Chromium stops reading commands
    Given a browser command cannot finish writing to Chromium
    When the command reaches its deadline
    Then the request returns without holding the transport lock
    And shutdown can finish
    And an incomplete command frame is never joined to a later command

  Scenario: Browser event flags match their commands
    When I pass "--after" to a browser command other than "developer-events"
    Then the CLI rejects that flag before contacting the runtime
    And developer-events still accepts a nonnegative event cursor

  Scenario: A private browser removes its unused startup page
    Given Chromium acknowledges closing its unused default page before destroying it
    When the runtime opens a private browser
    Then startup waits for that selected page to disappear
    And the private tab and later unrelated tabs remain open
    And cancellation stops the startup wait
