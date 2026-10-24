Feature: Links between pages
  "@" or "[[" in the body links another page; "#" links a tag. Links store the page's id, so
  they follow renames and icon changes. A link alone on its line is a block shown as a line, a
  small card, a wide card or the page itself. Every page lists what links to it, and the pages
  that name it without a link.

  Names used below:
  - link menu: listbox "Link to a page", opened by "@", "[[" or "#" followed by a letter
  - block link: a link on its own line, with a "Link view" menu on hover
  - backlinks: section "Backlinks" at the end of a page, and its "Unlinked mentions" list
  - linked sections: at a page's end, before the backlinks, one section per property that names
    the pages pointing here through it ("Linked ideas · 2" for an idea's Project, "Linked books"
    for a book's Author). Each page is a small card: its icon, its title and its tags.
  - backlink tabs: under "Backlinks · N", COSS tabs: "All" then one tab per type the linking
    pages have, by its plural name with a count ("Ideas 2"), in the sidebar's order

  Background:
    Given the app is open in a browser at 1280x800 with no stored data
    And pages titled "Dune" and "Notes" exist, and "Notes" is open

  Scenario: Linking a page inside a sentence
    When I type "Reading @du" in the body
    Then the link menu lists "Dune" first
    When I press Enter
    Then the line reads "Reading " followed by a link showing Dune's icon and "Dune", then a space
    When I click the link
    Then "Dune" opens in the same pane
    When I go back to "Notes" and Shift-click the link
    Then "Dune" opens beside "Notes"

  Scenario: "[[" works the same way
    When I type "See [[dun" and press Enter
    Then the line holds a link to "Dune"

  Scenario: Creating a page from the menu
    When I type "@Arrakis" in the body
    Then the last item is "Create “Arrakis”"
    When I pick it
    Then a page "Arrakis" exists and the line links to it

  Scenario: Links follow a rename
    Given "Notes" links to "Dune"
    When I rename "Dune" to "Dune Messiah"
    Then the link in "Notes" reads "Dune Messiah", also after a reload

  Scenario: Aliases find a page
    Given "Dune" has the property "Aliases" set to "Arrakis, Desert planet"
    When I type "@desert" in the body
    Then the link menu offers "Dune" with the hint "Desert planet"

  Scenario: Date links make the day's note
    When I type "@tod" and press Enter
    Then the line links to a daily note titled with today's date, which now exists

  Scenario: A link alone on its line is a block
    When I type "@dun" on an empty line and press Enter
    Then a block link to "Dune" fills the line, shown as a line with Dune's icon and title
    When I hover it and pick "Small card" in the "Link view" menu
    Then it shows as a card with Dune's cover, icon, title and the properties Books show on cards
    When I pick "Page"
    Then it shows Dune's body, read only, under Dune's title

  Scenario: A type sets how its links look
    Given the Book type's "Links show as" is "Wide card" and "Dune" is a Book
    When I put a new block link to "Dune" in "Notes"
    Then it shows as a wide card

  Scenario: Tags with "#"
    When I type "#ide" in the body
    Then the link menu offers "Create #“ide”"
    When I pick it
    Then the line shows "#ide" and a tag page "ide" exists under Tags

  Scenario: Backlinks list where a page is linked, with the line around it
    Given "Notes" has the line "Reading Dune this week" with "Dune" linked
    And "Arrakis" links to "Dune" through its "Items" property
    When I open "Dune"
    Then "Backlinks · 2" lists "Notes" with "Reading @Dune this week" under it
    And "Arrakis" with "Through Items"

  Scenario: Pages pointing here through a property
    Given the ideas "Worms" (tagged "sand") and "Spice" have the Project "Dune", and "Notes" mentions "Dune"
    When I open "Dune"
    Then its properties show no "Ideas" row
    And "Linked ideas · 2" shows two small cards, "Worms" with "#sand" and "Spice"
    And "Backlinks · 1" lists only "Notes"; the ideas are not listed twice
    When I click the card "Worms"
    Then "Worms" opens; Shift-click opens it beside
    When "Spice" changes its Project to nothing
    Then "Linked ideas · 1" shows only "Worms"

  Scenario: Backlinks by type, in tabs
    Given "Dune" is linked from the page "Notes", the ideas "Worms" and "Spice", and the task "Reread"
    When I open "Dune"
    Then "Backlinks · 4" shows the tabs "All 4", "Pages 1", "Tasks 1" and "Ideas 2", with "All" picked
    When I click "Ideas 2"
    Then only "Worms" and "Spice" are listed, each with its line, and "Backlinks · 4" still reads 4
    When I press ArrowLeft
    Then "Tasks 1" is picked and only "Reread" is listed

  Scenario: Tabs only when they sort something
    Given "Dune" is linked from "Notes" and "Journal", both plain pages
    When I open "Dune"
    Then "Backlinks · 2" lists both, with no tabs

  Scenario: The picked tab empties out
    Given "Ideas 2" is picked on "Dune" and both ideas are edited to drop their link
    Then "All" is picked again and the "Ideas" tab is gone

  Scenario: Each page starts on All
    Given "Ideas" was picked on "Dune"
    When I open "Notes" and then "Dune" again
    Then "All" is picked

  Scenario: Unlinked mentions can be linked
    Given "Journal" says "finished dune today" with no link
    When I open "Dune" and expand "Unlinked mentions · 1"
    Then "Journal" is listed with "finished dune today"
    When I click "Link"
    Then "Journal" links "dune" to "Dune", and "Journal" moves up into the backlinks

  Scenario: Linking a mention in a page that is open beside
    Given "Journal" is open beside "Dune"
    When I click "Link" for "Journal" in Dune's unlinked mentions
    Then the link appears in Journal's open pane at once, and survives a reload

  Scenario: Deleting a linked page
    Given "Notes" links to "Dune"
    When I delete "Dune"
    Then the link in "Notes" reads "Deleted page", struck through, and can't be clicked

  Scenario: An embedded page doesn't embed again
    Given "Dune" shows "Notes" as "Page", and "Notes" shows "Dune" as "Page"
    Then inside the embedded "Notes", the link to "Dune" shows as a wide card
