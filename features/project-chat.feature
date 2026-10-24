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
    And the steps say "Ran pwd" and "Read notes.txt", and the timer counts the seconds
    And the newest words stay in view while I'm at the bottom of the chat
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
    Then a card asks to write the file (features/agent-interactions.feature), and no hello.txt is listed yet
    When I press Allow once
    Then hello.txt holds "hi", the turn lists it, and the turn ends

  Scenario: Access and Plan mode apply to a chat already started
    Given a chat started in Full access
    When I choose Ask for approval in its access menu and ask it to write a file
    Then it asks first, and the menu still says Ask for approval
    When I turn Plan mode on from +
    Then its agent plans and changes nothing

  Scenario: A new chat's settings are its own
    When I start a new chat in Full access with Sonnet
    Then the note chat's Ask button and access are as they were
    And the + menu offers only Plan mode, since a project chat has no pages or commands to add

  Scenario: The chat comes back after closing it and after a reload
    Given a chat in "Research" with two turns
    When I close the chat's card and press Chat again
    Then the same chat shows both turns
    When I reload the app
    Then the chat shows both turns, and a new message continues it with what was said before

  Scenario: Several chats in one project
    Given a chat in "Research"
    When I choose New chat from the chat menu and send a message, and do it once more
    Then each new chat sends and answers
    And the chat menu lists them under "In “Research”", newest first, long titles cut short
    And choosing the first shows its turns

  Scenario: An error says what happened
    Given the folder linked to "Research" is gone
    When I open the chat
    Then it says the folder isn't there, and the folder row offers Relink…

  Scenario: The folder goes while the chat is open
    Given the chat is open and the folder is renamed on disk
    When I send a message
    Then no agent starts anywhere, and the chat says the folder isn't there

  Scenario: Note chats are unchanged
    When I press Ask on "Research" and send a question about the page
    Then the agent panel answers about the page, as before, not in the folder

  # Codex (slice 5a): the same chat, with a GPT model

  Scenario: A chat with Codex
    Given Codex is installed and signed in
    When I start a new chat, pick a GPT model and low effort, and send "Run pwd, then read notes.txt"
    Then Codex answers in "~/LL QA/My Project", with the steps and the answer as Claude's show
    And the conversation runs Codex with that model and effort (the runtime's conversations)
    And the composer says "Ask Codex to work in the folder…"

  Scenario: Codex's access, in its own words
    Given a new chat with a GPT model
    Then the access menu offers Ask for approval (Codex asks before each command and change),
      Approve for me (Codex works freely inside the folder and asks before going outside it) and
      Full access
    When the chat has started in one of them and I choose another
    Then the session's mode follows (Ask is untrusted, Approve for me is default, Full is
      bypassPermissions) and Codex works that way from its next step

  Scenario: A started chat keeps its agent
    Given a Codex chat and a Claude chat in "Research"
    Then each one's model menu offers only its own agent's models
    And choosing one from the chat menu shows its turns and continues with its agent

  Scenario: Codex chats come back
    When I stop a Codex chat's turn, reload the app, and send again
    Then it resumes in the same folder and answers with what was said before

  Scenario: No Codex
    Given Codex is not installed, or not signed in
    Then the model menu says so where the GPT models would be, and a new chat stays with Claude

  # Model, effort, files and the agent's own skills and tools (slice 5b)

  Scenario: Change the model and effort of a started chat
    Given a Claude chat that has answered once with Sonnet
    When I pick Haiku and Medium effort in its model menu and send "Which model are you?"
    Then the agent answers as Haiku, and the menu and the runtime's conversation say Haiku, Medium
    And a Codex chat changed the same way runs its next turn with the new model and effort
    And while a turn runs the model menu waits until it ends

  Scenario: Attach files to a message
    When I choose + › Add files… and pick notes.png and a 3 MB report.pdf
    Then both show as chips above the field, each with a way to take it off
    When I send "What is in these files?"
    Then my message shows the two file names, and the agent describes both
    And nothing was written into "~/LL QA/My Project" (the files are kept with the chat)
    And a file over 20 MB is refused with its size, and nothing is sent

  Scenario: The agent's own skills
    Given a chat that has started
    When I type "/"
    Then the menu lists the agent's skills and commands that work in a chat, with their descriptions
    And not the ones that need its terminal
    When I pick one and send
    Then the agent runs it

  Scenario: The agent's own MCP tools
    Given an MCP server configured in my Claude Code settings
    When I ask a Claude chat to use one of its tools
    Then the tool runs (asking first in Ask for approval) and its result shows in the answer
    And my Claude Code and Codex settings, and my MCP servers, are as they were

  # Its own branch (slice 6)

  Scenario: A chat on its own branch
    Given "Research" is linked to a Git checkout
    When I start a new chat with + › Own branch on, and ask it to change a file
    Then the chat's header shows its branch "ll/chat-…"
    And the change is on that branch in a worktree the runtime keeps, not in my checkout
    And my checkout's files and branch are as they were
    And nothing new appears beside my checkout's folder

  Scenario: Own branch only where there is Git
    Given "Research" is linked to a plain folder
    Then + doesn't offer Own branch

