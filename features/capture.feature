Feature: Idea capture
  Ideas come at random times and are lost unless they get out at once. ⌃⌥I opens a small box
  over whatever app is in front, with the cursor already in it. What is typed is saved as it
  goes: each idea is its own Idea page, which shows in the day's note because it was made that
  day. It can be put in a project from the box. Nothing to confirm, nothing to file.

  Names used below:
  - capture box: dialog "New idea", 640 px wide, near the top: a header bar, a title line
    (textbox "Idea", 18 px semibold), the body, and a footer. It wears the app's theme: the
    theme's popover colour, text and border, in light and dark alike.
  - header bar: one 13 px muted line across the top, a hairline under it. On the left a
    lightbulb (amber, the Idea type's colour) and "New idea", a dot, a calendar (blue) and
    "In Today", a dot, "#" and "in-the-middle". At the right end the project picker.
  - project picker: button "Project", reading "No project" (muted, with a folder icon) or the
    project's icon and title. It opens a popover with a searchbox "Find or create a project",
    the Project pages (most recently changed first), "No project" while one is set, and
    "Create project “<typed>”" when nothing matches exactly.
  - body: the block editor itself (textbox "Notes", 15 px): the slash menu, lists, to-dos,
    links and the rest of editor.feature, without the block handle (there is no gutter for it)
  - footer: 13 px muted. On the left "Saved" with a check once the idea is saved. On the right
    "⇧⌘↩" "Open beside" and "⌘↩" "Save" once anything is typed, and "esc" "Close" always.
  - in-the-middle: the tag every captured idea gets, a tag page made the first time
  - "New idea" row: button "New idea" in the sidebar, right under "Today", with a lightbulb
    and "⌃⌥I" at its right end while the pointer is over it
  - Today: the daily note for the current day (features/everyday-objects.feature), whose
    "Created this day" list shows what was made that day
  - the app: the Mac app, where the box is a floating panel of its own. The browser build has
    no global shortcut: there the row, and ⌃⌥I while the window has focus, open the same box
    inside the window.

  Background:
    Given the app is open in a browser at 1280x800 with no stored data

  Scenario: Opening the box from the sidebar
    When I click "New idea" in the sidebar
    Then the capture box shows, 640 px wide, centred, its top about 15% down the window
    And the header bar reads "New idea · In Today · # in-the-middle", with "No project" at its right end
    And the title line is focused and empty, with the placeholder "Type your idea"
    And the body shows the placeholder "It saves as you go and shows up in Today."
    And the footer shows only "esc" "Close", on the right
    And the page behind it is unchanged

  Scenario: The shortcut toggles the box while the window has focus
    When I press Control+Alt+I
    Then the capture box shows with the title line focused
    When I press Control+Alt+I again
    Then the box is gone

  Scenario: Typing saves an Idea page that shows in Today
    When I click "New idea" and type "Walk the long way" in the title line
    Then within a second the footer shows "Saved" with a check on the left, and "⇧⌘↩" "Open
      beside", "⌘↩" "Save" and "esc" "Close" on the right
    And "Saved" stays while I keep typing; it only goes if a save fails
    And an Idea page titled "Walk the long way" is listed in the sidebar under Pages
    And no daily note was made or changed by the save
    When I press Enter in the title line
    Then the body is focused
    When I type "Along the river, before work", press Enter and type "No phone"
    Then the Idea page's body is two paragraphs, "Along the river, before work" and "No phone"
    And the Idea page's rows are Project (empty), Tags ("in-the-middle", a tag page now listed
      under Tags), Created and Updated, both today at the time it was made
    When I open Today
    Then its body is untouched, and "Created this day · 1" lists "Walk the long way" with its icon

  Scenario: Return in the body adds a paragraph
    Given the box is open with "Idea" in the title line and the body focused
    When I type "one", press Enter and type "two"
    Then the body has two paragraphs and the box is still open

  Scenario: The body is the whole block editor
    Given the box is open with "Plan" in the title line and the body focused
    When I type "/"
    Then the block menu (listbox "Insert block") opens over the box, not under it, and fits the box's window
    When I press Escape
    Then the menu closes and the box is still open
    When I type "- first" and press Enter, then "second"
    Then the body is a bullet list of two items, and the page's body has the same list
    When I select "second" with Shift+Meta+ArrowLeft
    Then the formatting toolbar shows; pressing Meta+B makes it bold
    And no block handle shows beside the lines

  Scenario: Links from the box
    Given pages "Dune" and "Notes" exist and the box is open with the body focused
    When I type "Read @dun" and press Enter
    Then the line holds a link to "Dune", and so does the saved page
    When I type "@Arrakis" and pick "Page" under "Create “Arrakis”"
    Then a page "Arrakis" exists, listed in the sidebar, and the line links to it
    # In the app the panel asks the main window to make the page, so there is one writer.

  Scenario: Every captured idea is tagged in-the-middle
    When I capture "First" and then "Second"
    Then both Idea pages have the tag "in-the-middle"
    And there is one tag page "in-the-middle" under Tags, which lists both ideas
    And the box's header bar shows "#" "in-the-middle"

  Scenario: Putting the idea in a project
    Given the Project pages "House" and "Garden" exist
    When I click "New idea" and click "No project"
    Then the project picker opens with the searchbox focused, listing "Garden" and "House"
    When I type "hou" and press Enter
    Then the picker closes, reads "House" with its icon, and the title line has focus again
    When I type "Paint the porch"
    Then the Idea page "Paint the porch" has the Project "House"
    And "House" has no "Ideas" property row; at its end, before Backlinks, "Linked ideas · 1"
      shows a small card with the idea's icon and title and its tag "in-the-middle"
    When I pick "No project" in the picker
    Then the idea's Project is empty again

  Scenario: The project is chosen before anything is typed
    Given the Project page "House" exists
    When I click "New idea", pick "House" and press Escape
    Then no page was made
    When I click "New idea"
    Then the picker reads "No project"; each box starts fresh

  Scenario: Making a project from the picker
    When I click "New idea", click "No project", type "Boat" and pick "Create project “Boat”"
    Then a Project page "Boat" exists, listed under Projects, and the picker reads "Boat"
    # In the app the main window makes the project, as it does for "@" (DECISIONS.md, 14).

  Scenario: The picker by keyboard
    Given the title line has focus
    When I press Shift+Tab
    Then the project picker has focus; Enter or Space opens it, Escape closes only the picker
    And a second Escape closes the box
    When I press Shift+Tab on the picker
    Then the picker keeps focus; the keyboard never leaves the box

  Scenario: ⇧⌘↩ from Settings
    Given Settings is open
    When I press Control+Alt+I, type "From settings" and press Shift+Meta+Enter
    Then Settings closes and "From settings" is open beside the page that was in view

  Scenario: "@" in the box offers the page in view
    Given the page "Dune" is open
    When I open the box, press Enter and type "@dun"
    Then "Dune" is offered; the page in view is not the page being written

  Scenario: A long project name
    Given a Project page whose title is 80 characters long
    When I pick it in the picker
    Then the picker shows its start and an ellipsis, and the header's left side keeps its words whole

  Scenario: Every idea shows in its day
    Given the Idea page "Old idea" was made by hand, not from the box, yesterday
    When I open yesterday's note
    Then "Created this day" lists "Old idea"
    And "Old idea" shows Created and Updated rows, as every Idea page does

  Scenario: Only the body typed takes its first line as the title
    When I click "New idea", press Enter and type "Buy a kite" in the body
    Then an Idea page exists titled "Buy a kite", whose body is "Buy a kite"
    And Today's "Created this day" lists "Buy a kite"

  Scenario: An empty box saves nothing
    When I click "New idea" and press Escape
    Then no page was made
    When I press Enter in the empty title line
    Then the body is focused and still no page was made

  Scenario: Emptying the box after a save keeps the page
    When I click "New idea", type "x", wait a second, press Backspace and press Escape
    Then an Idea page named "Untitled" remains, listed in Today's "Created this day"
    # The keystroke was saved, and the box never deletes a page. Delete it like any page.

  Scenario: Escape closes the box and gives focus back
    Given a page is open and its body has focus
    When I click "New idea", type "Call Sam" and press Escape
    Then the box is gone and the page body has focus again, not the sidebar row
    And the same holds when the box was opened with Control+Alt+I
    # In the app: the keyboard goes back to the app that was in front (see the last scenarios).

  Scenario: Blank space under the body belongs to the body
    Given the box is open with "Plan" in the title line
    When I click the empty area under the body's last line
    Then the cursor is at the end of the body, and Escape, ⌘↩ and ⇧⌘↩ still work

  Scenario: Tab stays in the box
    Given the box is open with the title line focused
    When I press Tab
    Then the body is focused
    When I press Tab in the body
    Then the cursor stays in the body (in a list it indents the item); Escape still closes the box

  Scenario: ⌘↩ saves and closes
    Given a page "Home" is open and its body has focus
    When I click "New idea", type "Call Sam" and press Meta+Enter
    Then the box is gone, the Idea page "Call Sam" is saved, and "Home" is still the only page in view
    And the page body of "Home" has focus again

  Scenario: ⌘↩ right after the first keystroke still saves
    When I click "New idea", type "Quick" and press Meta+Enter at once
    Then the box is gone and an Idea page "Quick" exists; the save finished before the box closed

  Scenario: ⌘↩ with nothing typed
    When I click "New idea" and press Meta+Enter
    Then the box is gone and no page was made

  Scenario: ⇧⌘↩ opens the idea beside the page in view
    Given a page "Home" is open, alone
    When I click "New idea", type "Call Sam" and press Shift+Meta+Enter
    Then the box is gone, "Home" stays in its pane on the left, and "Call Sam" opens in a new pane on its right
    And the cursor is at the end of the idea's body, so typing goes on there

  Scenario: ⇧⌘↩ never replaces what is in view
    Given "Home" and "Notes" are open side by side, "Notes" on the right with focus
    When I capture "Third" and press Shift+Meta+Enter
    Then "Home" and "Notes" both stay open and "Third" opens to the right of "Notes"
    Given no page is open
    When I capture "Fourth" and press Shift+Meta+Enter
    Then "Fourth" opens as the only page

  Scenario: ⇧⌘↩ with nothing typed
    When I click "New idea" and press Shift+Meta+Enter
    Then the box stays open and nothing was made

  Scenario: A very long first line
    When I click "New idea" and type a 300-character title with no spaces
    Then the title line stays one line and scrolls; nothing wraps or spills out of the box
    And the page's title is the whole 300 characters
    And in Today's "Created this day" the title is cut with an ellipsis, on one line

  Scenario: Today is open while an idea is captured
    Given Today is open in a pane and I typed "morning" in its body
    When I capture "Live one"
    Then "Created this day" in the open pane lists "Live one" at once, without a reload
    And Today's body still reads "morning" and nothing else, before and after a reload

  Scenario: Ideas an older build linked in Today don't show twice
    Given Today's body has an "Ideas" heading with a bullet linking the idea "Once", from an older
      build, and the page "Other" was made today
    When I open Today
    Then the bullet is left as it was, and "Created this day · 1" lists "Other" and not "Once"

  Scenario: The box wears the theme
    Given Settings › Appearance has a dark theme picked
    When I click "New idea"
    Then the box's background is the theme's popover colour, its text the theme's foreground and
      its border the theme's border colour; nothing in it is white
    When I pick a light theme and open the box again
    Then it matches that theme the same way

  Scenario: Settings › Capture
    When I open Settings and pick "Capture"
    Then a group shows "New idea shortcut" with a "⌃⌥I" key button, and "Open at login" with a switch
    # The key button changes the key as Settings › Shortcuts does (features/shortcuts.feature).
    # In a browser the switch is disabled: there is nothing to start at login.

  # The app only. The panel can't be driven by tests; try these in the Mac app.

  Scenario: ⌃⌥I from another app
    Given LeadingLight is running and another app is in front
    When I press Control+Option+I
    Then the box shows over that app, near the top of the screen, with the cursor in the title line
    And that app stays in front: its menu bar stays, and LeadingLight's window does not come forward
    When I type and press Escape
    Then the box is gone and the keyboard is back in that app
    And the idea is in LeadingLight: its page, listed in Today's "Created this day"

  Scenario: ⌘↩ over another app saves and stays out of the way
    Given the box is open over another app with "Call Sam" typed
    When I press ⌘↩
    Then the box is gone, the keyboard is back in that app, and LeadingLight stays behind it
    And "Call Sam" is saved, listed in Today's "Created this day"

  Scenario: ⇧⌘↩ brings LeadingLight forward with the idea beside
    Given LeadingLight shows "Home" and the box is open over another app with "Call Sam" typed
    When I press ⇧⌘↩
    Then the box is gone, LeadingLight comes to the front, "Home" is still open and "Call Sam" is beside it on the right

  Scenario: No dark rim around the box
    Given a light theme
    When I press ⌃⌥I over a white window
    Then the box's edge is the theme's own border, with a soft shadow below; no black outline rings it

  Scenario: The panel follows a theme change
    Given LeadingLight is running with a light theme and the box has been opened once
    When I pick a dark theme in Settings › Appearance and press ⌃⌥I
    Then the box is dark, matching the window behind it
    And the same holds when the theme follows the system and macOS switches to dark

  Scenario: Clicking elsewhere closes the box
    Given the box is open over another app
    When I click in that app
    Then the box is gone; what was typed is saved

  Scenario: Closing the main window keeps the shortcut working
    When I close the main window with the red button
    Then the Dock icon stays, ⌃⌥I still opens the box, and clicking the Dock icon brings the window back
    And ⌘Q quits
