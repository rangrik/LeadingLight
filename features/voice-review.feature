Feature: Turn a recording into ideas and tasks
  I choose what to keep. The original recording and transcript stay intact.

  Scenario: Choose a passage and make a task
    Given a saved recording has the transcript "Paint the porch. Ask Sam about colors."
    When I press "Review transcript" on the recording
    Then I can read the original transcript and play its audio
    And no idea or task has been created
    When I select "Ask Sam about colors" and press "Create from selection"
    Then the suggested title is "Ask Sam about"
    When I choose Task, enter "Ask Sam", choose a project, and press "Create task"
    Then a Task has "Ask Sam about colors" as its body and the chosen project
    And the Task links to the original recording in its source page
    And hovering its source link shows the key to open the recording
    And the source has a link to the Task beside the recording
    And its audio and full transcript are unchanged after a reload

  Scenario: Review a recording made in Quick capture
    When I open Quick capture and press "Record a voice note"
    Then recording starts once without pressing Record again
    When I stop recording and transcription succeeds
    And close Quick capture and reload the app
    Then the saved capture opens as a page with its audio and original transcript
    When I click its transcript paragraph and immediately type " Edited later."
    Then the new words appear in the page body
    And "Review transcript" still offers only the original words
    And creating an Idea from those words keeps the recording intact
    And the source page keeps "Edited later."

  Scenario: Keep a whole transcript as an idea
    Given a saved recording has a transcript
    When I press "Review transcript" and "Use whole transcript"
    And press "Create from selection" and leave the title blank
    Then saving an Idea uses the first three words for its title
    And its body keeps every word of the transcript and a source link
    And the original transcript remains editable in the source page

  Scenario: Cancel, retry, and avoid duplicates
    Given I am creating a page from a recording's transcript
    When I cancel or the save fails
    Then the original audio and transcript are unchanged
    And a save failure keeps my title, type, and project choices
    When I retry or double-click Create
    Then only one new page is created

  Scenario: A recording changes during review
    Given the review holds an earlier recording
    When the source changes before I create the new page
    Then creation asks me to review again and makes no page
    And a change during saving keeps the new page without changing unrelated source text

  Scenario: Undo only the new link
    Given I created an Idea from a recording
    When I undo in the source page
    Then only the Idea link is removed
    And the audio, full transcript, and saved Idea are kept
    When I redo
    Then the same Idea is linked without creating another page

  Scenario: Failed recognition leaves something to review later
    Given a recording has saved audio but transcription failed
    Then the page appears in Capture inbox
    And no transcript or action is invented
    When I retry transcription successfully
    Then "Review transcript" becomes available without starting automatically
