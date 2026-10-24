Feature: Settings › Types and Settings › Properties
  Types and properties can already be changed one at a time, from a page or a type's list.
  Settings gets a section for each that lists every one in the space, so they can be found,
  changed and made in one place, without opening a page first.

  Names used below:
  - Types section: Settings › "Types": one row per type, in the sidebar's order, each with the
    type's icon, its plural name, how many pages it has, and an "Edit" button. "New type" sits
    above the list.
  - Properties section: Settings › "Properties": one row per property, oldest first, each with
    its kind's icon, its name, a muted line with its kind ("Number", "Pages", "Select") and the
    types that use it ("Books", or "Not in a type"), and an "Edit" button. "New property" sits
    above the list.
  - type settings: the dialog "Type settings" (properties.feature). Made from "New type" it is
    titled "New type" and its button reads "Create".
  - property editor: the dialog "Edit property" (properties.feature). Made from "New property"
    it is titled "New property" and its button reads "Create".

  Background:
    Given the app is open in a browser at 1280x800 with no stored data

  Scenario: The two sections sit in Settings
    When I open Settings
    Then its sections read Appearance, Writing, Types, Properties, Capture, AI, Shortcuts, About

  Scenario: Every type is listed
    Given I made a page "Dune" of type Book
    When I open Settings › Types
    Then it lists Pages, Tags, Daily notes, People, Books, Meetings, Projects, Tasks, Ideas and
      Collections, each with its icon
    And "Books" reads "1 page" and "People" reads "0 pages"

  Scenario: Editing a type from Settings
    When I open Settings › Types, click "Edit" on "Books", set the plural to "Library" and save
    Then the row reads "Library", and so does the sidebar's Types list
    And Settings is still open on Types

  Scenario: Making a new type
    When I open Settings › Types and click "New type"
    Then type settings opens titled "New type", every field empty, the Name field focused
    When I type "Recipe" as the name, pick the icon "🍲", add the property "Tags" and click "Create"
    Then "Recipes" is listed last in Settings › Types and in the sidebar's Types
    When I open "Recipes" in the sidebar and click "New recipe"
    Then a new page opens with the type "Recipe" and a "Tags" row

  Scenario: The plural follows the name unless typed
    When I click "New type" and type "Recipe" as the name
    Then the Plural field's placeholder reads "Recipes"
    When I click "Create" with the Plural field empty
    Then the type's plural is "Recipes"

  Scenario: A new type needs a name
    When I click "New type" and click "Create" with the name empty
    Then the dialog stays open and the Name field says "Give the type a name"
    When I press Escape
    Then no type was made

  Scenario: Built-in types can't be deleted
    When I click "Edit" on "Pages", "Tags" or "Daily notes"
    Then type settings has no "Delete type" button
    When I click "Edit" on "Recipes"
    Then it has "Delete type", which removes the row once confirmed

  Scenario: Every property is listed
    When I open Settings › Properties
    Then it lists every property, among them "Rating" reading "Number · Books", "Done" reading
      "Checkbox · Tasks", and "Tags" reading "Pages · People, Books, Meetings, Projects, Tasks,
      Ideas, Collections" (cut with an ellipsis where the row ends, never wrapping)

  Scenario: Editing a property from Settings
    Given "Dune" is a Book with "Rating" 5
    When I open Settings › Properties, click "Edit" on "Rating", rename it "Stars" and save
    Then the row reads "Stars"
    And "Dune" shows "Stars" with 5

  Scenario: Making a new property
    When I open Settings › Properties and click "New property"
    Then the property editor opens titled "New property", Name empty and focused, Kind "Text"
    When I type "Pages", pick the kind Number and click "Create"
    Then a row "Pages" reads "Number · Not in a type"
    And "Add property" on any page offers "Pages"

  Scenario: A new select property with its options
    When I click "New property", type "Mood", pick Select, add the options "Calm" (green) and
      "Busy" (red) and click "Create"
    Then a page given "Mood" offers "Calm" and "Busy"

  Scenario: A new property needs a name
    When I click "New property" and click "Create" with the name empty
    Then the dialog stays open, the Name field says "Give the property a name", and nothing was made

  Scenario: Created and Updated can't be made
    When I click "New property" and open the Kind menu
    Then Created and Updated are not offered; they come from the page itself

  Scenario: A long list scrolls with Settings
    Given the space has 40 properties
    When I open Settings › Properties
    Then the section scrolls as any Settings section does, and every row keeps one height
