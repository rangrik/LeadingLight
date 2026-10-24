Feature: Page styles
  Each page has a style. Plain is the calm default. Playful adds hand-made touches: to-dos are
  checked off like a pen (see editor.feature), checking one taps softly, and highlights look
  like a marker stroke.

  Names used below:
  - "Page options": the menu in the page's property bar (properties.feature), whose
    "To-do and highlight style" group holds "Plain" and "Playful" as radio items, so the menu
    says what a style changes. A page with no to-dos or highlights looks the same in both.

  Background:
    Given the app is open in a browser with one page open

  Scenario: A new page is Plain
    When I open "Page options"
    Then "Plain" is the chosen style
    And a checked to-do shows a filled box with a check, and its words muted and struck with a straight line
    And checking a to-do plays no sound

  Scenario: Switching a page to Playful
    Given the page has a checked to-do "Water the plants" and a highlighted word
    When I choose "Playful" in "Page options"
    Then the menu closes and no text moves
    And the to-do's box is unfilled with a hand-drawn check and a hand-drawn line through its words, shown at once, not drawn
    And the highlight looks like a marker stroke, and the words around it do not move
    When I check another to-do
    Then it is drawn off like a pen and a soft tap plays
    When I choose "Plain"
    Then the page looks as it did before

  Scenario: Each page keeps its own style
    Given page "A" is Playful and page "B" is Plain
    When I switch between them, and when I reload
    Then "A" is still Playful and "B" still Plain, and "Page options" shows each page's own style
