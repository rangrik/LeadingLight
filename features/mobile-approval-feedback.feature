Feature: Answer Mac agent requests from iPhone and iPad
  Decisions and feedback belong to the selected Mac conversation. A lost reply
  keeps the original answer for an explicit retry, without granting more access.

  Scenario: Decline a Claude request with a reason
    Given Claude asks to run a command on my paired Mac
    When I enter "Use the test database instead" as feedback and choose Decline
    Then that request receives deny with my message
    And no session-wide or automatic approval is granted

  Scenario: Give Codex feedback after declining
    Given Codex asks to change a file on my paired Mac
    When I enter feedback and choose Decline
    Then the approval response is decline without an unsupported message field
    And my feedback remains available as a separate follow-up
    When the Mac confirms my decline and I choose Send feedback
    Then the same conversation receives my feedback as a normal message
    And retrying that message uses the same request ID

  Scenario: Keep planning with feedback
    Given Claude presents a plan on my paired Mac
    When I enter a correction and choose Keep planning
    Then the request receives keep_planning with my correction
    And the phone cannot choose automatic edit approval

  Scenario: Correct feedback after the Mac refuses the answer
    Given the Mac explicitly refused my Codex decline before writing it to the agent
    When I revise the saved feedback and retry the decline
    Then the feedback waits for the new decline command to be confirmed
    And I can send the revised feedback only after that confirmation
    And a refusal for one request cannot move feedback to another request or agent session

  Scenario: Recover a confirmed decline after the Mac app restarts
    Given my Codex decline was written before the Mac app restarted
    And I have not sent its saved feedback
    When I reopen that same conversation
    Then the recorded decline retains its original command identity
    And I can explicitly send the saved feedback without declining again

  Scenario: Recover an unsent answer that expires after closing the dialog
    Given I typed feedback for a pending request on my Mac
    And a request refresh is still in progress
    When I close the agent dialog and that refresh reports the request expired
    And I reload the app and open the same conversation
    Then my unsent words return to the message field once
    And no approval or message is sent automatically
    And if saving the restored words fails, the original answer stays saved for recovery

  Scenario: Keep an answer after a lost acknowledgement
    Given I declined with feedback but the Mac's reply was lost
    When I reopen the conversation
    Then no answer or feedback is sent automatically
    And the saved decision and feedback cannot be changed while delivery is uncertain
    When I explicitly retry
    Then the same command ID and answer are sent

  Scenario: Answer a question with selections and my own words
    Given the agent asks a question allowing several answers
    When I type my own answer and select two options
    And I send the answer
    Then the agent receives both options and my words together

  Scenario: Revise a single-choice question before it sends
    Given the agent asks a single-choice question
    When I select an option and immediately type my own answer
    Then the earlier option is not submitted by a delayed action
    When I send my words
    Then the agent receives only my own answer
