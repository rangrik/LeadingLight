Feature: Everyday browsing
  The shared browser should keep the familiar address, tab and keyboard behavior of a browser.

  Scenario: Cancel an address edit
    Given I am viewing "http://localhost:1420/alpha"
    When I type another address without submitting it
    And I press Escape after dismissing any suggestions
    Then Address shows "http://localhost:1420/alpha" again
    And the page keeps its current location
    And Escape does not leave full view

  Scenario: Old state cannot undo a navigation
    Given I am viewing "http://localhost:1420/alpha"
    And a state response for that page is delayed
    When I submit "http://localhost:1420/beta" in Address
    And the old response arrives while navigation is pending
    Then Address still shows "http://localhost:1420/beta"
    And a later redirect updates Address to the destination
    And acknowledging the navigation before the page commits cannot restore the old address

  Scenario: Tabs keep their places
    Given I opened Alpha, a blank tab, and Beta in that order
    When the runtime returns the tabs in a different order
    Then the tab strip still shows Alpha, New tab, Beta
    When I middle-click Beta
    Then only Beta closes
    And Alpha and New tab keep their places

  Scenario: Typing survives a page resize
    Given I am typing in a field on the browser page
    When I resize the pane
    Then pointer input pauses until a frame at the new size arrives
    And the previous frame stays visible without dimming or an update message
    And typing continues in the focused page field without losing queued keys
    But if I focus Address while resizing, focus stays in Address

  Scenario: A quiet browser surface
    Given a page is open
    Then the selected tab and its close button share one highlighted shape
    And navigation controls and Address sit below the tabs
    And the page has no permanent instruction or workspace status bars
    And page size and Focus page remain available in the Browser menu
    And menu labels align and the page size has space beside its label

  Scenario: Escape belongs to the page
    Given a website has a popup that closes with Escape
    And I am browsing that page in full view
    When I press Escape while the page has focus
    Then the website receives Escape
    And the browser stays in full view

  Scenario: Desktop browsing uses desktop resources
    Given I am using the browser in the Mac app
    Then Chromium keeps its normal scrollbar behavior
    And it uses its normal renderer and JavaScript memory limits
    But the separate development-box browser keeps its resource limits
    And agent network restrictions and the Chromium sandbox remain enabled

  Scenario: Shortcuts stay with the browser after changing tabs
    Given Alpha and Beta are open in the browser
    When I switch tabs twice with Control-Tab
    Then both switches stay within the browser
    When I close the selected tab with its close button
    And I press Command-T without clicking anywhere else
    Then a new browser tab opens
    And no notes tab opens
