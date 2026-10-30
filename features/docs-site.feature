Feature: The documentation site
  A website, built from apps/docs, that explains how to install and use LeadingLight to someone
  trying it for the first time, and how to build it to a developer.

  Scenario: Find out what LeadingLight is and get it
    When I open the site's home page
    Then I read that LeadingLight is a local-first notes app for macOS
    And "Download the preview" opens the official GitHub releases
    And the page says downloads are early previews for Apple Silicon, unsigned and not notarized
    When I open "Install"
    Then it lists the requirements, the steps to allow the app in Privacy & Security, how to update,
      and where notes are kept

  Scenario: Every feature has a page
    When I open the sidebar
    Then it has sections for getting started, writing, organizing, the workspace, capture,
      AI and agents, sync and devices, customizing, help and developers
    And each feature in features/ is explained on at least one page, in the app's own words

  Scenario: Limits are honest
    Given a feature works only in the Mac app, or is a preview
    Then its page marks it "Mac app" or "Preview"
    And what isn't built yet reads as a limit, never as a feature

  Scenario: Search and navigate
    When I type "backlinks" into the site's search
    Then "Links and backlinks" is offered
    And every link between pages opens a page that exists, at the heading it names

  Scenario: Read it anywhere
    Given the system prefers a dark colour scheme
    Then the site is dark
    When I open it at a width of 390 pixels
    Then the content fits without scrolling sideways and the sidebar opens from the menu button

  Scenario: The build refuses a broken link
    Given a page links to a page that doesn't exist
    When I run "pnpm --filter @leadinglight/docs build"
    Then the build fails and names the dead link
