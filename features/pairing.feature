Feature: Run page agents through a paired Mac
  The Mac runs its installed Claude Code or Codex with the user's existing sign-in.
  The browser keeps the editor, page tools, approval cards, authorship and undo.

  Scenario: A Mac explicitly approves a browser
    Given I am signed into the web app with cloud access enabled
    When I choose "Connect a Mac" in Account and sync > Agents
    Then I can copy a pairing code that expires in five minutes
    When I paste it into LeadingLight on my Mac and choose "Review connection"
    Then the Mac shows my workspace account, browser name and page-agent access
    And the review explains that web tools use the Mac's network and selected approval mode
    And no agent can run until I choose "Allow this browser" on the Mac
    When I allow it
    Then the browser shows the Mac's name and its Claude Code and Codex readiness
    And pairing does not enable note sync

  Scenario: Pairing is single-use and account-bound
    Given an expired, rejected or already claimed pairing code
    When another Mac tries to claim it
    Then it cannot create a connection
    And another account cannot inspect or use my connection
    And other browsers need their own pairing approval

  Scenario: A paired browser uses the existing note agent
    Given my paired Mac is online and its selected CLI is signed in
    When I ask about selected page text
    Then the same local agent runtime runs on that Mac
    And its reply streams into the existing Ask panel
    And note changes use the existing approval, authorship and undo paths
    And no model API key, cloud model execution or usage billing is offered
    And CLI readiness that arrives later updates Send and the model list without reopening Ask or losing my draft

  Scenario: The relay cannot read agent content or CLI secrets
    When a browser and Mac exchange a prompt, tool result or model event
    Then the relay stores only routing metadata and encrypted envelopes
    And the pairing encryption key and CLI credentials never reach the relay
    And an envelope copied to another connection, turn or direction is refused

  Scenario: The Mac only accepts the paired note protocol
    When a paired client sends an arbitrary command, path, app-server method or unknown session id
    Then the Mac refuses it without launching that work
    And Codex keeps the note runtime's fixed tools and read-only sandbox
    And only outstanding tool and approval requests can receive replies

  Scenario: Paired Codex does not inherit executable user integrations
    Given my signed-in Codex CLI has user MCP servers or plugins configured
    When a paired browser starts a note conversation
    Then those servers and plugins are disabled before its thread starts
    And the Mac verifies the effective configuration before accepting thread messages
    And a configuration it cannot verify fails without starting the conversation
    And my existing Codex sign-in and configuration remain unchanged
    When I stop the turn
    Then its provider process and helper processes stop without affecting another app's agents

  Scenario: Offline Macs do not receive delayed surprise work
    Given my paired Mac is asleep, offline or LeadingLight is not running
    When I open Ask
    Then I see which Mac is unavailable and how to reconnect it
    And sending is unavailable while my draft remains intact
    And a start request that expires before the Mac accepts it never runs later

  Scenario: Device clock differences do not change connection leases
    Given my Mac's clock is ahead of or behind the relay's clock
    When my paired browser sends a question
    Then its lease and start expiry use the relay's time
    When the Mac sleeps or loses the connection for sixty seconds
    Then its old turn stops before another command can run
    And a backwards clock change cannot extend the connection lease
    And a browser with an incorrect clock still shows fresh Macs online and stale Macs offline
    And the pairing-code countdown uses the relay's time and elapsed time

  Scenario: A refused start keeps the approved connection
    Given the relay rejects a start with a quota, conflict or size error before accepting it
    Then the browser shows that refusal without sending a cancellation
    And the connection remains available for another question

  Scenario: Retries do not start the same turn twice
    Given the relay or Mac lost an acknowledgement
    When a start command or event is delivered again
    Then the same turn cannot launch another CLI process
    And the browser does not append the same event or apply its note tool twice
    And an uncertain start after a Mac restart is reported as interrupted

  Scenario: Stop and revocation reach only the paired work
    Given a remote turn is running and another local turn is running
    When I stop the remote turn
    Then I see stopping until the Mac acknowledges cancellation
    And the local turn continues
    When I remove the connection in either app
    Then new commands are refused immediately
    And its remote turns stop on the next check or within the connection lease
    And the browser explains when a stop cannot yet be confirmed
    When I quit LeadingLight from its menu or the Dock
    Then its page-agent processes stop and the browser reports the Mac offline

  Scenario: Stop blocks late page tools immediately
    Given Claude or Codex is running with approval or full access
    When I press Stop while the Mac has not acknowledged cancellation
    Then the pending approval closes and no new approval appears
    And late tool requests cannot edit or create pages
    And a tool still waiting for pending saves cannot mutate the page after Stop
    And Stopping remains visible until cancellation is confirmed
    And a provider's final reply during cancellation does not discard the later stopped confirmation

  Scenario: An uncertain delivery stops renewing the connection
    Given the Mac has not acknowledged a start, reply or stop
    When delivery fails or times out
    Then the browser marks the connection interrupted without claiming a confirmed stop
    And the Mac stops the turn when its lease expires
    And another turn requires an explicit connection

  Scenario: Changing accounts discards in-flight replies
    Given a remote turn belongs to my current workspace account
    When I sign out or switch accounts while an encrypted reply is arriving
    Then that reply cannot edit a page or install a connection in the new account
    And a received tool waiting for pending saves cannot edit after the account changes
    And the old connection stops renewing its lease

  Scenario: Reload or connection loss interrupts safely
    Given a remote turn is streaming or waiting for approval
    When its browser reloads or its connection lease expires
    Then its partial transcript remains saved
    And its pending turn is marked interrupted
    And no model turn or note mutation is replayed automatically
    And another tab must explicitly take over an active connection

  Scenario: Reload waits for the saved Mac connection
    Given this browser already has an approved Mac connection
    When I reload and the workspace account takes time to load
    Then Ask shows a quiet loading state until the saved connection is known
    And it never briefly offers a new connection or a development stand-in
    When I type a draft in the restored Ask composer and the Mac becomes offline
    Then the same draft remains and Send is unavailable

  Scenario: Follow-ups stay on their execution Mac
    Given a conversation has run on one Mac
    When I choose another Mac or remove the connection
    Then local session identifiers are never sent to the other Mac
    And its next question includes fresh page context
    And changing Macs while mentioned pages load fails the pending question visibly without sending it
