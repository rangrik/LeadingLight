Feature: History without managing versions
  Changes are saved locally with their history. A named milestone keeps a useful moment.
  Restoring makes a new version, so later work is never erased from history.

  Scenario: Automatic history and a milestone survive a restart
    Given a page with the title "Launch notes" and the words "First draft"
    When I open "Page history" and save a milestone named "Before review"
    And I change the words to "Reviewed draft" and reload the app
    Then "Before review" still previews "First draft"
    And the latest version previews "Reviewed draft"

  Scenario: Restore without losing the current version
    Given "Before review" is an earlier milestone
    When I restore that version
    Then the page shows the earlier title, body and properties
    And history keeps the version from before the restore
    And restoring again cannot erase either version

  Scenario: Undo a whole agent action
    Given an agent action creates a task and links it from my note
    When I undo that action from history
    Then the task and link are both removed in one saved change
    And the action and undo remain in history

  Scenario: Preserve later work when undo overlaps it
    Given I edited the task after an agent created it
    When I try to undo the agent action
    Then the app explains that there are newer changes
    And no page in the action changes

  Scenario: A failed save is not a saved version
    Given local storage rejects a write
    When I edit a page
    Then the page keeps its unsaved edits and reports the failure
    And neither a successful save nor a history entry is reported

  Scenario: Concurrent writers cannot silently replace a newer page
    Given two browser tabs opened the same revision
    When both save different changes
    Then a stale save is refused and its text remains available
    And the newer saved revision is preserved

  Scenario: A human writes between agent steps
    Given an agent changes a page in two steps of one turn
    And I edit that page between those steps
    When I choose "Undo entire action"
    Then the app refuses to remove the intervening human edit
    And no page in the action changes

  Scenario: Safari closes during a save
    Given I have just typed words or changed a property
    When Safari reloads before the asynchronous save finishes
    Then the local recovery record preserves the last edit
    And an overlapping newer version is kept separately

  Scenario: Deleting immediately after typing keeps the last words in history
    Given I have just typed into an open page
    When I delete that page before autosave finishes
    Then the deletion records the latest words
    And undoing the deletion restores them
