Feature: Voice recordings
  A voice block keeps the original audio and adds the spoken words to the page.

  Scenario: Record and transcribe a voice note
    Given I am editing a page in the Mac app on macOS 26 or newer
    When I choose "Voice recording" from the slash menu
    And I click "Record" and allow microphone access
    And I speak and click "Stop and transcribe"
    Then the original audio is saved in the voice block
    And the transcript is inserted as editable text immediately below it
    And reopening the page keeps both the audio and the text

  Scenario: Cancel or leave a recording
    Given a voice block is recording
    When I click "Cancel" or leave the page
    Then microphone capture stops
    And no transcript is inserted

  Scenario: The microphone is unavailable
    When I click "Record" and microphone access is denied
    Then the block explains how to allow microphone access
    And I can try recording again

  Scenario: Transcription fails or no speech is found
    Given a recording has been saved
    When transcription fails or finds no speech
    Then the original audio remains playable
    And the block explains the failure and offers "Retry transcription"
    And it inserts no invented text

  Scenario: Recording in the browser
    Given I am editing a page in the browser
    When I record and stop a voice block
    Then the audio is saved and playable
    And the block explains that transcription requires the Mac app

  Scenario: Saving the audio fails
    Given I have stopped a recording
    When the audio cannot be saved
    Then the block offers "Save recording" to retry the same audio
    And transcription does not start until the audio is saved

  Scenario: Undo a quickly completed transcript
    Given my recording was saved and transcribed immediately
    When I press Command-Z in the page body
    Then only the inserted transcript is removed
    And the original audio remains playable
    And "Retry transcription" is available
    When I press Shift-Command-Z
    Then the transcript returns exactly once
    And the original audio remains playable

  Scenario: Recording in a narrow pane
    Given I am recording a voice note in a narrow pane
    Then the recording status stays readable without splitting words
    And the Stop and Cancel buttons wrap below the status when needed
    And both buttons remain inside the recording block

  Scenario Outline: Explain a microphone problem
    When I try to record and the microphone is <problem>
    Then the block explains <action>
    And I can try recording again

    Examples:
      | problem     | action                                      |
      | missing     | connect a microphone and try again          |
      | unavailable | check the input device or another audio app |
