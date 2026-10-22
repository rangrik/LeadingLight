Feature: Table of contents
  A page with two or more headings shows an "On this page" list left of its text, after
  tweenly's trail: a dotted trail through the headings and a small plane flying to the one in view.

  Background:
    Given the app is open in a browser at 1440x900 with the sidebar collapsed
    And a page with headings "Intro", "Setup", "Usage" and "Details" (a heading 2 under "Usage"),
      with enough text between them to scroll

  Scenario: The list follows the page
    Then "On this page" shows left of the text, listing the four headings, "Details" one step in
    And the plane sits at "Intro"
    When I scroll until "Usage" reaches the top
    Then the plane flies along the trail to "Usage", the trail behind it solid, and "Usage" is bold
    When I click "Setup" in the list
    Then the page scrolls until "Setup" is at the top and the plane flies back to it

  Scenario: The list keeps up with the page
    When I rename "Setup" to "Install", add a heading, or delete one
    Then the list shows the change
    When only one heading is left
    Then the list is gone

  Scenario: The list stays on the left when room is short
    When the panel is too narrow for the list beside the text, or the essay is open beside the page
    Then the trail stays left of the text as a slim rail, with the plane at the heading in view
    And the text moves right just enough that the rail never touches the block handles
    When the pointer rests on the rail, or Tab from the title reaches it
    Then the full list opens over the page
    When I click an entry
    Then the page scrolls there and the list closes back to the rail, until the pointer leaves and comes back
