Feature: Tabs and history
  A pane holds tabs, as a browser window does, and each tab keeps its own history. Clicking a page
  opens it in the tab I am in; ⌘-click opens it in a new tab beside; Shift-click still opens a new
  pane beside (panes.feature). Tabs can be dragged to reorder, and dragged to another pane or to a
  pane's edge, which is the split that exists. Back and forward move through the tab's history.

  Names used below:
  - tab row: the row of tabs at the top of a pane, above its header, shown only when the pane has two or more tabs
  - a tab: the page's icon and title; the active one in the foreground, the rest muted; a close button on hover
  - "+" at the end of the tab row: a new empty tab, showing "No page open" with New page
  - Back / Forward: two chevrons at the left of the pane's header, muted when there is nowhere to go; ⌘[ and ⌘]
  - ⌘T: a new tab; ⌘W: close the tab, and the pane with its last tab; ⇧⌘T: reopen the last closed tab
  - ⌃Tab / ⌃⇧Tab: the next and previous tab

  Background:
    Given the app is open in a browser at 1440x900 with pages "Garden plan", "Sam" and "Soil notes"

  Scenario: Opening a page navigates the tab, and ⌘-click opens a new one
    Given "Garden plan" is open
    When I click "Sam" in the sidebar
    Then the pane shows "Sam" and no tab row, since it has one tab
    When I ⌘-click "Soil notes" in the sidebar
    Then a tab row appears with "Sam" and "Soil notes", "Soil notes" active and in front
    And "Sam" keeps its scroll position and unsaved words when I click its tab

  Scenario: Back and forward
    Given one tab went "Garden plan", then "Sam", then "Soil notes"
    When I press ⌘[
    Then the tab shows "Sam", and Forward is live
    When I press ⌘[ again, then ⌘] twice
    Then the tab shows "Soil notes" and Forward is muted
    When I open "Garden plan" from "Sam" after going back
    Then the forward history is gone, as in a browser

  Scenario: Reordering tabs by drag
    Given a pane with tabs "Garden plan", "Sam", "Soil notes"
    When I drag "Soil notes" before "Garden plan"
    Then the order is "Soil notes", "Garden plan", "Sam", and the active tab is unchanged
    When I reload
    Then the panes, their tabs, their order and the active tab are as I left them

  Scenario: A tab dragged to another pane, or to an edge
    Given two panes side by side, the left with tabs "Garden plan" and "Sam"
    When I drag "Sam" onto the right pane's tab row
    Then while it is over a header with no tab row, an "Add as a tab · Sam" box covers that header, and none of the header shows through or beside it
    And once dropped, "Sam" is a tab of the right pane and the left pane has one tab, so its tab row goes
    When I drag "Garden plan" to the window's right edge
    Then a new pane opens with it, as a split, and the pane it left closes if empty

  Scenario: Closing tabs
    Given a pane with tabs "Garden plan", "Sam", "Soil notes", "Sam" active
    When I press ⌘W
    Then "Sam" closes and "Soil notes" is active
    When I press ⇧⌘T
    Then "Sam" is back where it was, active, with its history
    When I close every tab of the pane
    Then the pane closes, and the pane beside it takes its room; the last pane shows "No page open"

  Scenario: Keys that stay the editor's
    When the cursor is in a page's body and I press ⌘[ or ⌘]
    Then the tab goes back or forward and the words are unchanged, since the editor does not use these keys
    And ⌃Tab moves to the next tab, never inserting a tab in the text
