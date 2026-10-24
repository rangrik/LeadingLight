Feature: The project runtime
  Project chats run their agents in LeadingLight's own copy of Shipyard's berthd: built from a
  pinned commit with a short list of our patches, started by the app with its own state, socket
  and tmux server. It owns the agent processes, their questions and approvals, their turns and
  their history; the app is a client of it. It never touches the person's own Shipyard or their
  Claude Code and Codex configuration. Note chats keep their own runner.

  Names used below:
  - the pin: runtime/shipyard/UPSTREAM.json (Shipyard commit, Go toolchain and checksum, patches)
  - the probe: pnpm runtime:probe, which drives the built runtime against the real Claude Code
    and Codex signed in on this Mac, in a new folder named "plain folder" under /tmp

  Scenario: The runtime builds from the pinned source
    Given the pin names Shipyard 12d3555 and Go 1.27.3 with its checksum
    When I run pnpm runtime:build
    Then the Go download matches its checksum
    And Shipyard's LICENSE and THIRD_PARTY_NOTICES.md at that commit match vendor/shipyard's
    And every patch applies
    And apps/desktop/src-tauri/binaries/berthd-aarch64-apple-darwin says "berthd v0.3.30-ll.2+" and a
      hash of the patch set, so two patch sets never share a version
    And building again gives a file with the same checksum

  Scenario: A patch that no longer applies stops the build
    Given one patch in runtime/shipyard/patches no longer matches the pinned source
    When I run pnpm runtime:build
    Then it stops with "patch <name> no longer applies"
    And no new runtime is written

  Scenario: The runtime keeps to its own state
    Given the person's Shipyard is running, with its own tmux server named "berth"
    When the probe runs
    Then every session it starts is in a tmux server of its own, and the "berth" server's sessions
      are the same before and after
    And ~/.claude/settings.json, ~/.codex/config.toml and ~/.codex/hooks.json are not written
    And agent events the person's own berth hooks send from inside its agents are not recorded

  Scenario: Claude asks, is answered once, and is given an approval
    When the probe asks Claude, in "plain folder", to ask which colour I prefer, then write it down
    Then the question "Which colour do you prefer?" waits with Red and Blue
    When the same answer, Blue, is sent twice at the same moment
    Then one is taken and the other is refused, and the question shows answered with "Blue"
    When Claude asks to write answer.txt and the approval is given
    Then "plain folder/answer.txt" holds "Blue"

  Scenario: Agents outlive the runtime restarting
    Given Claude's session is running
    When the runtime stops and starts again
    Then the session is still listed and its conversation is still there

  Scenario: Claude resumed carries on with its model and what was said
    Given Claude's session was started with the model sonnet
    When it is stopped and its conversation resumed at once
    Then it runs again with "--model sonnet"
    When "What colour did I pick?" is sent twice with the same key
    Then the second send names the same turn as a duplicate
    And Claude answers "Blue"

  Scenario: Codex's approvals come to the person
    Given the person's own Codex config sends approvals to its auto-review
    When the probe asks Codex to run a command that needs the network
    Then the session waits for the person, asking to run that command, with Yes and No
    When Yes is picked
    Then Codex runs it and replies with the status line, and Codex says the request is resolved

  Scenario: Codex asks its questions in plan mode
    Given Codex's session is in plan mode
    When it is asked to ask which fruit I prefer
    Then the question waits with Apple and Pear
    When Pear is sent twice at the same moment
    Then one is taken and the other is refused, and the question shows answered with "Pear"

  Scenario: Codex resumed and sent to at once
    Given Codex's session is stopped
    When its conversation is resumed and a message is sent straight away
    Then the message is taken, not refused with "Not initialized", and Codex answers "Pear"
