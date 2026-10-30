---
title: Writing tools
description: Focus mode, Syntax highlight, Style check, Grammar check and Counts, after iA Writer, and how to choose where they work.
---

# Writing tools

LeadingLight has five aids for writing, after the ones iA Writer's users love most: **Focus mode**, **Syntax highlight**, **Style check**, **Grammar check** and **Counts**. They only change how the page looks to you. Nothing in the page is changed or saved because of them, so turning one off leaves no trace.

All of them run on your Mac. No text leaves it.

## Turn a tool on or off

| Tool | Key | On to begin with |
| --- | --- | --- |
| **Focus mode** | <kbd>⇧⌘F</kbd> | No |
| **Syntax highlight** | <kbd>⇧⌘D</kbd> | No |
| **Style check** | <kbd>⌥⇧⌘D</kbd> | No |
| **Grammar check** | <kbd>⇧⌘G</kbd> | Yes |
| **Counts** | <kbd>⇧⌘W</kbd> | Yes |

<img class="shot" src="/screenshots/settings-writing.webp" alt="Settings › Writing, with Focus mode, Syntax highlight, Style check and Grammar check" />

You can also use:

- **The Writing menu**: the **Writing** button at the right of each page's header. It shows a check beside each tool that is on, with its key. It also has **Review writing** (see [Writing coach](/write/writing-coach)) and **Writing settings…**, which opens **Settings › Writing**.
- **The View menu** in the menu bar. <Badge type="info" text="Mac app" />
- **Settings › Writing**, with a switch for each tool and its choices.

Each tool is a setting for the whole app, kept on this Mac, and stays as you left it.

## Focus mode

Focus mode keeps the line you are writing in the middle of the page, so your eyes stay in one place. Choose how it works under **Focus on** in **Settings › Writing**:

<img class="shot" src="/screenshots/focus-mode.webp" alt="Focus mode: every line but the one being written is dimmed" />

| Focus on | What you see |
| --- | --- |
| **Sentence** | The sentence you are writing is drawn as usual. The rest of the page, including the title, properties and backlinks, is dimmed. |
| **Paragraph** | The whole paragraph you are writing is drawn as usual. In a list, only the item you are in. |
| **Typewriter** | Nothing is dimmed. The line with the cursor stays in the middle of the page. |

In every mode, the line with the cursor stays in the middle as you type, press <kbd>Return</kbd>, or move with <kbd>↑</kbd> and <kbd>↓</kbd>, with empty page below it at the end. Clicking a line or dragging to select text does not scroll the page; it waits until you next type or move by keyboard. Near the top of a page, where it can't scroll further, the line stays where it is.

When you click into the title, nothing is dimmed, since you are not writing in the body. A page shown inside another page is dimmed like any other block you are not writing in.

Even with Focus mode off, the page scrolls as you type near the bottom, to leave some room below the cursor. Only the pane you are writing in scrolls.

## Syntax highlight

Syntax highlight colours parts of speech, in English, so you can see how each sentence is built.

<img class="shot" src="/screenshots/syntax-highlight.webp" alt="Syntax highlight colours nouns, verbs, adjectives, adverbs and conjunctions" />

| Part of speech | Colour | Example |
| --- | --- | --- |
| Nouns | Red | fox |
| Verbs | Blue | sleeps |
| Adjectives | Yellow | quick |
| Adverbs | Magenta | basically |
| Conjunctions | Green | and |

The colours come from your theme. Pronouns, articles and prepositions keep the text colour, and code is never coloured.

New words take their colours once you pause typing, within half a second. Words already coloured keep their colours while you type.

Choose which parts are coloured under **Parts of speech** in **Settings › Writing**.

The tagger is small and sometimes guesses wrong. For example, a verb at the very end of a sentence can read as a noun.

## Style check

Style check strikes through words that add nothing, in English. Point at a struck word and a tooltip names what it is:

- **Filler**, such as "Basically".
- **Redundancy**, such as "plan ahead".
- **Cliché**, such as "at the end of the day".

The words are never deleted. Copying the page copies them as you typed them. When you change the words, the strike goes away once you pause typing.

Choose what is struck under **Strike through** in **Settings › Writing**: **Fillers**, **Redundancies** and **Clichés**.

## Grammar check

Grammar check finds spelling and grammar mistakes in English, using Harper, a checker that runs on your Mac. **Grammar help** in **Settings › Writing** decides how it shows them:

- **When I ask** (the default): nothing is underlined while you write. Choose **Review writing** in the Writing menu to go through suggestions one at a time. See [Writing coach](/write/writing-coach).
- **While I write**: mistakes are underlined as you go.

With **While I write**, spelling mistakes get a red dotted underline and grammar mistakes a green one, within a few seconds. Point at one to see the reason, such as "Incorrect indefinite article.", and click it to open its suggestion. Fix the word and pause, and its underline goes.

The browser's own spelling underline is turned off while Grammar check is on, so no word is underlined twice. Code, inline code and links to pages are never checked.

Turn Grammar check off and the underlines go, and the system's spelling check comes back.

## Counts

Counts sit beside the page's name, after the breadcrumbs, in muted text. They read like this:

> 14 words · <1 min read · ● nouns · ● verbs · ● adjectives · ● adverbs · ● conjunctions · 1 filler

- Each part of speech shows its number and a dot in its Syntax highlight colour. Point at a dot to see what it is. The names show only where there is room.
- Parts of speech and style kinds are counted whether or not their marks are shown. Kinds with none are left out.
- With **While I write**, the counts also show misspellings and grammar issues.
- The counts never crowd the page's name. A narrow page shows only the counts that fit whole, in order.

Select some words and the counts are for the selection, such as "3 of 14 words". They follow your typing within a moment.

Click the counts for every number: words, characters, sentences, paragraphs, reading time, each part of speech, each style kind and each grammar kind, with the selection's beside the page's.

With pages side by side, each one counts its own page, and only the one you are writing in dims.

## Choose which pages the tools work on

The tools work on the types of pages chosen under **Use the tools on** in **Settings › Writing**. The suggestion is:

- **On** for pages you write in: Pages, Daily notes, Meetings, Projects, Ideas and any type you make.
- **Off** for records: People, Books, Tags and Collections.

A page of a type that is off has no Writing menu and no counts, and nothing on it is dimmed, coloured or underlined.

Tick or untick a type to change it. Once you differ from the suggestion, **Use suggestions** appears; click it to go back. Unticking a type never changes its pages' text or properties.

::: info Limits
Syntax highlight and Style check are English only. On very long pages, Syntax highlight and grammar underlines can make typing a little slower. In the Solarized Light theme, adjectives and conjunctions are close in colour.
:::

## Related

- [Writing coach](/write/writing-coach)
- [The block editor](/write/editor)
- [Settings](/customize/settings)
- [Keyboard shortcuts](/customize/shortcuts)
