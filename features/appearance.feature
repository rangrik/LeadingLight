Feature: Appearance and settings
  The app ships Shipyard's themes and its Settings page (vendor/shipyard). A theme
  colours every surface, menu and the editor's code blocks at once. Settings takes the
  sidebar's place while open and goes back on Escape.

  Names used below:
  - Settings: the page opened with Meta+, or from the menu bar's app menu
  - theme card: a button under Settings › Appearance › Theme named after the theme

  Background:
    Given the app is open in a browser at 1280x800

  Scenario: Settings opens with Meta+, and closes with Escape
    When I press Meta+,
    Then Settings is shown in the app's own shell: the sidebar with the mark and "LeadingLight" at
      its top, "Back to app", then Appearance, Shortcuts and About; the section in the panel, Appearance first
    And the pages underneath are covered and inert: no click or key reaches them
    And Meta+\ folds and unfolds the sidebar as it does on a page
    When I press Escape
    Then the pages are shown again, on the page that was open
    When I open Settings › Appearance, open the theme menu and press Escape
    Then only the menu closes, and Escape again closes Settings, with or without a click on a blank spot first
    And Escape in a Settings text field leaves Settings open

  Scenario: Settings never touches the page's edits
    Given I have typed "first words" into the body
    When I press Meta+, and then Escape
    Then the body still reads "first words" and typing goes on from there
    And nothing typed while Settings is open reaches the page
    And after a reload the body holds everything typed before and after

  Scenario: Meta+N inside Settings makes a page and goes to it
    Given Settings is open
    When I press Meta+N
    Then Settings closes and a new "Untitled" page is open with the title focused

  Scenario: Light, Dark and Match system
    Given Settings › Appearance is open
    Then "Light or dark" offers Light, Dark and Match system, with Match system chosen
    When I choose Dark
    Then the page background is dark and the sidebar, menus and editor follow
    When I choose Light
    Then the page background is light again

  Scenario: Picking a theme colours the whole app
    Given Settings › Appearance is open
    When I click the theme card "Dracula"
    Then the page background is Dracula's #282a36 and its card shows a check
    And the sidebar, the page panel, the editor text and the code block tokens use Dracula's colours
    And the choice survives a reload

  Scenario: Match system follows the browser with its own pair
    Given Settings › Appearance is open and Match system is chosen
    And the browser prefers a dark color scheme
    Then the app is in the dark theme of the pair ("Shipyard Dark" unless changed)
    When the browser prefers a light color scheme
    Then the app is in the light theme of the pair

  Scenario: Themes can be searched
    Given Settings › Appearance is open
    When I type "nord" into "Find a theme"
    Then only the "Nord" card is listed

  Scenario: Text size steps the interface, not the page body alone
    Given Settings › Appearance is open
    When I choose "Large" under Text size
    Then the sidebar rows, Settings text, page title and editor body are larger
    When I press Meta+0
    Then the text is back to the default size

  Scenario: Every theme keeps its text readable
    Then the contrast check (pnpm check:themes) passes for every built-in theme
    And it covers the editor in dark themes: selected blocks stand clearly apart from the page
      (further than a hovered row), text on them stays 4.5:1, and an unticked to-do box's edge is 3:1

  Scenario: Selected blocks and to-do boxes in dark mode
    Given a page with a heading, a paragraph and two to-dos, one ticked, in LeadingLight Dark
    When I press Meta+A twice
    Then every block shows a blue tint that reads at a glance against the page, as one shape
    And the unticked box is plainly an outlined box, not a faint smudge
    And the same holds in Solarized Dark, Tokyo Night and One Dark Pro
    And in light mode both look as before

  Scenario: About says which build this is
    Given Settings › About is open
    Then it shows the version, the commit the app was built from (with "+dirty" if the tree
      had uncommitted changes), when it was built, and the Shipyard version it is built on
    And the same commit shows beside "About" in the sidebar

  Scenario: Choose a content width
    When I open Settings › Appearance
    And set "Content width" to 800 pixels
    Then page text uses up to 800 pixels, with its usual handle and note gutters
    And the title, properties and body line up
    And the width survives a reload and applies to every open page
    When I turn on "Full width"
    Then the page uses all the room in its pane, keeping those gutters
    When I turn "Full width" off
    Then my 800 pixel width is restored
    And a narrow pane fits its text to the space available without horizontal scrolling
    And widths outside 320 to 1600 pixels are clamped to that range

  Scenario: Commit content width from the keyboard
    Given Settings › Appearance is open with Content width focused
    When I replace the value with 800 and press Enter
    Then 800 is saved and the field gives up focus
    When I press Escape
    Then Settings closes and page text uses up to 800 pixels
    When I reopen Appearance, replace Content width with 900 and press Escape directly
    Then 900 is saved, Settings closes, and page text uses up to 900 pixels
    And the new width remains after a reload

  Scenario: Keyboard shortcuts are listed in one place
    Given Settings › Shortcuts is open
    Then it lists "New page" with ⌘N, "Save now" with ⌘S, "Show or hide the sidebar" with ⌘\ and "Settings" with ⌘,
    And the editor's own keys (⌘B, ⌘I, ⌘/ for the block menu) are not in it: the editor shows those
    When I press Meta+Alt+/
    Then the Keyboard shortcuts sheet opens with the same list
    And Meta+/ in the editor opens the block menu, not the sheet

  # Native only: the menu bar is built from the same table (src-tauri/src/menu.rs),
  # so macOS can never take ⌘N or ⌘\ before the page sees them.
