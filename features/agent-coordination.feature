Feature: An agent hands work to other agents
  In a project chat the agent can start independent workers, Claude or Codex, in the same folder:
  it hands each a task, follows up, waits, or stops one. A worker's result comes back to the agent
  that started it by itself, so nobody copies messages across. The runtime's own commands do this
  (Shipyard's sessions and notifications, DECISIONS.md 18), and its instructions tell every
  project agent how. The chat shows its workers as they go.

  Names used below:
  - the probe: pnpm runtime:probe workers
  - "Research": a page linked to a folder, with its project chat open

  # The runtime (slice 9a)

  Scenario: A lead hands work to a Codex worker
    When the probe asks a lead to hand "Reply with the single word MANGO" to a Codex worker, and wait
    Then the lead starts a Codex session in its folder and sends it the task, from its instructions
    And when the worker finishes, its answer reaches the lead as a report, and the lead says MANGO

  Scenario: One worker, however often it is launched
    When the same worker is launched twice under one name
    Then there is one worker

  # The chat (slice 9b)

  Scenario: Workers show in the chat as they go
    Given access is Full access
    When I ask the agent to have a Claude worker and a Codex worker each count the files in the folder
    Then a Workers card under the turn lists both, each with its agent and what it's doing
    And when each finishes, its row says so, with how long it took and its answer, and the agent goes on

  Scenario: A worker's answer stays with its worker
    Given two workers, one of which fails
    Then the failure shows on that worker's row, and the other's answer on its own row

  Scenario: The chat stays usable while workers run
    Given workers are running
    Then I can send the agent another message, and read its reply

  Scenario: Stop a worker from its row
    Given a worker is running a long command
    When I press Stop on its row
    Then that worker stops, its row says Stopped, and the other workers go on

  Scenario: Open a worker's own chat
    When I press a worker's row
    Then its own chat opens, showing what it was asked and what it did
