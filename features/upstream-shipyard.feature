Feature: Project chat keeps an agent's unanswered question
  A helper's background work must not hide or answer a question for the person.

  Scenario: A helper finishes while the agent waits for an answer
    Given a project agent asks a question while its helper keeps working
    When the helper sends a progress update or its completed report
    Then the agent's question remains unanswered
    And the helper's report remains visible
    When I send another prompt
    Then the earlier question is closed

  Scenario: Reopening a long conversation finds the question
    Given a project agent asks a question while its helper keeps working
    And the helper writes more than 4 MB of events after the question without new conversation items
    When the conversation is read again
    Then the unanswered question and its options are included

  Scenario: A linked plain folder is its own workspace
    Given a linked folder inside a Git repository
    When the project runtime lists its workspaces
    Then the folder appears as its own workspace
    And an agent working there is placed in that folder's workspace
    And it cannot be removed as a Git worktree

  Scenario: A folder is moved and relinked before a chat resumes
    Given a project chat's original folder no longer exists
    And its location is relinked to the moved folder
    And the provider can find its conversation at that folder
    When the chat resumes
    Then its conversation continues in the relinked folder

  Scenario: A moved chat's provider history is unavailable
    Given a project chat's original folder no longer exists
    And its location is relinked to the moved folder
    But Claude cannot find its conversation at that folder
    When the chat resumes
    Then the runtime reports that Claude could not find the conversation

  Scenario: Removing a worktree with unpushed submodule work
    Given a worktree contains a submodule with a local commit no remote has
    When the runtime removes the worktree without force
    Then it refuses removal and explains that work would be lost
