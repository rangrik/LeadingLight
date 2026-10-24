Feature: Tags, daily notes and templates
  These are built from pages, types and links rather than special code paths. A tag is a page of
  type Tag; a daily note is a page of type Daily note, one per day; a template is a page marked
  as its type's template.

  Background:
    Given the app is open in a browser at 1280x800 with no stored data

  Scenario: Tagging a page from its header
    Given a page "Dune"
    When I hover above its title and click "Add tag", then type "classic" and pick Create
    Then "Dune" shows a "Tags" row with "classic"
    And a tag page "classic" is listed under Tags

  Scenario: Merging tags
    Given "Dune" is tagged "sci-fi" and "Foundation" is tagged "scifi", and "Notes" says "#scifi"
    When I open the tag "scifi", click "Merge into…" and pick "sci-fi"
    Then "scifi" is gone, "sci-fi" opens, and it lists Dune and Foundation as tagged
    And the line in "Notes" now shows "#sci-fi"

  Scenario: Today's note
    When I click "Today" in the sidebar
    Then a page titled with today's full date opens, of type "Daily note"
    And it shows "Previous day", "Today" (disabled), "Next day" and "Pick a day"
    And "Today" in the sidebar shows as the current page
    And Daily notes doesn't list it yet: a day's note is stored by its first edit
    When I type "plan" in its body
    Then Daily notes lists today's note, holding "plan"
    When I click "Today" in the sidebar again
    Then the same page opens; there is one daily note for today

  Scenario: Moving between days stores nothing
    Given today's note is open and not written in
    When I click "Previous day" twice, then "Next day"
    Then each day's note opens, titled with its date
    When I click "Pick a day" and choose the 1st of this month
    Then that day's note opens
    And Daily notes lists none of these days, after a reload too
    When I type "x" in the 1st's body and go to the next day and back
    Then the 1st opens holding "x", and it is the only one of these days Daily notes lists

  Scenario: An idea captured while today's unwritten note is open
    Given today's note is open and not written in
    When I capture the idea "Kite"
    Then the open note shows the "Ideas" heading with "Kite" at once
    And Daily notes lists one note for today, which holds the bullet after a reload

  Scenario: What was made today
    Given I created the pages "Dune" and "Notes" and the tag "classic" today
    When I open today's note
    Then "Created this day · 2" lists Dune and Notes at the end, not the tag (tags have their own place)

  Scenario: Daily notes stay out of Pages
    Given today's note exists
    Then the sidebar's Pages list doesn't show it, and Daily notes lists it

  Scenario: Making a template and a default
    When I open "Books", click "Type settings" and "New template"
    Then a page "Book template" opens with a note that it is the Books template
    When I set its title to "Book – {date}", its Status to "To read" and type "Summary" in its body
    And I mark it as the default in the Books settings
    And I click "New book"
    Then the new book is titled "Book – " with today's date, Status "To read" and body "Summary"

  Scenario: Templates stay out of lists and links
    Given a Book template exists
    Then it is not in the Books list, the sidebar, or the "@" menu

  Scenario: Starting from a chosen template
    Given Books has the templates "Novel" and "Essay", neither default
    When I open the menu next to "New book" and pick "Essay"
    Then the new book starts from "Essay"

  Scenario: A daily note template
    Given the Daily note type has a default template with the body "Plan"
    When I open a day that has no note yet
    Then its note starts with "Plan", and is stored only once I edit it
