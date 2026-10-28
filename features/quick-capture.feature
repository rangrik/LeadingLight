Feature: Quick capture
  One box for whatever comes in from anywhere on the Mac: ⌃⌥I, or the Quick capture button at the
  bottom of the strip. Words become an idea, a pasted web address becomes a saved webpage, the mic a
  recording. All of it lands in Captures with its review tick. New idea and Save webpage, as separate
  rows and boxes, are gone.

  Names used below:
  - the box: the capture box (capture.feature), with a mic button in its footer and the project guess (tail.feature)
  - an address: text that is a single web address, pasted or typed

  Background:
    Given the app is open in a browser at 1440x900

  Scenario: Words become an idea
    When I press Quick capture, type "soil test kit from the shop" and press ⌘↩
    Then an idea is saved, tagged in-the-middle, and Captures lists it unreviewed

  Scenario: An address becomes a webpage
    When I press Quick capture and paste "https://example.com/soil-guide"
    Then the box's header reads Webpage instead of New idea, with the Link-only and Copy choices the Save webpage box had
    When I press ⌘↩
    Then the page is saved as Save webpage saved it, and Captures lists it
    When I type words after the address
    Then it is an idea again, with the address as a link in its body

  Scenario: A recording
    When I press Quick capture and press the mic
    Then recording starts as the voice block does (voice.feature), and stopping saves it as a recording in Captures, transcribed when the Mac can

  Scenario: The guess still shows
    When I type "fix the gate latch before the weekend"
    Then the project button reads "Garden?" and the footer "⌃↩ Task in Garden", as before

  Scenario: From anywhere
    Given another app is in front
    When I press ⌃⌥I
    Then the box opens over that app without bringing LeadingLight forward, as the capture panel did, with the same behaviour as above
