Feature: Keep a webpage as a source
  A source keeps its address and, when requested, a readable copy in the space.

  Scenario: Save just a link without fetching the website
    When I choose "Save webpage" in the bar's Captures header
    And enter "https://example.com/article" and choose "Link only"
    And press "Save source"
    Then a page opens with a clickable source address
    And it remains after a reload
    And the website has not been fetched

  Scenario: Keep the article and its media offline
    Given a public article with headings, paragraphs, links, and an image
    When I save its address with "Text and media"
    Then a page opens with its title, source address, and readable article blocks
    And its image is copied into the space
    And the saved text and image remain available after reload without the website
    And scripts, forms, and embedded frames from the website do not run
    And embedded media is kept as an ordinary link

  Scenario: Keep text without downloading media
    When I save an article with "Text only"
    Then its readable text is saved
    And no media is downloaded

  Scenario: Preserve mixed article text and nested lists
    Given an article has text before and after formatted spans, paragraphs, and nested lists
    And one image is inside a list item and another is inside a quote
    When I save it with "Text and media"
    Then all those words remain in reading order
    And nested lists remain nested
    And each image is saved once in its original place
    And a lazy image with a placeholder uses its real image address

  Scenario: A website cannot be copied
    Given a website returns an error, requires sign-in, or refuses the browser request
    When I try to save its text
    Then the dialog explains the failure and offers saving the link instead
    And no empty source page is created

  Scenario: Some media cannot be copied
    Given an article contains media that fails to download
    When I save it with "Text and media"
    Then its text is kept
    And the missing media is kept as a link labelled "Media not saved"
    And a notice says how many media files could not be saved

  Scenario: Cancel a slow capture
    Given the website or one of its media downloads has not finished
    When I cancel Save webpage or press Escape
    Then the dialog closes immediately and no source page is created
    And pending browser downloads stop and no further media downloads start
    And I can save another source without waiting for the cancelled request

  Scenario: Keep image descriptions and explain unsupported media
    Given an article has an image described as "A small picture" and an image with an unsupported address
    When I save it with "Text and media"
    Then the saved image keeps its description
    And the unsupported image becomes a "Media not saved" text placeholder
    And the notice counts that missing image

  Scenario: Refuse an unsafe address
    When I enter a javascript, data, file, or credential-bearing URL
    Then saving is refused with an explanation
    And no page is created
