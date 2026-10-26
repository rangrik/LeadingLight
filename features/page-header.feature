Feature: Page icon, cover and description
  The top of every page can carry an icon, a cover and a one-line description, as in
  Capacities. All three are optional and stored with the page. The icon also shows in the
  sidebar row and the card header's breadcrumb, in place of the page symbol.

  Names used below:
  - header controls: buttons "Add icon", "Add cover", "Add description" just above the title.
    They show while the pointer is over the top of the page or one of them has keyboard focus,
    and each is gone once its part is set.
  - page icon: button "Change icon" above the title
  - icon picker: popover "Icon" with tabs "Emoji", "Icons", "Upload", a "Remove" button, and in
    the Emoji tab a searchbox "Search emoji" and one button per emoji, named by the emoji's name
  - cover: the band across the top of the pane, with buttons "Change cover" and "Reposition"
    showing while the pointer is over it
  - cover picker: popover "Cover" with tabs "Colour", "Unsplash", "Upload", "Link" and a "Remove" button
  - Unsplash: the photo site api.unsplash.com. Tests answer for it, since the test browser is offline.
  - description: textbox "Description" under the title

  Background:
    Given the app is open in a browser at 1280x800 with no stored data
    And I have created a page titled "Trip"

  Scenario: Header controls appear on hover only
    Then the header controls are not visible
    When I move the pointer over the title
    Then "Add icon", "Add cover" and "Add description" are visible above the title
    And the title has not moved

  Scenario: Header controls fit narrow pages
    Given two pages are open side by side in a 960 pixel window with the sidebar collapsed
    When I move the pointer over either title
    Then all header controls fit inside that page as icons with accessible names
    And neither page scrolls sideways, even before its controls appear
    When I open Add description
    Then the description field opens inside that page
    And the same holds for a single page in a 520 pixel browser window

  Scenario: Picking an emoji icon
    When I click "Add icon"
    Then the icon picker opens on the "Emoji" tab with the search box focused
    And it lists every emoji in groups, starting with "Smileys & Emotion"
    When I type "plane" and click the "airplane" emoji
    Then a 64 px "✈️" shows above the title and the picker closes
    And the sidebar row and the card header's breadcrumb show "✈️" in place of the page symbol
    And "Add icon" is gone from the header controls

  Scenario: Search matches words beyond the name
    When I click "Add icon" and type "happy"
    Then "grinning face" is among the results
    When I type "zzzz"
    Then the picker says "No results"

  Scenario: Typing or pasting an emoji picks it
    When I click "Add icon" and type "🌊" into the search box
    Then the page icon is "🌊"

  Scenario: An icon from the icon set, in a colour
    When I click "Add icon", open the "Icons" tab, pick the colour "Blue" and type "book"
    And I click the "book-open" icon
    Then a blue "book-open" icon shows above the title and in the sidebar row
    When I open the picker again from "Change icon" and the "Icons" tab
    Then "Blue" is still the picked colour

  Scenario: An uploaded image as the icon
    When I click "Add icon", open the "Upload" tab and choose a PNG image
    Then the image shows above the title as a 64 px square with rounded corners
    And the sidebar row shows it at 16 px

  Scenario: An upload that isn't an image is refused
    When I click "Add icon", open the "Upload" tab and drop a PDF file on it
    Then the picker says "Choose an image file" and the page has no icon

  Scenario: Changing and removing the icon
    Given the page icon is "✈️"
    When I click "Change icon" and pick "🚀"
    Then the page icon is "🚀"
    When I click "Change icon" and click "Remove"
    Then the page has no icon and the sidebar row shows the page symbol again

  Scenario: A colour cover
    When I click "Add cover" and click the colour "Green"
    Then a green band 200 px tall spans the whole pane width above the title
    And "Add cover" is gone from the header controls

  Scenario: An uploaded or pasted cover
    When I click "Add cover", open the "Upload" tab and paste a PNG image
    Then the image fills the cover band, cropped to fit

  Scenario: A cover from a link
    When I click "Add cover", open the "Link" tab, enter an image's address and press Enter
    Then the image fills the cover band
    When I open "Change cover", the "Link" tab, and enter "https://example.com/not-an-image"
    Then the picker says "That link didn't load as an image" and the cover is unchanged

  Scenario: Unsplash asks for a key once
    When I click "Add cover" and open the "Unsplash" tab
    Then it says Unsplash needs a free access key, with a "Get one" link to Unsplash's developer page
    When I enter "test-key" in "Access key" and click "Save key"
    Then the tab shows the searchbox "Search Unsplash", focused
    And after a reload the "Unsplash" tab still shows the search, not the key form
    When I click "Change key" under the empty search
    Then the key form shows again
    And closing the picker without saving keeps the old key

  Scenario: A cover from Unsplash, with credit
    Given an Unsplash key is saved
    When I open the "Unsplash" tab and type "mountain"
    Then Unsplash is asked for landscape photos of "mountain", with the key
    And all 24 show in a grid of even 3:2 thumbnails that scrolls, each named "Photo by <photographer>"
    When I click "Photo by Ann Lee"
    Then the photo fills the cover band and the picker closes
    And the photo's download link is requested with the key, as Unsplash asks
    When I hover the cover
    Then the cover's top right reads "Photo by Ann Lee on Unsplash"
    And "Ann Lee" opens the photographer's Unsplash profile and "Unsplash" opens unsplash.com,
      both ending in "utm_source=leadinglight&utm_medium=referral"
    When I reposition the photo and reload
    Then the photo and its credit are unchanged
    When I pick the colour "Green" instead
    Then the credit is gone

  Scenario: A long photographer's name
    Given the page has an Unsplash cover by "Eve Moreno-Castellanos de la Fuente" and an icon
    When the pane is 300 px wide and I hover the cover
    Then the name is cut short with "…", "on Unsplash" still shows, and the credit stays inside the
      pane and clear of the page icon
    And hovering the name shows it in full
    When the pane is under 320 px wide
    Then "Photo by" is left out, so the name keeps room: "Eve … on Unsplash"

  Scenario: Unsplash failures
    Given an Unsplash key is saved
    When Unsplash refuses the key and I search
    Then the tab says "Unsplash didn't accept that key" and shows the key form again
    When Unsplash can't be reached and I search
    Then the tab says "Couldn't reach Unsplash" and the cover is unchanged
    When Unsplash answers 403 for the hourly limit and I search
    Then the tab says "Unsplash's hourly limit is used up. Try again later."
    When a search finds nothing
    Then the tab says "No photos found"

  Scenario: An Unsplash cover offline
    Given the page has an Unsplash cover
    When the photo can't load
    Then the cover is a plain grey band with no broken-image sign, and its credit still shows on hover
    When the network comes back, or I pick the same photo again
    Then the photo shows

  Scenario: The icon sits on the cover's lower edge
    Given the page has a cover and the icon "✈️"
    Then the icon's centre lies on the cover's bottom edge, at the title's left edge

  Scenario: Repositioning a cover image
    Given the page has an image cover taller than the band
    When I hover the cover and click "Reposition"
    Then the cover says "Drag to reposition" and shows "Save position" and "Cancel"
    When I drag the image up by 40 px and click "Save position"
    Then a lower part of the image shows, and the same part shows after a reload
    When I click "Reposition", drag it, and click "Cancel"
    Then the image goes back to where it was

  Scenario: Removing the cover
    Given the page has a cover
    When I click "Change cover" and click "Remove"
    Then there is no cover and the title is back where it started

  Scenario: Adding a description
    When I click "Add description"
    Then the "Description" field shows under the title, focused, with the placeholder "Add a description"
    When I type "Ten days in Japan" and press Enter
    Then the cursor moves to the body
    And after a reload the description reads "Ten days in Japan"

  Scenario: An emptied description goes away
    Given the page has the description "Ten days in Japan"
    When I clear the description and click in the body
    Then the "Description" field is gone and "Add description" is back in the header controls

  Scenario: Everything survives a reload
    Given the page has the icon "✈️", a green cover and the description "Ten days in Japan"
    When I wait 1 second and reload the browser
    Then all three are as they were, in the page, the sidebar row and the breadcrumb

  Scenario: Side by side, each page keeps its own header
    Given a second page "Notes" with the icon "📝" is open on the right
    Then the left card header shows "✈️ Trip" and the right one "📝 Notes"
    And each cover spans only its own pane

  Scenario: The emoji block uses the same full emoji set
    When I type "/emoji" in the body, press Enter, click "Change emoji" and type "plane"
    Then the "airplane" emoji is among the results
