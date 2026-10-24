Feature: Pasting Markdown
  Markdown pasted into a page arrives formatted. A new page and one paste make a whole page:
  a heading on the first line names it, the rest becomes its body.

  The Markdown used below (MD):
    # Trip plan
    Some **bold** words and a [link](https://example.com).
    ## Packing
    - passport
    - charger
    1. book
    2. go
    - [ ] visa
    - [x] tickets
    > Travel light.
    ```ts
    const x = 1;
    ```
    | Day | City |
    | --- | ---- |
    | 1   | Rome |
    ---

  Background:
    Given the app is open in a browser

  Scenario: New page, paste
    When I make a new page and paste MD as plain text, with the cursor in the title
    Then the title is "Trip plan"
    And the body holds, in order: a paragraph with "bold" in bold and "link" linking to
      https://example.com, a heading 2 "Packing", a bullet list of 2, a numbered list of 2,
      a to-do list with "visa" open and "tickets" done, a quote, a TypeScript code block,
      a table of 2 rows and a divider
    And no "#", "**", "- [ ]", ">" or "```" shows as text anywhere
    And the cursor is at the end of the body
    When I press Meta+Z
    Then the body is empty again

  Scenario: Pasting into the body
    Given a page with an empty body
    When I click into the body and paste MD as plain text
    Then the body holds a heading 1 "Trip plan" followed by the same blocks as above

  Scenario: Pasting into the middle of a line
    Given the body holds a paragraph "Hello world"
    When I put the cursor after "Hello " and paste "**big**"
    Then the body holds one paragraph "Hello bigworld" with "big" in bold

  Scenario: Headings and lists start on their own line
    Given the body holds a paragraph "second"
    When I put the cursor at its end and paste "## Section\n\nSome text\n\n- a"
    Then the body holds "second", a heading 2 "Section", "Some text" and a bullet list, in that order
    And the cursor is at the end of "a", the last thing pasted
    Given the body holds a paragraph "Hello world"
    When I put the cursor after "Hello " and paste "## Section\n\n> quote"
    Then the body holds "Hello ", a heading 2 "Section", a quote "quote" and "world", in that order

  Scenario: Lines stay lines
    When I paste "Standup notes\nAlice shipped **login**\nBob is on call" into the body
    Then the body holds three paragraphs, one per line, with "login" in bold

  Scenario: Code fences named the short way
    When I paste fences named "tsx", "yml", "TS", "Python" and "text" into the body
    Then their language menus read "TypeScript", "YAML", "TypeScript", "Python" and "Plain text"

  Scenario: The title without a heading
    When I make a new page and paste "Some **bold** words\n- one\n- two" into the title
    Then the title stays empty
    And the body holds the paragraph and a bullet list of 2

  Scenario: Pasting into the title of a page that has a body
    Given a page with an empty title whose body holds a paragraph "kept"
    When I paste "# More\nnew words" into the title
    Then the title is "More"
    And the body holds "new words" then "kept", as two paragraphs

  Scenario: A one-line paste into the title
    When I paste "# Trip plan" into the title of a new page
    Then the title is "Trip plan" and the body stays empty
    When I clear the title and paste "Trip plan"
    Then the title is "Trip plan"

  Scenario: Plain text stays as it is
    When I paste "line a\nline b" into the body
    Then the body has two paragraphs "line a" and "line b"
    When I make a new page and paste "line a\nline b" into the title
    Then the title stays empty and the body has the same two paragraphs

  Scenario: A code block keeps the Markdown as code
    Given the cursor is in a code block
    When I paste MD as plain text
    Then the code block holds MD exactly, with no new blocks

  Scenario: Markdown copied from a raw file in the browser
    Given README.md open as raw text in Chrome, which copies it as plain text and as one <pre>
    When I select all, copy, make a new page and paste
    Then the title is "Trip plan" and the body is formatted, as with MD
    Given a page whose body holds a paragraph "kept"
    When I paste the same at the end of the body
    Then a code block follows "kept", its language "Markdown", holding the file exactly
    When I hover it and click "Turn into formatted text"
    Then the code block is replaced by the formatted blocks, with the cursor at their end
    When I press Meta+Z, even right after clicking
    Then the Markdown code block is back with the cursor in it, and "kept" is untouched
    Given a body holding only empty lines
    When I paste the same
    Then it goes in formatted, as on a new page
    When I copy a raw .txt of plain lines and paste it
    Then each line is a paragraph, not code

  Scenario: Turn into formatted text, wherever the block is
    Given a Markdown code block ending in a divider, or in an image
    When I click "Turn into formatted text" and type "Z"
    Then "Z" lands on a line after the divider or image
    Given the same block as the last block of a list item, with a paragraph "after" below the list
    When I click "Turn into formatted text" and type "Z"
    Then "Z" lands inside the list item, on a line after the divider, and "after" is untouched
    When I press Meta+Z twice
    Then the code block is back in the list item with the cursor in it
    Given a code block typed with "```md"
    Then its language menu reads "Markdown" and it has the "Turn into formatted text" button too

  Scenario: Code copied from a web page stays code
    When I paste HTML of a coloured Python snippet whose lines start with "# ", into a new page
    Then the body holds one Python code block with the snippet exactly
    When I paste it into the title of a new page instead
    Then the title stays empty and the body holds the same code block
    When I paste it at the end of a paragraph "kept"
    Then the code block follows "kept" on its own
    When I paste an uncoloured "<pre><code># install deps\nnpm install</code></pre>"
    Then it is a code block too

  Scenario: Stars and other marks with spaces inside stay as written
    When I type "2 * 3 * 4 = 24" in the body
    Then nothing turns italic
    When I paste "2 * 3 * 4 = 24, a == b == c" into the body
    Then it shows exactly as pasted
    When I type or paste "a *word*", "**bold**", "_it_", "~~gone~~" and "==hi=="
    Then each is italic, bold, italic, struck through and highlighted, without its marks

  Scenario: Formatted HTML still wins
    When I paste a clipboard holding HTML with a heading and a link, and its text as plain text
    Then the heading and the link come from the HTML
    When I make a new page and paste the same into the title
    Then the title stays empty and the body gets the heading and the link from the HTML
    When I paste blocks copied from another page of this app
    Then they arrive as they were copied

  Scenario: Markdown from a code editor
    When I paste a clipboard holding MD as plain text and as HTML of styled lines only, as VS Code gives
    Then the body is formatted from the Markdown
