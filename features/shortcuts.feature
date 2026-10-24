Feature: Changing keyboard shortcuts
  Every shortcut in Settings › Shortcuts can be changed. Click its key, press the new keys, and
  it works at once: the key handler, the Mac menu bar, the Keyboard shortcuts sheet and every
  hint that shows it all follow. A change is kept on this Mac.

  Names used below:
  - key button: the button at a row's right end showing its keys (button "Keys for New page")
  - reset button: button "Use ⌘N again" left of a changed row's key button, a rotating-arrow icon;
    its place stays empty on an unchanged row
  - tip: a tooltip over the key button; it shows while recording or after a refusal, and nothing
    beside the label moves or changes height when it or the reset button shows
  - taken keys: what macOS or the editor already does with a key: Copy (⌘C), Paste (⌘V), Cut (⌘X),
    Select all (⌘A), Undo (⌘Z), Redo (⇧⌘Z, ⌘Y), Find (⌘F), Quit (⌘Q), Hide (⌘H, ⌥⌘H), Minimize (⌘M),
    Close (⌘W), Full screen (⌃⌘F), Bold (⌘B), Italic (⌘I), Underline (⌘U), Strikethrough (⇧⌘S),
    Code (⌘E), Highlight (⇧⌘H), Add sidenote (⇧⌘M), Duplicate (⌘D), Group (⌘G), Block menu (⌘/),
    Quote (⇧⌘B), lists (⇧⌘7, ⇧⌘8, ⇧⌘9), Code block (⌥⌘C), headings (⌥⌘0 to ⌥⌘6)

  Background:
    Given the app is open in a browser at 1280x800 with no stored data
    And Settings › Shortcuts is open

  Scenario: Each shortcut shows its key as a button
    Then the rows are grouped under File, View, Go and Help, as the menu bar has them
    And each row ends with its key button: "New page" ⌘N, "Save now" ⌘S, "Settings" ⌘,, "Keyboard shortcuts" ⌘⌥/
    And no row has a reset button

  Scenario: Changing a key
    When I click the "Save now" key button
    Then it reads "Type keys", and its tip says "Esc keeps ⌘S"
    When I press Meta+Shift+K
    Then the key button reads "⇧⌘K" and the hint is gone
    And a reset button "Use ⌘S again" shows left of it
    When I go back to the app, type in a page and press Meta+Shift+K
    Then the page is saved at once
    And Meta+S no longer saves

  Scenario: Esc or a click elsewhere keeps the old key
    When I click the "Save now" key button and press Escape
    Then it reads "⌘S" again and nothing changed
    When I click the "Save now" key button and click the page's title
    Then it reads "⌘S" again
    And Escape while recording does not close Settings

  Scenario: A key needs ⌘ or ⌃
    When I click the "Save now" key button and press Shift+K
    Then its tip says "Hold ⌘ or ⌃ with a letter, number or symbol." in red
    And it is still recording
    When I press Meta+Shift+K
    Then the key button reads "⇧⌘K"

  Scenario: A key another shortcut has is refused
    When I click the "Save now" key button and press Meta+N
    Then its tip says "⌘N is already used for New page." in red
    And it is still recording, and "New page" still has ⌘N

  Scenario Outline: Keys macOS or the editor use are refused
    When I click the "Save now" key button and press <press>
    Then its tip says "<keys> is already used for <what>." in red

    Examples:
      | press        | keys | what         |
      | Meta+B       | ⌘B   | Bold         |
      | Meta+C       | ⌘C   | Copy         |
      | Meta+/       | ⌘/   | Block menu   |
      | Meta+Shift+M | ⇧⌘M  | Add sidenote |
      | Control+K    | ⌃K   | editing text |

  Scenario: Pressing a shortcut's own key keeps it
    When I click the "New page" key button and press Meta+N
    Then it reads "⌘N", with no reset button, and no new page was made

  Scenario: Reset puts the default back
    Given "Save now" is changed to ⇧⌘K
    When I click "Use ⌘S again"
    Then the key button reads "⌘S" and the reset button is gone
    And Meta+S saves again

  Scenario: A reset is refused when another shortcut took the default
    Given "Save now" is changed to ⇧⌘K and then "New page" to ⌘S
    When I click "Use ⌘S again" on "Save now"
    Then its tip says "⌘S is already used for New page." in red, and "Save now" keeps ⇧⌘K

  Scenario: Holding the new keys down changes the key and does nothing else
    When I click the "New page" key button and hold Meta+Shift+P until it repeats
    Then the key button reads "⇧⌘P", no page was made, and Settings is still open

  Scenario: The messages spell keys as the rows do
    When I click the "Save now" key button and press Meta+Alt+/
    Then its tip says "⌘⌥/ is already used for Keyboard shortcuts."

  Scenario: Changing a key back by hand is the same as a reset
    Given "Save now" is changed to ⇧⌘K
    When I click its key button and press Meta+S
    Then it reads "⌘S" with no reset button

  Scenario: A change is kept after a reload
    Given "Ask Claude about the selected words, or the page" is changed to ⇧⌘J
    When I reload the app
    Then Settings › Shortcuts still shows ⇧⌘J for it
    And Meta+Shift+J in a page opens Ask

  Scenario: Every hint follows the change
    Given "Ask Claude about the selected words, or the page" is changed to ⇧⌘J
    And "Focus mode" is changed to ⌃⌘P
    And "Zoom in" is changed to ⇧⌘U
    And "New idea" is changed to ⌃⌥K
    Then the Keyboard shortcuts sheet (Meta+Alt+/) shows ⇧⌘J, ⌃⌘P and ⌃⌥K
    And the Ask button's tooltip in a page header shows ⇧⌘J
    And the selection toolbar's "Ask about this" tooltip shows ⇧⌘J
    And the Writing menu shows ⌃⌘P beside Focus mode, and Settings › Writing shows it too
    And the sidebar's "New idea" row shows ⌃⌥K on hover
    And Settings › Capture shows ⌃⌥K as "New idea shortcut"
    And Settings › Appearance's Text size says "⇧⌘U and ⌘− step it from 11 to 20 px."

  Scenario: The sidebar key can be changed too
    Given "Show or hide the sidebar" is changed to ⇧⌘L
    When I go back to the app and press Meta+Shift+L
    Then the sidebar folds
    And Meta+\ no longer folds it

  Scenario: The New idea key from Settings › Capture
    Given Settings › Capture is open
    When I click the "New idea shortcut" key button and press Control+Alt+K
    Then it reads "⌃⌥K", with a reset button "Use ⌃⌥I again"
    And Settings › Shortcuts shows ⌃⌥K for "New idea"
    When I go back to the app and press Control+Alt+K
    Then the capture box shows

  # The app only. Try these in the Mac app.

  Scenario: The menu bar follows
    Given "Save now" is changed to ⇧⌘K
    Then File › Save shows ⇧⌘K, and ⇧⌘K saves while a page has the keyboard
    And after quitting and opening the app again, File › Save still shows ⇧⌘K

  Scenario: Clicking a key button starts recording in the app too
    When I click the "Save now" key button and press ⇧⌘K
    Then it reads "⇧⌘K"

  Scenario: Recording takes keys the menu bar has
    When I click the "Save now" key button and press ⌘N
    Then no page is made, and the tip says "⌘N is already used for New page."

  Scenario: A new New idea key works over other apps
    Given "New idea" is changed to ⌃⌥K
    When another app is in front and I press Control+Option+K
    Then the capture box shows over it
    And Control+Option+I no longer opens it
