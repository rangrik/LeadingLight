Feature: Quick capture
  One box for whatever comes in from anywhere on the Mac: ⌃⌥I, or the Quick capture button at the
  bottom of the strip. Words become an idea, a pasted web address becomes a saved webpage, the mic a
  recording. All of it lands in Captures with its review tick. New idea and Save webpage, as separate
  rows and boxes, are gone.

  Names used below:
  - the box: the capture box (capture.feature), with a mic button "Record" at the left of its footer
    and the project guess (tail.feature)
  - an address: text that is a single web address, pasted or typed, in the title line or the body
  - the choices: a segmented control in the header, "Link only", "Text only" and "Text and media"
    (picked first), the three the Save webpage box had (web-sources.feature)

  Background:
    Given the app is open in a browser at 1440x900

  Scenario: Words become an idea
    When I press Quick capture, type "soil test kit from the shop" and press ⌘↩
    Then an idea is saved, tagged in-the-middle, and Captures lists it unreviewed as "Captured idea"

  Scenario: An address becomes a webpage
    When I press Quick capture and paste "https://example.com/soil-guide"
    Then the box's header reads Webpage, with a globe, instead of New idea, and shows the choices
    And nothing is saved while I look: no idea page is made for the address
    When I pick "Link only" and press ⌘↩
    Then the box closes, the page is saved as Save webpage saved it (its title, its source address
      as a link), and Captures lists it unreviewed as "Saved webpage"
    When I press Quick capture, paste the address and press ⇧⌘↩
    Then the saved page opens beside the page in view, as an idea does
    When I press Quick capture, paste the address and type " good for the beds" after it
    Then the header reads New idea again, and the idea "good for the beds" is saved with the
      address as a link at the top of its body

  Scenario: A webpage that can't be saved
    When I paste an address whose website refuses the request and press ⌘↩
    Then the box stays open with "Saving webpage…" and then the reason, and "Save link instead"
    And no page was made; pressing "Save link instead" saves the link and closes the box
    When I paste an address, press ⌘↩ and press Escape while it saves
    Then the box closes at once and no page is made: Escape there is a cancel
    When the page saves but some of its media can't be downloaded
    Then the box stays open with "Saved" and how many media files the page marks as not saved,
      until Escape or ⌘↩

  Scenario: Closing never loses what was typed
    Given an address being typed is never autosaved as an idea
    When I type "ht" and click outside the box
    Then Captures lists an idea "ht", which I can delete like any page
    When I type "http" and press Escape
    Then Captures lists an idea "http"
    When I paste "https://example.com/soil-guide" and click outside, press Escape, or the panel hides
    Then the page is saved as a webpage with the choice picked, and Captures lists it
    And when its website can't be copied, its link is saved instead
    When I paste "javascript:alert(1)", press ⌘↩ and then Escape
    Then saving the webpage is refused, and the words are kept as an idea, as plain text with no link

  Scenario: A recording
    When I press Quick capture and press the mic
    Then a voice block opens in the body and records at once, as the voice block does
      (voice.feature): "Recording · 0:01", "Stop and transcribe" and "Cancel"
    When I press "Stop and transcribe"
    Then the audio is saved in the body, and Captures lists the page "Voice recording" as a
      "Voice recording"; in the Mac app the transcript follows the audio and names the page
    And in the browser the block says transcription needs the Mac app
    And the mic is off while the body holds a recording; the block's own Record takes another
    When I press Escape, or click elsewhere, while it still records
    Then microphone capture stops and the recording is not kept, as leaving a page does; words
      typed stay saved

  Scenario: Close after stopping while the audio is saving
    Given the box is recording and saving its audio is slow
    When I press "Stop and transcribe" and immediately close the box
    Then the stopped take finishes saving in Captures, even without a typed title
    And opening it offers playback and "Retry transcription"
    And later edits to an already saved capture are kept
    But deleting its voice block before saving finishes does not bring it back

  Scenario: The guess still shows
    Given the Project page "Garden" exists
    When I type "fix the gate latch before the weekend"
    Then the project button reads "Garden?" and the footer "⌃↩ Task in Garden", as before
    And a webpage offers no ⌃↩: the guess is for words

  Scenario: From anywhere
    Given another app is in front
    When I press ⌃⌥I
    Then the box opens over that app without bringing LeadingLight forward, as the capture panel did, with the same behaviour as above
    # The recording runs in the panel's own webview; the webpage is fetched and saved by the main window.
