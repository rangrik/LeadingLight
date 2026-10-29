Feature: Browser comments on elements and areas
  A comment keeps the page evidence it describes and goes only to the selected chat.

  Scenario: Recover space used by forgotten comments
    Given saved comments include pages and workspaces I no longer open
    When I open Browser settings
    Then I see the total number of saved comments
    When I cancel Remove saved comments
    Then every saved comment remains
    When I confirm Remove saved comments
    Then saved comments are removed across all workspaces
    And comments and images already attached to a chat remain in that chat

  Scenario: Hover before selecting an element
    Given a personal browser tab is open in annotation mode
    When I move over a button
    Then that button is outlined without activating it or creating a selection
    And an old hover response cannot outline a new page
    When I click the button
    Then its element feedback opens and the button is not activated

  Scenario: Drag to comment on an area
    Given a browser tab is open in annotation mode
    When I drag across an area of the page
    Then the selected rectangle stays within the displayed page
    And area feedback shows the frozen screenshot, its page address and its dimensions
    And the page receives no click or drag
    When I cancel the drag or the page resizes before release
    Then no area comment is created

  Scenario: Save several comments for one page
    Given I have selected an element or area in a browser tab
    When I write a comment and choose Save comment
    Then the comment appears in that page's saved comments
    And temporary style previews are reset
    When I save a second comment and remove the first
    Then only the second comment remains
    And comments from another page or workspace do not appear
    When I close the tab and reopen the same page in this workspace
    Then its comments remain available with their original screenshots

  Scenario: Escape closes the style menu before element feedback
    Given element feedback has a typed comment and a temporary style preview
    When I open the Style property menu and press Escape
    Then only the menu closes
    And the feedback panel keeps my comment and preview
    When I press Escape again
    Then element feedback closes and its temporary preview is reset

  Scenario: Send frozen comments to one chat
    Given a page has an element comment and an area comment with screenshot evidence
    When I choose Ask about comments
    Then the selected chat receives both comments, their page addresses and the screenshot evidence
    And the page text and frame addresses are quoted as untrusted metadata
    And later page changes do not change the comments already attached to that message

  Scenario: Abandoned previews expire
    Given I preview a style change while element feedback is open
    When the viewer disappears without closing its feedback panel
    Then the runtime lease expires and resets that viewer's temporary style changes
    And another viewer's active previews remain

  Scenario: Saving fails without losing earlier comments
    Given saved browser comments are at the storage limit
    When I try to save another comment
    Then the browser explains that old comments must be removed
    And the existing comments survive reloading the app
    Given a comment is saved but resetting its preview fails
    Then the saved comment remains available
    And retrying the reset does not save a duplicate comment
