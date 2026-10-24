Feature: Accepting an agent's work
  When the agent given a task says its work is ready, the task says "Ready for review" and points to
  the report to read. I accept it when I'm satisfied, and only then is the task done. Nothing an agent
  does can mark it done, and work that arrives after I accepted shows as new without undoing it.
  Tasks no agent was given keep their checkbox as before.

  Names used below:
  - "Write the summary": a task assigned to Claude (features/assign.feature)
  - Review: the line in the task's work panel while it is ready, with Accept

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Write the summary" is assigned to Claude

  Scenario: Ready, then accepted
    When the agent publishes its report "Summary" with ready
    Then the work panel says "Ready for review" and "Read Summary, then accept it or send feedback."
    And the Feed lists "“Write the summary” is ready for review", with Accept
    When I press Accept
    Then the task's Done is ticked, the panel says "Accepted just now", and the Feed item goes

  Scenario: Accepted at rest
    Given the agent answered my feedback without saying it is ready, and stopped
    Then the panel says "Its latest report is … Accept it when you're satisfied." with Accept

  Scenario: Only I accept
    When the agent tries to mark "Write the summary" done with its task tool
    Then it is refused and Done stays unticked
    And a worker's report with ready doesn't make the task ready for review

  Scenario: Later work doesn't undo it
    Given I accepted "Write the summary"
    When the agent publishes another report afterwards
    Then Done stays ticked and the panel says "Accepted … · a report since"
    And the Feed says "Claude published after you accepted “Write the summary”"

  Scenario: Reopening is mine too
    Given I accepted "Write the summary"
    When I untick Done
    Then the panel shows how the work stands again, and the agent can be asked to carry on

  Scenario: Ordinary tasks are as before
    Given "Call the plumber" is a task no agent was given
    Then its checkbox ticks and unticks it as before, with no work panel and no Review

  Scenario: Settings covers everything Project 2 brought
    When I open Settings › Objects
    Then it explains Project, Task, Agent profile, Agent, Report, Evidence, Feedback and Question
      or approval, and, on a task and in the Feed, Question, Activity, Checklist, Evidence and Review
    And in a space whose Task type was renamed and that has its own task type, those show as named
