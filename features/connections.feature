Feature: Connections
  A fifth panel of the bar (bar.feature) shows how the page in front sits in the space while I read
  it: a small map of its neighbours, then what it links, what links to it, what it shares with
  pages it does not link, who is involved, and the names in its text that could become links.

  Names used below:
  - Connections: the bar's panel with the lucide waypoints icon, after Captures and before Ask; ⌥⌘L opens it (⌥⌘C is the editor's code block)
  - the page: the page in front, as Suggestions follows it; the panel's header says "Connections" and the page's title
  - neighbours: pages the page links in its body, the pages its relation properties name (Author, Tags, Project), and pages that link to it
  - map: a 180 px tall drawing, the panel's width, with the page as the labelled node in the middle and its neighbours on a ring around it, a line from the middle to each
  - row: a 16 px icon, a 14 px title and a 12 px muted line under it, as the Feed's rows
  - section: an 11 px uppercase muted label with a count, then its rows; a section with no rows is not shown

  Background:
    Given the browser build at 1440x900 with the demo space (?mac&demo)
    And "Notes on Thinking in Systems" is open

  Scenario: The panel and its key
    Then the strip shows Suggestions, Feed, Captures, Connections and Ask, in that order, with no count on Connections
    When I press ⌥⌘L
    Then the Connections panel opens beside the strip, its header reads "Connections" and "Notes on Thinking in Systems"
    And the tooltip on its icon reads "Connections ⌥⌘L"
    When I press ⌥⌘L again
    Then the panel collapses to the strip
    When I put the cursor in a code line of the page and press ⌥⌘C
    Then the line becomes a code block, as before, and the panel does not open

  Scenario: The map
    When I open Connections
    Then the map shows "Notes on Thinking in Systems" in the middle, darker than the rest
    And Thinking in Systems, Stocks and flows, Feedback loops, Donella Meadows, Sam Rivera, reading, systems and yesterday's daily note sit on the ring, each 5 px across its radius and joined to the middle by a line
    And each label is 11 px, cut to 18 characters with an ellipsis, and no two labels overlap; a label that would overlap shows only while its node is hovered
    And every colour is a theme colour, so the map reads in light and dark
    When I hover Feedback loops on the map
    Then its row below lights, as a hovered row does
    When I hover the Feedback loops row
    Then its node and label on the map turn dark
    When I click Feedback loops on the map
    Then Feedback loops opens in a pane beside, and the panel now shows its connections

  Scenario: More than 16 neighbours
    Given a page that links 20 others
    Then the map shows 16 of them and a "+4 more" label; the sections below still list all 20

  Scenario: Links from this page
    Then "Links from this page · 5" lists, in the order they first appear, Thinking in Systems, Stocks and flows, Feedback loops, then the tags reading and systems
    And each row's muted line says its type, and for a relation the property that names it unless that only repeats the type ("Book · Items", but "Tag", not "Tag · Tags")
    And people are not listed here: they are under People

  Scenario: Linked here
    Then "Linked here" lists each page that links to this one once, however many times it does: Thinking in Systems and yesterday's daily note
    And a row's muted line says its type and how many times it links here, or the property it links through
    And it is the same search as the Backlinks at the bottom of the page

  Scenario: Shares with
    Then "Shares with" lists Reading list 2026, which shares the tag reading and Thinking in Systems with this page, the shared names in its muted line
    And a page shows here only when it shares two or more tags or linked pages and is not itself a neighbour
    And pages that share more come first

  Scenario: People
    Then "People · 2" lists Donella Meadows ("Mentioned") and Sam Rivera ("Mentioned")
    When I open "Thinking in Systems"
    Then People lists Donella Meadows with "Author", the property that names her

  Scenario: Not linked yet
    Then "Not linked yet · 1" lists LeadingLight, whose title appears in the text without a link, with a Link button
    And a page the page already links, a tag, a daily note, and a title shorter than three letters never show here
    When I click Link
    Then the first "LeadingLight" in the text becomes a link to the project, through the open editor, so nothing I typed is lost
    And LeadingLight moves from "Not linked yet" to "Links from this page", and appears on the map
    When I press ⌘Z in the page
    Then the link is undone and LeadingLight is back under "Not linked yet"

  Scenario: Names by alias
    Given Sam Rivera's Aliases are "Sam"
    When I open yesterday's daily note
    Then "Not linked yet" lists Sam Rivera with "“Sam”" in its muted line
    When I click Link
    Then "Sam" in "Design review with Sam" becomes a link to Sam Rivera

  Scenario: Live while I type
    When I type "@Feedback" and choose Feedback loops at the end of a paragraph
    Then within half a second nothing new is listed, since it was already linked
    When I type "@Pricing" and choose Pricing notes
    Then within half a second Pricing notes is listed under "Links from this page" and joins the map
    When I delete that mention
    Then it leaves the list and the map, without saving first
    And typing in a 2000-paragraph page with the panel open keeps every key under 16 ms

  Scenario: Rows open beside
    When I click the Stocks and flows row
    Then Stocks and flows opens in a pane beside, as a node's click does

  Scenario: It stays on Connections
    Given the panel shows Connections and is not pinned
    When I open a page that has suggestions
    Then the panel shows that page's connections, not Suggestions: it follows the page itself

  Scenario: Empty state
    When I open a new, empty page
    Then the panel shows the map's middle node alone and says "Nothing linked yet. Type @ in the page to link something."

  Scenario: No page in front
    When the only pane shows the Feed or a type's list
    Then the panel keeps the last page that was in front, as Suggestions does
    When no page has been in front at all
    Then the panel says "Open a page to see what it connects to."

  Scenario: Narrow window
    Given the window is 1000 px wide
    When I press ⌥⌘L
    Then Connections opens as a pane beside the page, titled "Connections", the strip stays, and it shows the page I was reading
    When I press ⌥⌘L again
    Then the pane closes
