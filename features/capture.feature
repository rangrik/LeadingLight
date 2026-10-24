Feature: Idea capture
  Ideas come at random times and are lost unless they get out at once. ⌃⌥I opens a small box
  over whatever app is in front, with the cursor already in it. What is typed is saved as it
  goes: each idea is its own Idea page, and a line in today's daily note, under an "Ideas"
  heading, points at it. Nothing to confirm, nothing to file.

  Names used below:
  - capture box: dialog "New idea", 640 px wide, near the top: a title line (textbox "Idea",
    18 px semibold) over the body, and a footer in 13 px muted text
  - body: the block editor itself (textbox "Notes", 15 px): the slash menu, lists, to-dos,
    links and the rest of editor.feature, without the block handle (there is no gutter for it)
  - footer: on the left a lightbulb (amber, the Idea type's colour) and "New idea", a dot, a
    calendar (blue) and "Linked in Today", a dot, "#" and "in-the-middle"; on the right "Saved"
    with a check once the idea is saved, then "⌘↩" "Open" and "esc" "Close"
  - in-the-middle: the tag every captured idea gets, a tag page made the first time
  - "New idea" row: button "New idea" in the sidebar, right under "Today", with a lightbulb
    and "⌃⌥I" at its right end while the pointer is over it
  - Today: the daily note for the current day (features/everyday-objects.feature)
  - "Ideas" heading: a heading reading "Ideas" in Today's body, with a bullet list under it
  - the app: the Mac app, where the box is a floating panel of its own. The browser build has
    no global shortcut: there the row, and ⌃⌥I while the window has focus, open the same box
    inside the window.

  Background:
    Given the app is open in a browser at 1280x800 with no stored data

  Scenario: Opening the box from the sidebar
    When I click "New idea" in the sidebar
    Then the capture box shows, 640 px wide, centred, its top about 15% down the window
    And the title line is focused and empty, with the placeholder "Type your idea"
    And the body shows the placeholder "It saves as you go and shows up in Today."
    And the footer's right side shows only "esc" "Close"
    And the page behind it is unchanged

  Scenario: The shortcut toggles the box while the window has focus
    When I press Control+Alt+I
    Then the capture box shows with the title line focused
    When I press Control+Alt+I again
    Then the box is gone

  Scenario: Typing saves an Idea page and a line in Today
    When I click "New idea" and type "Walk the long way" in the title line
    Then within a second the footer shows "Saved" with a check, then "⌘↩" "Open" and "esc" "Close"
    And "Saved" stays while I keep typing; it only goes if a save fails
    And an Idea page titled "Walk the long way" is listed in the sidebar under Pages
    And Today exists, made now if it did not, and its body ends with a heading "Ideas" (level 3)
      followed by one bullet: the time ("9:14 AM", in the locale's short form), a space, and a
      link to "Walk the long way"
    When I press Enter in the title line
    Then the body is focused
    When I type "Along the river, before work", press Enter and type "No phone"
    Then the Idea page's body is two paragraphs, "Along the river, before work" and "No phone"
    And Today still has exactly one bullet under "Ideas", pointing at the page
    And the Idea page's "Tags" row shows "in-the-middle", a tag page now listed under Tags

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
    When I select "second" with Shift+Home
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
    And the box's footer shows "#" "in-the-middle"

  Scenario: Only the body typed takes its first line as the title
    When I click "New idea", press Enter and type "Buy a kite" in the body
    Then an Idea page exists titled "Buy a kite", whose body is "Buy a kite"
    And Today's bullet links to "Buy a kite"

  Scenario: An empty box saves nothing
    When I click "New idea" and press Escape
    Then no page was made, and no daily note was made
    When I press Enter in the empty title line
    Then the body is focused and still no page was made

  Scenario: Emptying the box after a save keeps the page
    When I click "New idea", type "x", wait a second, press Backspace and press Escape
    Then an Idea page named "Untitled" remains, with its bullet in Today
    # The keystroke was saved, and the box never deletes a page. Delete it like any page.

  Scenario: Escape closes the box and gives focus back
    Given a page is open and its body has focus
    When I click "New idea", type "Call Sam" and press Escape
    Then the box is gone and the page body has focus again, not the sidebar row
    And the same holds when the box was opened with Control+Alt+I
    # In the app: the keyboard goes back to the app that was in front (see the last scenarios).

  Scenario: Tab stays in the box
    Given the box is open with the title line focused
    When I press Tab
    Then the body is focused
    When I press Tab in the body
    Then the cursor stays in the body (in a list it indents the item); Escape still closes the box

  Scenario: ⌘↩ opens the idea in the main window
    Given the box is open with "Call Sam" typed
    When I press Meta+Enter
    Then the box is gone and the page "Call Sam" is open, its title field reading "Call Sam"
    And the cursor is at the end of its body, so typing goes on there
    And its Backlinks section lists Today with the line "9:14 AM @Call Sam"

  Scenario: ⌘↩ right after the first keystroke still opens the idea
    When I click "New idea", type "Quick" and press Meta+Enter at once
    Then the page "Quick" opens; the save finished before the box closed

  Scenario: A very long first line
    When I click "New idea" and type a 300-character title with no spaces
    Then the title line stays one line and scrolls; nothing wraps or spills out of the box
    And the page's title is the whole 300 characters
    And in Today, the link wraps onto further lines like text, its icon on the first

  Scenario: The second idea of the day joins the list
    Given an idea "First" was captured today
    When I capture "Second"
    Then Today has one "Ideas" heading with two bullets, "First" then "Second", each with its time

  Scenario: The "Ideas" heading was moved
    Given Today has the heading "Ideas" with one bullet, and a paragraph "Plans" after it
    And I move the "Ideas" heading and its list to the top of the page
    When I capture "Third"
    Then the new bullet joins the list under the heading at the top; nothing is added at the end

  Scenario: The "Ideas" heading was deleted
    Given Today had an "Ideas" heading and I deleted it and its list
    When I capture "Again"
    Then a new "Ideas" heading (level 3) with one bullet is added at the end of Today

  Scenario: Today is open while an idea is captured
    Given Today is open in a pane and I typed "morning" in its body
    When I capture "Live one"
    Then the bullet appears in the open pane at once, without a reload, and "morning" is still there
    And after a reload the bullet and "morning" are still there

  Scenario: Ideas linked in Today don't show twice
    Given an idea "Once" was captured today, and a page "Other" was made today by hand
    When I open Today
    Then "Created this day · 1" lists "Other" and not "Once", which is in the body already

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
    And the idea is in LeadingLight: its page, and the line in Today

  Scenario: ⌘↩ brings LeadingLight forward
    Given the box is open over another app with "Call Sam" typed
    When I press ⌘↩
    Then the box is gone, LeadingLight comes to the front and "Call Sam" is open

  Scenario: Clicking elsewhere closes the box
    Given the box is open over another app
    When I click in that app
    Then the box is gone; what was typed is saved

  Scenario: Closing the main window keeps the shortcut working
    When I close the main window with the red button
    Then the Dock icon stays, ⌃⌥I still opens the box, and clicking the Dock icon brings the window back
    And ⌘Q quits
