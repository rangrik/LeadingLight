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
    And apps/desktop/src-tauri/binaries/berthd-aarch64-apple-darwin says "berthd v0.3.30-ll.N+" and a
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

  # In the app: the runtime the app starts and keeps (src-tauri/src/runtime.rs). In a browser the
  # dev server starts the same runtime for its checkout and reaches it at /__runtime.

  Scenario: Settings shows the runtime, and starts it
    Given the runtime isn't running
    When I open Settings › AI
    Then "Projects › Runtime" says "Starts when a project chat first needs it.", with Start
    When I press Start
    Then it says "Running, v0.3.30-ll.3+…" and where its state is, with Restart

  Scenario: A runtime that isn't built says how to build it
    Given the browser build has no runtime built
    When I press Start in Settings › AI › Projects
    Then it says "Not running: No runtime built yet: run pnpm runtime:build."

  Scenario: Restarting keeps the agents working
    Given an agent in the runtime is in the middle of a turn
    When I press Restart in Settings › AI › Projects
    Then it says Running again
    And the agent's turn carries on and finishes

  Scenario: The installed app needs nothing installed
    Given the Mac app, built with pnpm install:dev-app
    When its runtime starts
    Then berthd and tmux run from the app's own copy in its data folder, not Homebrew's
    And its tmux server and port range are its own, not the person's Shipyard's

  Scenario: Agents keep working with the app closed
    Given an agent in the Mac app's runtime is in the middle of a turn
    When I quit the app
    Then the agent's turn carries on
    When I open the app again
    Then it uses the same runtime, and the turn's end is there

  Scenario: A newer app takes over from an older runtime
    Given the Mac app's runtime is running an older build
    When a newer app starts
    Then the older runtime stops, its state files are copied to runtime/backups first, and the
      newer one runs
    And agents that were running carry on under the newer one
    And the older build's berthd and tmux are kept beside it for rolling back
