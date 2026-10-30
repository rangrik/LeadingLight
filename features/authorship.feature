Feature: Know where the words came from
  The page is calm by default. Show authorship reveals recorded origins, not guesses about AI.

  Scenario: Agent words stay attributed after I edit them
    Given an agent adds "A useful first draft" to my page
    When I replace "useful" with "clear"
    And I turn on "Show authorship"
    Then the unchanged words are attributed to the agent
    And my replacement is attributed to me
    And history records the agent action separately from my edit

  Scenario: Older and pasted content are described honestly
    Given a page saved before authorship tracking
    When I show authorship
    Then existing untracked content says "Origin unknown"
    And text I paste now is attributed as added by me, without claiming who composed it

  Scenario: Restore and editor undo preserve attribution
    Given a page containing both human and agent changes
    When I restore a milestone or undo typing
    Then the restored content keeps its recorded authorship
    And the restore is recorded as my action

  Scenario: Viewing authorship never changes the page
    When I turn authorship on and off
    Then the body and history do not change
    And attribution is available by touch as well as mouse

  Scenario: Authorship keeps selected recordings protected
    Given a recording block is selected above its transcript
    When I type "x"
    Then the recording and transcript are unchanged
    When I click the transcript and type " Edited later."
    Then the words appear at the cursor and are attributed to me
