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

  Scenario: Reach Mac agents from the iPhone's Notes screen
    Given I connected my iPhone to a Mac in Settings > Devices
    When I return to the app and open Notes > Agents on Mac
    Then I can choose a shared project and start a conversation
    And its request reaches the paired Mac rather than a local runtime
    When I close the conversation and open Today
    Then Today, Capture and Notes remain available

  Scenario: Phone suspension does not stop project work
    Given a project agent is running on my Mac
    When I close the mobile app or lose the connection
    Then the agent continues on the Mac
    When I reopen the app and reconnect
    Then I read the same conversation and any pending approval
    And no prompt or approval is resent automatically

  Scenario: Keep agent messages usable above the mobile keyboard
    Given I opened a shared project conversation on iPhone or iPad
    When I type a message and rotate with the keyboard open
    Then the message field, Send and Close stay inside the visible safe area
    And my draft is kept in portrait and landscape, including a 110 pixel visible phone height
    When I press Send
    Then the Mac receives the message once
    And dismissing the keyboard restores the conversation controls
    When the Mac disconnects or cannot confirm a request with the keyboard open
    Then the explanation can be scrolled into view and retry or dismissal remains reachable
    And Stop remains reachable while an agent is running
    When an approval or question arrives
    Then its scrollable card replaces the disabled composer in a short viewport
    And a failed answer shows its explanation and retry before the card

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
    And the explanation can scroll while Cancel and Dismiss request stay above the keyboard
    And my words remain available to edit

  Scenario: Stop only the selected agent
    Given two project agents are running
    When I stop one from my iPad
    Then the Mac interrupts only that agent
    And the app reports failure if the stop cannot be confirmed

  Scenario: Decline work with feedback without losing an uncertain answer
    Given a Mac agent is waiting for permission
    When I write feedback and decline
    Then Claude receives the denial and feedback as one answer
    And Codex receives the denial first and keeps my feedback until I explicitly send it
    When the Mac confirms the Codex denial and I send the saved feedback
    Then only that conversation receives it, with the same message ID on retry
    When a reply is lost
    Then my submitted answer cannot change while its result is uncertain
    And retry sends the original answer rather than a different decision
    When the request expires before my answer arrives
    Then my words return to the message draft and remain there after reopening

  Scenario: Open the request named by a mobile notification
    Given a notification identifies a request on my currently paired Mac
    When I open the notification
    Then the app opens its shared project and conversation and fetches the current request
    And no answer is sent until I choose one
    When that request was answered, expired or replaced
    Then the app explains that it is no longer waiting for my answer
    And a notification from a different Mac cannot open or answer a request

  Scenario: Revocation and project scope are enforced on the Mac
    Given a device knows an unshared conversation or session ID
    When it asks to read, resume, answer or stop that agent
    Then the Mac refuses the request
    And terminal, arbitrary file, runtime administration and note-tool bridge routes are unavailable
    When I remove a shared project, disable access or replace the code on the Mac
    Then further requests with the old access are refused
    And already running work stays on the Mac for me to review or stop there
