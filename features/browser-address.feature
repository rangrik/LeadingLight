Feature: Keep browser notes when the app address changes
  Scenario: Copy an existing browser workspace to leadinglight.app
    Given I have notes, attachments, types and edit history at leadinglight-web.vercel.app
    When I choose "Copy notes to leadinglight.app"
    Then a new tab copies my saved workspace directly between the two browser tabs
    And I can open the copied notes at leadinglight.app
    And the original workspace remains available at the old address
    And sign-in, sync recovery keys and paired Mac credentials are not copied

  Scenario: Protect an existing destination
    Given leadinglight.app already contains notes or history
    When I try to copy another workspace there
    Then the copy is refused with an explanation
    And both workspaces remain unchanged

  Scenario: Refuse an untrusted transfer
    Given the copy tab is waiting for the original workspace
    When a message comes from another origin, tab or transfer code
    Then no workspace data is imported

  Scenario: A failed copy keeps the source
    Given the new tab cannot save the workspace or cannot be opened
    When I try to copy my notes
    Then the app explains the failure and keeps the original workspace

  Scenario: Old sessions remain usable during migration
    Given I am already signed in at the old address
    Then existing calendar and encrypted sync requests still use my own account
    But new sign-ins and Google connections direct me to copy my notes first
    And requests from unrelated origins are refused
