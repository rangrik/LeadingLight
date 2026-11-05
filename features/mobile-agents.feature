Feature: Control Mac project agents from iPhone and iPad
  Tailscale carries a private connection to the Mac. The existing Mac runtime owns
  agents, conversations and approvals; the mobile app never runs a local CLI.

  Scenario: The Mac chooses what a device can reach
    Given I linked two project folders in LeadingLight on my Mac
    When I open Settings > Devices and share only one project
    And enable mobile access with Tailscale connected
    Then I can copy a connection code for this Mac
    And access is bound only to the Mac's Tailscale address
    And a device without that code cannot read or control agents

  Scenario: A network with the same address cannot impersonate the Mac
    Given another network uses addresses in Tailscale's range
    When Tailscale is disconnected
    Then the Mac does not listen on an unrelated interface
    And a server without the certificate in my connection code receives no authenticated request

  Scenario: Connect an iPhone or iPad without a cloud account
    Given both devices use the same Tailscale network
    When I paste the Mac's code into Settings > Devices on my iPhone or iPad
    Then I see the Mac's name and only its shared projects
    And the connection message and project list line up with the dialog heading on phone and tablet
    And the device keeps its connection secret in Keychain
    And no workspace sign-in or note sync is required

  Scenario: Start and continue work on the Mac
    Given I connected to a Mac with a shared project
    When I open that project and send a question using Claude or Codex
    Then its existing Mac runtime starts the agent with approval required
    And I see the conversation and its pending questions or approvals
    When I answer a question or approval and send a follow-up
    Then the same Mac conversation receives it
    And the device cannot select an unshared folder or bypass approval mode

  Scenario: Phone suspension does not stop project work
    Given a project agent is running on my Mac
    When I close the mobile app or lose the connection
    Then the agent continues on the Mac
    When I reopen the app and reconnect
    Then I read the same conversation and any pending approval
    And no prompt or approval is resent automatically

  Scenario: Offline and uncertain requests remain visible
    Given the Mac sleeps or Tailscale disconnects
    When I try to send a question
    Then the app explains that the Mac cannot be reached and keeps my words
    And it never queues work to run when the Mac wakes
    And retrying an uncertain start with the same request ID cannot start a second agent

  Scenario: Release an uncertain request after checking the Mac
    Given the Mac cannot confirm whether a start was accepted
    When I choose "Dismiss saved request"
    Then I must confirm after being told that dismissal does not stop work on the Mac
    And my words remain available to edit

  Scenario: Stop only the selected agent
    Given two project agents are running
    When I stop one from my iPad
    Then the Mac interrupts only that agent
    And the app reports failure if the stop cannot be confirmed

  Scenario: Revocation and project scope are enforced on the Mac
    Given a device knows an unshared conversation or session ID
    When it asks to read, resume, answer or stop that agent
    Then the Mac refuses the request
    And terminal, arbitrary file, runtime administration and note-tool bridge routes are unavailable
    When I remove a shared project, disable access or replace the code on the Mac
    Then further requests with the old access are refused
    And already running work stays on the Mac for me to review or stop there
