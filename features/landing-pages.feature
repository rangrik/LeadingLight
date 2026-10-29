Feature: Three LeadingLight landing page concepts
  Visitors can compare three distinct presentations of the same local-first Mac app.

  Scenario Outline: Understand the product and find the preview
    Given I open the <concept> landing page
    Then I can identify LeadingLight as a local-first notes app for macOS
    And the page demonstrates notes, object types, or linked ideas
    And a download link opens the official GitHub releases
    And the page describes the download as an early preview for Apple Silicon
    And the page states that preview builds are unsigned and not notarized

    Examples:
      | concept |
      | one     |
      | two     |
      | three   |

  Scenario: Navigate on a small screen
    Given I open each landing page at a width of 390 pixels
    Then the content fits without horizontal scrolling
    And every primary link is visible or reachable through navigation
    And interactive controls work with a keyboard

  Scenario: Explore without downloading
    Given I open each landing page
    When I use the page's product demonstration or section navigation
    Then I see the corresponding content
    And the page does not require an account or invent a submitted signup

  Scenario: Assets and preferences
    Given I open each landing page with reduced motion enabled
    Then all content remains visible and usable
    And all local images load successfully
    And the page has no uncaught browser errors
