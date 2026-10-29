Feature: Browser annotations
  Comments identify the visible page and keep temporary previews owned by their viewer.

  Scenario: Hovering before choosing an element
    Given the browser picker is open on a page with a button
    When I move the pointer over the button without clicking
    Then the button is outlined without activating it
    And no editable element handle or style preview is created

  Scenario: Selecting an element in a nested frame
    Given the page contains a nested frame from another allowed origin
    When I select a button inside the frame
    Then the feedback names that button and the frame address
    And its outline matches the button at the current zoom and scroll
    When I preview a text color and reset it
    Then that button's original style returns and other frames stay unchanged

  Scenario: A frame changes after selection
    Given I selected an element inside a frame
    When the frame navigates or its selected element is removed
    Then applying a preview fails with a message to inspect again
    And no element in the new frame is changed

  Scenario: A frame cannot be mapped accurately
    Given the selected frame is rotated, skewed or mirrored
    When I try to preview a style inside it
    Then feedback explains that the transform is unsupported
    And no style changes

  Scenario: Font and spacing previews reset exactly
    Given an element has existing inline styles and priorities
    When I preview its font, margin, gap and opacity
    And I reset the previews
    Then its original inline style attribute returns
    And unrelated changes made by the page remain

  Scenario: Reset preserves the absence of inline styles
    Given an element has no inline style attribute
    When I preview only its opacity and reset it
    Then the element has no inline style attribute again
    And website rules that match an inline style attribute do not start matching it

  Scenario: A viewer disappears during a preview
    Given one viewer owns a temporary style preview
    And another viewer has a different selected element in the same tab
    When the first viewer closes without sending its cleanup request
    Then its preview is reset after its 15 second lease expires
    And the second viewer's active preview stays unchanged

  Scenario: Two viewers choose the same element
    Given one viewer owns a temporary style preview
    When another viewer tries to preview that same element
    Then it is told to wait for the existing preview to end
    And it cannot use or reset the first viewer's handle

  Scenario: A screenshot area belongs to the selected page
    Given I drag an area within the visible browser page
    When I save a comment on that area
    Then the annotation keeps a screenshot, the page address and its bounds
    But if the page navigated or changed viewport before capture
    Then the capture fails and asks me to select the area again

  Scenario: Element evidence changes while its screenshot is captured
    Given I selected an element and wrote a comment
    When the document reloads at the same address or the element moves during capture
    Then saving fails and asks me to inspect the element again
    And no screenshot is attached with the old element's metadata
