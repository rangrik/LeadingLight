Feature: Capture inbox
  Captured material can wait until I am ready to organise it.

  Scenario: Find captured material without copying it
    Given I have captured an idea, saved a webpage, and saved a voice recording
    And I have an ordinary page and an idea made outside capture
    When I open Captures in the bar (features/bar.feature)
    Then "To review" lists the three captured pages once, newest capture first
    And it does not list the ordinary page or the manually made idea
    And older ideas tagged "in-the-middle" and saved webpage sources are included
    And the sidebar shows no row, count or urgency badge for it; the bar's Captures icon counts what waits
    When I open a captured page
    Then its existing page opens, with its body and audio unchanged

  Scenario: Organise a capture without opening it
    Given an idea "Garden lights" is in Captures
    When I choose Project "Garden" and add the tag "Outside" on its row
    Then the existing idea has that project and tag
    And its other properties and body are unchanged
    And the choices remain after reloading
    And a saved webpage can also be assigned to a project

  Scenario: Review at my own pace
    Given "Garden lights" is in To review
    When I press "Mark reviewed" on its row
    Then it leaves To review and appears under Reviewed
    And it remains in Ideas and the original page is unchanged
    When I press Undo
    Then it returns to To review
    When I mark it reviewed again and reload
    Then it is still under Reviewed
    When I press "Return to inbox" on its row
    Then it returns to To review

  Scenario: A new recording returns a reviewed page to the inbox
    Given a page with a recording is under Reviewed
    When I save a new voice recording on that page
    Then the same page returns to To review with its new capture time
    And no second page is made

  Scenario: A failed review can be retried
    Given saving a review state fails
    When I press "Mark reviewed"
    Then the capture stays in To review
    And an explanation is shown on the row
    And I can retry without losing its content

  Scenario: Empty inbox and narrow panes
    Given there are no captures to review
    When I open Captures
    Then it says "Nothing waiting here"
    And it explains that ideas, webpages, and recordings appear here
    When I open Reviewed with no reviewed captures
    Then it says "No reviewed captures yet"
    And at 520 pixels the title, tabs, row actions, and property controls stay inside the pane

  Scenario: Reviewing does not fight an open editor
    Given a captured idea is also open beside Captures
    When I type in the idea and mark it reviewed from the inbox
    Then its latest text and review state both remain after reloading
    And changing its project from the inbox updates the open page too
