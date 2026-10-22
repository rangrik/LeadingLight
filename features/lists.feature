Feature: Lists and cards
  A type's view and a tag's page list their pages as a list, a table, a gallery of cards or a
  board, sorted and grouped. The choice is kept per type. Cards show what the type picks under
  "On cards" in its settings.

  Names used below:
  - view switch: toggle group "View" with "List", "Table", "Gallery" and "Board"
  - "Sort by" picker and the "Ascending" / "Descending" button next to it
  - "Group by" picker, offered when the pages have a select or checkbox property

  Background:
    Given the app is open in a browser at 1280x800 with no stored data
    And Books "Dune" (Rating 5, Status Read), "Emma" (Rating 3, Status Reading) and
      "Ulysses" (no rating, Status To read) exist

  Scenario: The list view
    When I open "Books"
    Then the view is "List", sorted by Title ascending: Dune, Emma, Ulysses
    And each row shows the book's icon, title and its Author and Status, the Book's card properties

  Scenario: Sorting
    When I pick "Rating" in "Sort by"
    Then the order is Emma, Dune, Ulysses: books without a rating come last
    When I click "Ascending"
    Then it reads "Descending" and the order is Dune, Emma, Ulysses

  Scenario: The table view
    When I pick "Table"
    Then a table has the columns Title, Author, Rating, Status, Finished on and Tags
    And clicking the row "Emma" opens Emma

  Scenario: The gallery view
    When I pick "Gallery"
    Then each book shows as a card with its cover, icon, title and card properties,
      two cards to a row in a single pane and one in a narrow pane

  Scenario: The board view
    When I pick "Board"
    Then there is a column per Status option in order, To read, Reading and Read, then "No status"
    And each book's card sits in its status's column, with each column's count beside its name

  Scenario: Grouping a list
    When I pick "Status" in "Group by" on the list view
    Then the books are listed under the headings "To read", "Reading" and "Read"
    And empty groups are not shown

  Scenario: The view is kept per type
    When I pick "Gallery" for Books and reload
    Then Books opens as a gallery and People still opens as a list

  Scenario: A tag's page lists what is tagged
    Given "Dune" and "Emma" have the tag "classic" in their Tags
    When I open the tag "classic"
    Then "Tagged · 2" lists Dune and Emma with the same view switch, sort and group
