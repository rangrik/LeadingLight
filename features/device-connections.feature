Feature: Connect signed-in devices by matching a number
  Scenario: Review a Mac task from a phone away from home
    Given my iPhone and Mac are signed in to the same account
    And the Mac has the LeadingLight folder and a task waiting for review
    When I open LeadingLight on iPhone and request that Mac
    Then the phone shows one number and the Mac offers three choices and Deny
    When I tap the matching number on the Mac
    Then the phone opens the Mac's pending review from the project page
    And cloud note uploads being paused does not hide the report

  Scenario: Allow only note sync
    When I request note sync from a signed-in device that has my library key
    And that device approves the matching number
    Then my device can unlock the notes without copying a key
    And the approval grants no access to project work

  Scenario: A connection ends without access
    Given a two-minute number match is pending
    When either device cancels, the approver selects a wrong number, or the request expires
    Then that request cannot grant access on a later attempt

  Scenario: Bound access
    Given the host and requester have approved one project
    Then a different device, another account, and another folder cannot use that grant
    And removing the connection stops further access

  Scenario: Remote work with note sync off on the Mac
    Given a signed-in Mac has the project folder and has never set up note sync
    When it approves the matching number for this project
    Then the requester can open the project’s reports without receiving a library key
    And this approval cannot unlock note sync
