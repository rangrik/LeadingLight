Feature: Making a task, project or person from the slash menu
  In the middle of writing, a new task, project, person or any other kind of page can be made
  without leaving the page. The slash menu lists every type under "New"; picking one asks for a
  name right there, and Enter makes the page and links it where the cursor was. Writing goes on.

  Names used below:
  - slash menu: listbox "Insert block" (editor.feature)
  - "New" section: the slash menu's last section, one item per type, with the type's icon and
    its name: Page, Tag, Person, Book, Meeting, Project, Task, Idea, Collection and the space's
    own types. Not Daily note, which has "@today".
  - name menu: the link menu (listbox "Link to a page") kept to one type. With nothing typed it
    shows "Type a name for the new task" (the type's name, lower case). Once something is typed,
    its first item is "New task “<typed>”", then that type's pages matching what is typed.
  - task line: tasks.feature

  Background:
    Given the app is open in a browser at 1280x800 with no stored data
    And a page "Home" is open with its body focused

  Scenario: The New section lists the types
    When I type "/"
    Then the slash menu ends with a "New" section: Page, Tag, Person, Book, Meeting, Project,
      Task, Idea and Collection, each with its type's icon
    When I type "proj"
    Then "Project" is offered under "New"

  Scenario: A task on an empty line
    When I type "/task" and press Enter
    Then the line reads "@" and the name menu shows "Type a name for the new task"
    When I type "Call the plumber" and press Enter
    Then a Task "Call the plumber" exists and the Tasks view lists it
    And the line is a task line for it, and the cursor is on an empty line below
    And "Home" is still the page in view; nothing else opened

  Scenario: A person inside a sentence
    Given the line reads "Ask " with the cursor at its end
    When I type "/person", press Enter, type "Sam Lee" and press Enter
    Then the line reads "Ask @Sam Lee " with an inline link to a new Person "Sam Lee"

  Scenario: A tag, alone on its line or in a sentence
    When I type "/tag" and press Enter
    Then the line reads "#" and the name menu shows "Type a name for the new tag"
    When I type "reading" and press Enter
    Then the line reads "#reading " with an inline tag link, never a block, and the cursor after it
    And a tag page "reading" is listed under Tags
    When I type "and /tag", press Enter, type "read" and press ArrowDown and Enter
    Then the line links "#reading" twice and no second tag was made

  Scenario: Linking one that exists instead
    Given a Project "House" exists
    When I type "/project", press Enter and type "hou"
    Then the name menu offers "New project “hou”" first, then "House"
    When I press ArrowDown and Enter
    Then the line links to "House" and no project was made

  Scenario: The name menu only offers that type
    Given a Page "Housing notes" and a Project "House" exist
    When I type "/project", press Enter and type "hous"
    Then "House" is offered and "Housing notes" is not

  Scenario: Escape keeps what was typed
    When I type "/task", press Enter, type "Later" and press Escape
    Then the menu closes, the line reads "@Later" as plain text, and no task was made
    When I type " and @Ho" on the same line
    Then the usual link menu opens, offering pages of every type

  Scenario: Nothing typed makes nothing
    When I type "/task", press Enter, then press Enter again
    Then no task was made and the menu stays open with "Type a name for the new task"

  Scenario: A double Enter makes one
    When I type "/task", press Enter, type "Once" and press Enter twice quickly
    Then exactly one task "Once" exists

  Scenario: A type made in Settings is offered
    Given I made the type "Recipe" in Settings › Types
    When I type "/rec"
    Then "Recipe" is offered under "New"
    When I press Enter, type "Dal" and press Enter
    Then a Recipe "Dal" exists and the line links to it

  Scenario: Undo removes the link, not the page
    When I make the task "Undo me" from the slash menu and press Meta+Z
    Then the link is gone from "Home" and the task "Undo me" still exists, as with "@" and Create

  Scenario: In the capture box
    Given the capture box is open with "Kitchen" in the title line and the body focused
    When I type "/task", press Enter, type "Buy tiles" and press Enter
    Then a Task "Buy tiles" exists, and the idea's body has a task line for it
    # In the app the main window makes the task, as it does for "@" (DECISIONS.md, 14).
