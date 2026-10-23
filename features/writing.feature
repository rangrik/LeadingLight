Feature: Writing tools
  iA Writer's best-loved editor aids, on our block editor: Focus mode, Syntax highlight, Style
  check (https://ia.net/writer/support/editor), plus a grammar check and counts of everything
  beside the page's name. All run on this Mac; grammar comes from Harper. They only change how
  the page looks to you: nothing in the page is changed or saved because of them. Each is a
  setting for the whole app, kept on this Mac, and holds after a reload. Grammar check and
  Counts are on to begin with; the rest are off.

  Names used below:
  - the Writing menu: button "Writing" at the right of the page panel's header, a menu of
    "Focus mode" ⇧⌘F, "Syntax highlight" ⇧⌘D, "Style check" ⌥⇧⌘D, "Grammar check" ⇧⌘G,
    "Counts" ⇧⌘W and "Writing settings…"
  - Settings › Writing: the same five, plus what each one shows
  - the counts: button "Counts" right after the breadcrumbs, past a thin divider
  - dimmed: drawn at low opacity, 150–200 ms ease-out to change

  Background:
    Given the app is open in a browser at 1280x800 with a page whose body reads
      | Basically, the quick fox jumps. It sleeps now. |
      | A second paragraph.                            |
      | - a list item                                  |

  Scenario: Focus mode dims all but the sentence being written
    Given Focus mode is set to Sentence
    When I put the cursor in "It sleeps now" and press Shift+Meta+F
    Then "It sleeps now." is drawn as usual and the rest of the page is dimmed
    And the title, properties and backlinks are dimmed too
    When I press ArrowDown into "A second paragraph."
    Then only "A second paragraph." is drawn as usual
    When I click the title
    Then nothing is dimmed, since the body is not being written in
    When I press Shift+Meta+F again
    Then nothing is dimmed and the setting is off

  Scenario: Paragraph focus
    Given Focus mode is on and set to Paragraph
    When the cursor is in "the quick fox"
    Then the whole first paragraph is drawn as usual and the other blocks are dimmed
    When the cursor is in "a list item"
    Then only that item is drawn as usual: its list's other items and the other blocks are dimmed

  Scenario: Typewriter keeps the line in the middle
    Given Focus mode is on and set to Typewriter
    And the page is long enough to scroll
    When I put the cursor halfway down the page and type, or press Enter, ArrowDown or ArrowUp
    Then the line with the cursor stays in the middle of the page's height, within a few pixels
    And nothing is dimmed
    When I click a line or drag to select text
    Then the page does not scroll by itself until I next type or move by keyboard
    And near the top of the page, where it can't scroll further, the line sits where it is

  Scenario: Sentence and Paragraph focus keep the line in the middle too
    Given Focus mode is on and set to Sentence
    When I type at the end of a long page
    Then the line with the cursor stays in the middle, with empty page below it

  Scenario: Syntax highlight colours parts of speech
    When I press Shift+Meta+D
    Then nouns, verbs, adjectives, adverbs and conjunctions take the theme's colours:
      | part         | colour      | example  |
      | noun         | red         | fox      |
      | verb         | blue        | sleeps   |
      | adjective    | yellow      | quick    |
      | adverb       | magenta     | Basically|
      | conjunction  | green       | and      |
    And pronouns, articles and prepositions keep the text colour
    And code blocks and inline code are never coloured
    And the tagger is a small one and sometimes guesses wrong: "jumps." at a sentence's end reads as a noun
    When I type " and runs" after "jumps"
    Then "and" and "runs" take their colours once I pause typing, within half a second
    And while I type, the words already coloured keep their colours
    When I turn Adjectives off in Settings › Writing
    Then "quick" keeps the text colour and the rest stay coloured

  Scenario: Style check strikes through fillers, redundancies and clichés
    When I press Alt+Shift+Meta+D
    Then "Basically" is struck through, and pointing at it says "Filler" in the app's tooltip
    When I type "We must plan ahead at the end of the day."
    Then "plan ahead" says "Redundancy" and "at the end of the day" says "Cliché"
    And the words are still there: copying the page copies them as typed
    When I delete "Basically, "
    Then nothing on that line is struck through, once I pause typing
    When I turn Clichés off in Settings › Writing
    Then "at the end of the day" is no longer struck through

  Scenario: Grammar check underlines mistakes
    Given the body also reads "This is a apple. I recieved teh letter."
    Then within a few seconds "recieved" and "teh" have a red dotted underline (spelling)
    And "a" before "apple" has a green dotted underline (grammar)
    And pointing at one shows Harper's reason, such as "Incorrect indefinite article.", in the
      app's tooltip after 0.3 s, not the browser's slow one, with words quoted “like this”
    And moving to the next marked word, straight or across plain text, moves it at once
    And on a mark that wraps onto two lines it points at the line under the pointer
    And the browser's own spelling underline is off, so no word has two
    And code blocks, inline code and links to pages are never checked, and underlines land on the
      right letters after emoji
    When I fix "recieved" to "received" and pause typing
    Then its underline goes
    When I press Shift+Meta+G
    Then no underlines show and the browser's spelling check is back; the counts still count mistakes

  Scenario: Counts beside the page's name
    Then the counts read, on one line in the theme's muted text:
      "14 words · <1 min read · N misspellings · N grammar issues · ● nouns · ● verbs ·
       ● adjectives · ● adverbs · ● conjunctions · 1 filler", each part of speech with its number
      and its Syntax highlight colour, and the parts' names only where the panel is wide
    And parts of speech, fillers and grammar are counted whether or not their marks are shown
    And kinds with none are left out of the line
    And the counts sit on the crumbs' text baseline and take only the room the title leaves: the
      title is never cut while a count shows, a narrow card shows only the counts that fit whole,
      in that order, and one too narrow for the first shows none and no divider
    And pointing at a dot names it in the app's tooltip
    When I select "the quick fox"
    Then they count the selection: "3 of 14 words" and the selection's own parts and issues
    When I type, the counts follow within a moment
    When I click the counts
    Then a popover lists everything: words, characters, sentences, paragraphs, reading time, each
      part of speech, each style kind and each grammar kind, with the selection's beside the page's
    When I press Shift+Meta+W
    Then the counts are gone, and come back with it again

  Scenario: Side by side, each card counts its own page
    Given "Left" is open, and I Shift-click "Right" in the sidebar, or drag it beside "Left"
    And Focus mode and Counts are on
    Then each card's header counts its own page
    And only the card being written in dims; the other shows its page as usual

  Scenario: A long page stays quick
    Given a page of 2000 paragraphs with the tools as they start (Grammar check and Counts on)
    Then a key takes under 16 ms in the Mac app's engine, and counting never freezes the page

  Scenario: The Writing menu shows what is on
    When I open the Writing menu
    Then each tool shows a check when it is on, with its shortcut
    When I pick "Writing settings…"
    Then Settings opens on Writing

  Scenario: Nothing is saved because of the tools
    Given every writing tool is on
    When I type "Basically fine" and reload
    Then the page body is "Basically fine" with no extra marks, and the tools are still on

  Scenario: Embedded and read-only pages
    Given a page shown as "the page itself" inside another page
    When Focus mode is on and I write in the outer page
    Then the embedded page is dimmed like any block that is not being written
