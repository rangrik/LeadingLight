Feature: Inspect the shared browser with explicit developer access
  Developer tools belong to the current page and never expose another tab or profile.

  Scenario: Developer access starts disabled
    Given I have not enabled developer access in Browser settings
    When an agent asks to use CDP on my browser tab
    Then no CDP command runs
    And the response tells me to enable developer access in Browser settings

  Scenario: A page needs my approval after the setting is enabled
    Given developer access is enabled and a browser tab shows a website
    When an agent requests developer access with a reason
    Then the browser shows that website and reason with Allow and Deny controls
    And the agent cannot inspect through CDP before I choose Allow
    When I choose Deny
    Then access stays denied and the request is settled

  Scenario: Approved developer tools inspect the same page
    Given I approved developer access for the current page
    When I inspect its DOM, computed styles, console, network responses and performance
    Then the results come from that tab
    And reading events twice does not consume them for another viewer
    And events and responses have limits with explicit truncation notices

  Scenario: Approval cannot survive a changed page or setting
    Given I approved developer access for the current page
    When the tab navigates, closes, or I turn developer access off
    Then the approval and captured developer events are removed
    And an old approval request cannot grant access to the new page
    And stopping access stops a CPU profile started by developer tools

  Scenario: Approved access stays inside its tab
    Given I approved developer access for one page
    When a command names another session, target or browser context
    Or it asks to read local files, set an upload, or inspect all profile cookies
    Then the command is refused before Chromium receives it
    And an unapproved tab remains inaccessible
