Feature: Publish a read-only page by link
  Publishing sends a separate snapshot to the cloud. Local edits stay private until updated.
  Anyone with its unguessable link can read it without signing in. Search engines are told not to index it.

  Scenario: Publish a page with sidenotes
    Given I am signed in and a page has text, formatting, an image and two sidenotes
    When I open "Page options", choose "Publish page…" and press "Publish"
    Then the latest title, description, body, attachments and anchored sidenotes are published
    And I can copy its link
    When I open that link in a signed-out browser
    Then I see the published page and its sidenotes without the workspace or sign-in
    And I cannot edit text, tick tasks, add or remove sidenotes, or run agents
    And linked private pages, history and unanchored thoughts are not published

  Scenario: Read on a phone
    Given a published page has several long sidenotes
    When I open its link at a phone width
    Then the text and numbered sidenotes fit the viewport without horizontal scrolling
    And all notes remain readable

  Scenario: Update deliberately
    Given I published a page
    When I change its title, text or sidenotes locally
    Then the shared page still shows the previous snapshot
    When I press "Update published page"
    Then the same link shows the latest snapshot

  Scenario: Unpublish and publish again
    Given I published a page
    When I press "Unpublish"
    Then the old link shows "This page is unavailable"
    And no cached copy is served when I reload or go offline
    When I publish that page again
    Then it has a new link and the old link remains unavailable

  Scenario: Only the owner can manage a publication
    Given I published a page
    When someone without my account tries to update or unpublish it
    Then they cannot change my publication or see its management details
    And a cross-origin write is refused

  Scenario: Revoke after cloud access is disabled
    Given I published a page before cloud access was disabled for my account
    When I open "Manage published pages"
    Then I can still see and unpublish my shared copies
    And publishing a new copy or update is refused

  Scenario: Read embedded content safely
    Given a published page includes a YouTube video and another embedded website
    When I open its shared link
    Then the video plays in a frame that cannot open forms, popups or navigate the page
    And the other website appears as a link that I can choose to open

  Scenario: Read a wide table on a phone
    Given a published page contains a table with seven columns
    When I open it at a phone width
    Then each column remains wide enough to read
    And I can scroll the table sideways without scrolling the whole page sideways

  Scenario: Search engines cannot index shared content
    When a crawler requests a shared page or its public API response
    Then the response has "X-Robots-Tag: noindex, nofollow, noarchive"
    And the page HTML has a robots noindex meta tag before JavaScript runs
    And there is no public page listing or sitemap

  Scenario: A failed publish keeps the previous snapshot
    Given I have an existing published page
    When publishing fails because I am offline, an attachment is missing, or the page exceeds the size limit
    Then I see an error and can retry
    And the old link still shows its previous snapshot
    And no success is shown for a failed unpublish

  Scenario: Sign in before publishing
    Given I have not signed in
    When I choose "Publish page…"
    Then I am offered "Account and devices" to sign in
    And no page content is uploaded

  Scenario: Recover when a saved publication's response is lost
    Given the server saves my published page
    When the connection drops before the app receives its response
    Then the dialog checks the current publication status
    And shows the saved share link with the connection error
    And I can update or unpublish that copy

  Scenario: Manage a link after deleting the local page
    Given I published a page and then deleted its local copy
    When I open "Account and devices" and "Manage published pages"
    Then I can still copy its link or unpublish it
    And only my account's published pages are listed
