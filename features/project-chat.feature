Feature: A project's chat
  A page linked to a folder has a chat of its own, in a card beside the page: Claude Code works
  in the folder with its own file and shell tools. The chat lives in the project runtime, so it
  keeps going with the card closed or the app quit, and comes back as it was. Its turns look as
  the note chat's do. Note chats on pages are unchanged. Answering the agent's questions, and
  approvals over durable receipts, come with features/agent-interactions.feature.

  Names used below:
  - "Research": a page linked to "~/LL QA/My Project" (features/external-projects.feature),
    which holds notes.txt ("hello") and data/totals.csv
  - Chat: the button in the folder row that opens the project's chat beside the page

  Background:
    Given linked folders and project chats are on (Settings › AI › Projects)
    And "Research" is linked to "~/LL QA/My Project"

  Scenario: Open the project's chat
    When I press Chat in "Research"'s folder row
    Then a card "Research › Chat" opens beside the page
    And it says "What should we do in My Project?" above the composer

  Scenario: Claude works in the exact folder, and its answer streams
    Given access is Full access
    When I send "Run pwd, then read notes.txt and tell me what it says"
    Then my message shows on the right at once
    And the reply's words appear as they are written, under "Working for …"
    And the steps show it ran pwd and read notes.txt
    And the answer says the folder is "~/LL QA/My Project" and notes.txt says "hello"
    And the turn ends with "Worked for …"

  Scenario: A named output opens from the chat
    Given access is Full access
    When I send "Write a short summary of notes.txt to summary.md"
    Then the turn lists "summary.md" under it
    When I press "summary.md"
    Then a dialog shows summary.md as it is in the folder now

  Scenario: Stop
    When I send "Run sleep 60, then say done"
    And I press Stop while it runs
    Then the turn ends with "Stopped" and the composer takes a new message

  Scenario: An approval in Ask for approval
    Given access is Ask for approval
    When I send "Create hello.txt containing hi"
    Then a card asks to use Write, showing the file, with Yes, "Yes, and don't ask again this session"
      and No
    When I press Yes
    Then hello.txt holds "hi" and the turn ends

  Scenario: The chat comes back after closing it and after a reload
    Given a chat in "Research" with two turns
    When I close the chat's card and press Chat again
    Then the same chat shows both turns
    When I reload the app
    Then the chat shows both turns, and a new message continues it with what was said before

  Scenario: Several chats in one project
    Given a chat in "Research"
    When I choose New chat from the chat menu and send a message
    Then the chat menu lists both chats under "In “Research”", newest first
    And choosing the first shows its turns

  Scenario: An error says what happened
    Given the folder linked to "Research" is gone
    When I open the chat
    Then it says the folder isn't there, and the folder row offers Relink…

  Scenario: Note chats are unchanged
    When I press Ask on "Research" and send a question about the page
    Then the agent panel answers about the page, as before, not in the folder
