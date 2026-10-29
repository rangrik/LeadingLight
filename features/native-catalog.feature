Feature: Bring desktop page settings to a fresh device
  Initial sync may replace factory settings while keeping receiver customizations.

  Scenario: A fresh iPad receives the desktop Page properties
    Given the iPad's Page type still has its factory settings
    And the desktop Page type shows Tags, Created and Updated
    When the iPad receives the desktop catalog with synced notes
    Then its Page type shows Tags, Created and Updated in that order
    And missing type and property definitions are added

  Scenario: Factory settings compare independently of storage details
    Given the receiving definition has the same factory values
    But its creation date and JSON object key order differ
    When a customized definition arrives
    Then the receiving definition adopts the incoming settings

  Scenario: Existing receiver settings are preserved
    Given I renamed a type, changed its displayed property order or edited a property
    When another device sends different settings for those definitions
    Then my existing settings remain unchanged
    And definitions absent from the incoming catalog remain available
    And repeated sync does not replace settings adopted on the first sync
