Feature: Personal browsing and agent browsing have separate permissions
  Personal tabs load public websites without granting the same access to agent tabs.

  Scenario: A personal website loads its dependencies
    Given I open a new personal browser tab
    When I visit a public website with images and scripts on other public hosts
    Then the page and those resources load without site approval prompts
    And no hosts are added to the agent allow list

  Scenario: Agent tabs stay restricted
    Given a public site is open in my personal tab
    When an agent opens that site in its own tab without a site grant
    Then the request is refused
    And choosing a name beginning with "user-" does not give the agent personal access

  Scenario: Private addresses stay protected
    Given I am browsing in a personal tab
    When a public page requests a private address or an unrelated localhost port
    Then the request is refused
    And a public hostname resolving to a private address is also refused
    But the current workspace's approved local pages still load

  Scenario: Sharing a personal page is explicit
    Given an agent has not been given my personal page
    Then it cannot read or control that personal tab
    When I choose Ask about page
    Then that page can be shared with the selected chat
    And other personal tabs remain unavailable to the agent

  Scenario: New windows inherit their opener's permissions
    Given a website opens a link in a new tab
    Then the new tab keeps the opener's personal or restricted browsing policy

  Scenario: A chat receives only the shared site
    Given a personal page is attached to a chat
    When I send a message with that page attached
    Then only that chat can read and act on the tab for 30 minutes
    And its direct navigation stays within that site
    When the page leaves that site or the grant expires
    Then the agent must ask me to share it again
    And a popup is not shared automatically

  Scenario: I stop sharing
    Given a chat has access to a personal tab
    When I remove its page attachment or choose Stop sharing this tab
    Then further reads and actions by that chat are refused
    And closing the tab or clearing website data also ends access
