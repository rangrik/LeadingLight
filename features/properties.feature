Feature: Properties and types
  Every page has a type and can hold any property. A property is defined once for the whole
  space (name, kind, options) and can be used by any page or type. A type is a bundle the user
  edits: name, icon, colour and its properties. Pages of a type show its properties in order;
  a page may add more of its own. Starter types (Person, Book, Meeting, Project, Idea,
  Collection) come as data and can be changed like any other.

  Names used below:
  - property bar: the line under the title with the type picker "Type", the "Add property"
    button and the "Page options" menu
  - property rows: one row per property under the property bar, each with the property's name
    as a button (opening its menu) and its value
  - property picker: popover "Add property" with a searchbox "Find or create a property"
  - property editor: dialog "Edit property"
  - sidebar sections: "Types" (one row per type, by its plural name) and "Recent"
  - type view: what a type's sidebar row opens: its plural name, a "New" button, a
    "Type settings" button and its pages
  - type settings: dialog "Type settings"

  Background:
    Given the app is open in a browser at 1280x800 with no stored data
    And I have created a page titled "Dune"

  Scenario: A plain page has a quiet property bar
    Then the property bar shows the type "Page" and "Add property", and there are no property rows
    And the body starts right under the property bar

  Scenario: Starter types are there from the start
    Then the "Types" section lists Pages, Tags, Daily notes, People, Books, Meetings, Projects,
      Tasks, Ideas and Collections

  Scenario: Changing a page's type shows that type's properties
    When I pick "Book" in the "Type" picker
    Then property rows "Author", "Rating", "Status", "Finished on" and "Tags" appear in that order,
      all empty
    And the sidebar row "Dune" shows the Book type's icon

  Scenario Outline: Each kind of value can be set and survives a reload
    Given the page's type is "Book"
    When I set <property> to <value>
    And I wait 1 second and reload the browser
    Then <property> still shows <value>

    Examples:
      | property    | value                                  |
      | Rating      | 5                                      |
      | Status      | the option "Reading"                   |
      | Finished on | 22 October 2026                        |
      | Author      | a new page "Frank Herbert", created from the picker |

  Scenario: Adding a property of my own to one page
    When I click "Add property", type "Pages" and pick "New property “Pages”" as a Number
    Then a "Pages" row appears on "Dune" only
    When I set it to 412 and create another page
    Then the other page has no "Pages" row

  Scenario: Reusing an existing property
    Given another page has the property "Pages" set
    When I click "Add property" on "Dune" and type "pag"
    Then "Pages" is offered as an existing property, and picking it adds the row

  Scenario: The property picker says properties are shared, and who uses each
    When I click "Add property" on the plain page "Dune"
    Then the picker says "Properties are shared by all pages."
    And "Birthday" shows "People" on its right and "Rating" shows "Books": the types that use them
    And "Status" is listed twice, one showing "Books" and the other "Projects"
    And no row shows a kind such as "Text" on its right; the icon on the left shows the kind
    And a property I made that no type uses shows nothing on its right

  Scenario: The description isn't a second property
    When I click "Add property" and type "desc"
    Then the picker offers "Description" with "Under the title" on its right, and no
      "New property “Description”"
    When I pick it
    Then the "Description" field shows under the title, focused, and there is no "Description" row
    When I type "A desert planet" and open "Add property" again, typing "desc"
    Then "Description" is not offered, and neither is "New property “Description”"
    When I open "Type settings" for Books, click "Add property" and type "description"
    Then "New property “Description”" is not offered there either, and the picker says
      "A page's description is the line under its title."
    When I type the name of a property the page already has
    Then the picker says "Already added." rather than showing nothing

  Scenario: A "Description" property from an older build joins the line under the title
    Given a space saved by an older build, with a Text property "Description" on the Book type:
      "Dune" holds "A desert planet" in it and nothing under its title, "Emma" holds "Comedy of
      manners" in it and "A novel" under its title, and "Ulysses" holds it empty
    When the app opens
    Then "Dune" shows "A desert planet" under its title and "Emma" shows "A novel Comedy of manners"
    And "Ulysses" has no line under its title
    And no page shows a "Description" row, Books' Type settings no longer list it, and
      "Add property" offers only the "Description" that is the line under the title
    And each of the three keeps the Updated date it had
    When I reload
    Then all of that is still so
    Given instead the older "Description" property was a Number
    When the app opens
    Then it is renamed "Description (old)" and keeps its values

  Scenario: A property can't be renamed "Description"
    When I open "Edit property" for "Rating" and type "Description" as its name
    Then "Save" is off and the dialog says "A page's description is the line under its title."

  Scenario: Page options holds the page's own actions
    When I click "Page options"
    Then it lists "Save as type…", "Delete page…", "Start an essay on this page" and the group
      "To-do and highlight style" with "Plain" and "Playful"
    And it has no "Open Pages": the breadcrumb's "Pages" opens the list (shell.feature)

  Scenario: Adding a page's own property to its type
    Given "Dune" is a Book with its own property "Pages"
    When I open the "Pages" property menu and click "Add to Book"
    Then every Book page shows a "Pages" row, after the Book's other properties

  Scenario: Removing a property from a page or a type
    Given "Dune" has its own property "Pages" set to 412
    When I open the "Pages" property menu and click "Remove from page"
    Then the row is gone, and after adding "Pages" again the value is empty
    When "Dune" is a Book with "Rating" 5, "Foundation" a Book with no rating, and I open the
      "Rating" menu and click "Remove from Book"
    Then "Foundation" no longer shows "Rating", and "Dune" keeps it as its own property with 5

  Scenario: Editing a select property's options
    When I open the "Status" menu of a Book, click "Edit property", add the option "Abandoned"
      in red and save
    Then "Abandoned" can be picked for "Status" on every Book

  Scenario: Renaming a property renames it everywhere
    When I rename "Rating" to "Stars" in the property editor
    Then every page and type shows "Stars" with the values it had

  Scenario: Changing a property's kind keeps the old values
    Given "Dune" has "Rating" set to 5
    When I change "Rating"'s kind to Text in the property editor and save
    Then the Book type has an empty Text property "Rating"
    And "Dune" still shows "Rating (old)" with 5

  Scenario: Many-valued relation and the other side
    Given "Dune" is a Book whose "Author" is "Frank Herbert"
    When I open "Frank Herbert"
    Then "Linked books · 1" at its end shows a small card for "Dune", from the Author property's
      other side, and there is no "Books" row among its properties

  Scenario: Save a page's shape as a new type
    Given "Dune" has its own properties "Pages" and "Publisher"
    When I click "Page options", then "Save as type", enter "Novel" and confirm
    Then "Novels" appears under "Types"
    And "Dune" is a Novel showing "Pages" and "Publisher" as type properties

  Scenario: A type view lists its pages
    Given "Dune" and "Foundation" are Books
    When I click "Books" in the sidebar
    Then the pane shows "Books" with both pages, and clicking one opens it
    When I click "New"
    Then a new untitled Book opens with the Book properties

  Scenario: Every type's view has the same header
    When I open "Pages", "Books" and "Tags" in turn
    Then each starts with its type's 64 px icon above its name; Pages shows the page symbol
    And each has the same controls: "List", "Table", "Gallery", "Board", "Sort by", the sort
      direction and "Group by"

  Scenario: An empty type says what it is for
    Given there are no Books
    When I open "Books"
    Then it shows "No books yet", one sentence on what Books are for, and a "New book" button
    When I click that "New book" button
    Then a new untitled Book opens
    When I open a type I made, "Novels", with no pages
    Then it shows "No novels yet" with a sentence that fits any type, and a "New novel" button

  Scenario: Editing a type
    When I open "Books", click "Type settings", rename it to "Book" / "Library", pick the icon "📚"
      and move "Rating" to the top
    Then the sidebar reads "Library" with "📚" and Book pages show "Rating" first

  Scenario: Created and updated dates
    When I add the properties "Created" and "Updated" to "Dune"
    Then they show today's date and can't be edited

  Scenario: An unknown property in stored data is kept
    Given "Dune" was saved with a value for a property that no longer exists
    When I edit its title
    Then the stored page still has that value

  Scenario: Pages side by side show their own properties
    Given "Dune" is open beside a Person page
    Then each pane shows its own type and property rows
