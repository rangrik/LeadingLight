Feature: Attachments follow encrypted notes between devices
  Scenario: Send native media through the existing encrypted journal
    Given a Mac page and its history contain an image, PDF and recording in the app's assets folder
    And its cover and type icon use the same image
    When the page syncs to my iPad and browser with the same account and recovery key
    Then the encrypted event contains each distinct attachment once
    And attachment references depend on their bytes and MIME type, not a device path
    And the iPad stores verified files in its own assets folder before applying the history entry
    And the browser renders the same media from local data URLs
    And the PDF opens in Quick Look without a network connection

  Scenario: Equivalent attachments do not create conflicting copies
    Given the same page uses different local attachment paths on Mac and iPad
    When the same synced version is received again
    Then portable attachment identity makes the page compare equal
    And no conflicting copy or extra history entry is created
    When equal page contents arrive with a newer journal revision
    Then the local revision advances so the next edit can apply without a false conflict
    When I edit that page offline on both devices
    Then genuinely different edits still keep a conflicting copy

  Scenario: Refuse invalid or unavailable attachments before changing pages
    When an encrypted event has a missing attachment, malformed reference, invalid size or mismatched hash
    Then no page, catalog or history entry from that event is applied
    And sync reports an error without advancing past that event
    When a local attachment is missing or points outside the app's assets folder
    Then its event stays unsent and reports the problem without dropping the attachment
    When a file exceeds 32 MiB, an event exceeds 64 MiB of unique attachment bytes, or an event contains more than 256 attachments
    Then that event stays local with a clear size error

  Scenario: Keep existing attachments usable
    Given an older browser event contains inline data URLs
    When the event reaches a native app
    Then its files are verified and materialized locally before the event is applied
    And a PDF stored as a data URL can also open in native Quick Look
    When an iPad update moves the app's data directory
    Then existing attachment paths still resolve inside the current app's assets folder
    And remote links, note text and unrelated URLs are unchanged

  Scenario: Switching accounts never sends another account's local library
    Given my local library is bound to account A
    And this device has a saved recovery key for account B
    When the signed-in cloud account changes to B
    Then background sync stays disabled for this library
    And no history or attachment is uploaded under account B

  Scenario: Retry an existing page's first upload after restart
    Given a page existed before journal tracking began
    And its first sync upload failed after a baseline revision was stored locally
    When I restart the app and retry sync
    Then the other device creates the page with its original identity and attachments
    And it does not replace the page with a conflicting copy
