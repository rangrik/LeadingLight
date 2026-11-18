Feature: Remote work beta
  Scenario: The account chooses the beta
    Given an installed Mac app and an installed iPad app signed in to the same account
    When I enable Remote work in Account and devices on the iPad
    Then both devices see Remote work after their next account refresh
    When I turn it off, or sign out
    Then the beta workspace closes and its entry points disappear
    And another account has its own choice

  Scenario Outline: Work runs on the shared project
    Given I use the beta on <device> paired to Home Mac
    When I open Remote work with one shared project named Atlas
    Then I can write straight into one composer with Home Mac and Atlas visible
    When I send a message
    Then Home Mac starts one agent in Atlas and shows its progress
    When the agent asks for approval
    Then the decision replaces the composer
    When I answer I can continue the same conversation
    Examples:
      | device  |
      | Mac Air |
      | iPad    |
      | iPhone  |

  Scenario: Open work from a project task
    When I open remote work on a task in Atlas
    Then only Atlas on the paired Mac can receive the task
    And its title is an editable draft until I send it
    When I reopen the task on another device paired to that Mac
    Then I can continue the same task conversation

  Scenario: A box cannot start work in an unshared or missing folder
    Given the paired Mac has removed or stopped sharing Atlas
    When I open Atlas or try to send a draft for it
    Then the app tells me to link and share its folder on that Mac
    And no agent starts on either device

  Scenario: The box goes offline
    When Home Mac cannot be reached
    Then my draft stays with its project and I can retry when it reconnects
    And no work is sent to a different machine

  Scenario: A different box shares a project with the same name
    Given an existing task conversation on my home Mac
    When I open that task on a device paired to another Mac
    Then it names the original Mac if the conversation cannot be found
    And I cannot launch a replacement agent from that task
