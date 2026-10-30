---
title: Tail and suggestions
description: Tail reads along as you write and now and then offers one line you can accept with a single press, or ignore.
---

# Tail and suggestions

Tail reads along as you work and, now and then, offers one short line with one button: file these ideas, give this task its day, link this name. Press the button to accept, or ignore the line and it goes away. Tail never asks you a question, never moves anything on the page, and never writes into your words until you press.

Most of the time Tail shows nothing at all. A page of plain writing, with no task in it and no name to link, gets no offers.

Tail runs in the Mac app, through the Codex or Claude Code on your Mac, just as Ask does. See [AI and agents](/ai/) for setup.

## How a line looks

Every Tail line is the same row: a small icon, a short sentence in muted text with page names in full colour, and one small button. Pressing the button is called a nod.

Every line names what it read. Click a name to open that page. A count such as "3 ideas" is a name too: it opens those pages in **Captures** in the bar.

After a nod, the row says what it did, in the past tense, with **Undo** for eight seconds. **Undo** puts back exactly what the nod did.

## Three lines at the start of the day

When you open Today, up to three Tail rows sit under the day bar, above the page's body. Nothing else on the page moves, and no count shows in the sidebar.

| When | The line | The button | After you press it |
|---|---|---|---|
| You left a page mid-sentence | You left *Garden plan* mid-sentence yesterday. | **Open** | Opens it beside Today |
| Ideas have piled up, some like tasks | 3 ideas since Tuesday. 2 look like tasks for *Garden*. | **File them** | Filed 2 as tasks in *Garden*. |
| A task names a day but has none | *Call Sam about the invoice* has no day. | **Set Friday** | Due Friday. |
| A page has words but no name | An untitled page from Friday starts "Soil for the back bed…". | **Name it** | Named *Soil for the back bed*. |

**File them** turns the ideas that read as tasks into tasks in that project, and leaves the others as ideas. **Set Friday** sets the task's due date. **Open** opens the page beside Today, so Today stays where it is.

You can write in Today's body while the rows show; they stay where they are. After a nod, the row keeps its past-tense sentence until you leave Today, so the rows under it don't move.

### When the lines change

Today's lines are made fresh from your pages at each beat (see [When Tail reads](#when-tail-reads)), so they never pile up: the next beat shows only what is still true. A beat never changes Today while you're looking at it; it waits until you come back. A row that goes fades out before the room it took closes.

If Today shows the same row on two days and you nod at neither, Tail stops showing that row (not its kind) and writes on [the page about how you work](#the-page-about-how-you-work): "Not asking again about *Garden plan* for now." It comes back once that page is edited, or you delete the sentence.

## Where you stopped on a page

Come back to a page after a while away, and a row above its title says where you stopped, such as You stopped at "ask Sam whether the". with a **Show** button. The title and words stay where they always are; **Add icon** and **Add cover** wait while the row shows.

- **Show** scrolls to that paragraph and lights it for a moment.
- Type anything in the page and the row goes.

## Suggestions as you write

When you finish a block, Tail reads it and may offer a suggestion. Suggestions live in the bar's **Suggestions** panel, never in your text. Open it from the bar or with <kbd>⌥⌘S</kbd>. A new suggestion raises the count on the Suggestions icon; nothing in the page changes, the text doesn't narrow, and nothing scrolls.

| When | The line | The button | After you press it |
|---|---|---|---|
| A line reads as a task | Make this a task? | **Make task** | Made a task, due Friday. |
| A word is a page's name | *Sam* has a page. | **Link** | Linked. |

**Make task** turns the line into a link to a new task, with the line's words as its name, its due date set from the line, and links to the people it names. **Link** turns the name into a link to that page.

The panel has two groups:

- **On this page**: suggestions about the page in front. Hover or select a row to light its words in the page.
- **Elsewhere**: suggestions about other pages, and the day's rows when you're not on Today. Click a name to open that page beside the one in front.

When there's nothing, the panel reads **Nothing yet.** When a page with suggestions comes to the front, an unpinned panel turns to Suggestions.

### What a suggestion does over time

- It stays while its block's words stay the same, across pages and restarts.
- Type again on that line, and it goes. Stop, and Tail reads the new words.
- Each wording is read once. Write the same line again and Tail doesn't send it again.
- After you nod, you can keep typing; the row and its **Undo** stay for eight seconds, and **Undo** keeps what you typed since. After **Undo**, that line gets no offer again until its words change.

## Nod from the keyboard

Press <kbd>⌃↩</kbd> to nod at the first row on Today, or the first suggestion for the page in front. It does nothing while a menu or a dialog is open. You can change the key in [Keyboard shortcuts](/customize/shortcuts).

## The capture box's guess

When you type an idea of three words or more into the [Quick capture](/capture/quick-capture) box, Tail guesses which project it belongs to. After a short pause, the project button reads the guess in muted text with a question mark, such as **Garden?**, and the footer offers one of these before **⌘↩ Save**:

- **⌃↩ Task in Garden**, when the words read as a task. Press <kbd>⌃↩</kbd> to save it as a task in Garden.
- **⌃↩ In Garden**, when they don't. Press <kbd>⌃↩</kbd> to save it as an idea in Garden.

<kbd>⌘↩</kbd> still saves an idea with no project, as before. If you pick a project yourself, the button shows your choice with no question mark, and only the task offer stays. A web address gets no guess; the guess is for words.

Tail guesses again only once three or more words have changed since its last guess.

## When Tail reads

Tail reads only at a pause, never while you type:

- **A finished block**: at once when you press <kbd>↩</kbd> at its end; ten seconds after a full stop at its end; or twenty seconds after you stop typing in any case. You can change both waits in **Settings › AI › Tail › Read a block after**.
- **Coming back to a page** after a while away.
- **The beat**: when the app opens, about every half hour while it's open, and when you come back after a while away. The beat makes Today's lines.
- **The capture box**: a second after you stop typing.

## What Tail reads

Tail reads only what each moment needs, not your whole space:

| Moment | What it reads |
|---|---|
| A finished block | That block and a few around it; the page's title, type and properties; and the titles and types of your pages |
| Coming back to a page | That page's text |
| The beat | A short summary of each page, and the words of pages that changed since the last beat, each once |
| The capture box | What you typed, your project names, and your last few captures |

You choose which kinds of page Tail may read, in **Settings › AI › Tail › Reads on**. Tick a type and Tail reads its pages' summaries and words. It starts with the same types as **Settings › Writing › Use on** (pages you write in, not records such as people and books), plus tasks. Tail still sees the titles of every page, so a name can be linked.

Tail never reads:

- Your sidenotes and Thoughts pages, unless you sent them to an agent as feedback.
- Pages it would reach only through a tag or a daily note.
- Pages of a type you haven't ticked in **Reads on**.

What it reads is sent to Anthropic or OpenAI, depending on the model, as with Ask. If an answer comes back that the app can't use, nothing shows and no error appears.

## The page about how you work

Tail keeps one page of short, dated sentences about how you work, such as "Most ideas go to Garden." or "Links on Meeting pages are quiet." It reads the page every time it runs, and keeps it to about forty lines.

The page is yours to read and correct. Open it from **Settings › AI › Tail › How you work**, or find it with search. Change a sentence and Tail follows: change "Most ideas go to Garden." to "Most ideas go to House." and the next filing offer names House. The page never shows in **New**.

### Going quiet

A line you leave without a nod counts as ignored: a suggestion the open panel showed for thirty seconds before you left its page (counted once), the "you stopped at" row once you start writing without pressing **Show**, or a row you saw on Today that a later beat no longer shows. Writing in Today's body doesn't count against its rows, and neither does coming back to a page again and again without typing.

When you ignore the same kind of offer three times in the same place, Tail goes quiet about it and writes a sentence such as "Links on Meeting pages are quiet." Delete that sentence and the offers come back.

## Settings › AI › Tail

| Setting | What it does |
|---|---|
| **Offers** | **Off**: nothing from Tail shows anywhere, and no beat runs. **Quiet**: Today's lines and where you stopped on a page; no suggestions from what you write, and no guess in the capture box. **Normal**: all of it. |
| **Read a block after** | Seconds of quiet after a full stop, and in any case, before a block is read |
| **Model** | Claude's models through Claude Code, or GPT's through Codex |
| **Effort** | How long the model thinks |
| **Reads on** | The types of page Tail may read |
| **How you work** | **Open** shows the page about how you work |
| **Last beat** | When the last beat ran and how many lines it gave, such as "10:32, 3 lines", or why it didn't go. **Run now** runs one at once. |

Changes take effect at once.

### The model and what it uses

Tail starts on GPT-6.1-Sol at High effort, through Codex. Pick a Claude model to run it through Claude Code instead. Suggestions and capture guesses always run at low effort, since the choice is small; the beat uses the effort you set.

Tail runs without being asked, so it uses your plan even when you don't press anything. Its use shows in the usage rings at the bottom of the sidebar, beside Ask's; see [How much of your plan is left](/ai/#see-how-much-of-your-plan-is-left). To use less, choose **Quiet** or **Off**.

## The daily card

On Today, once a day, a card shows when earlier days left suggestions or captures you haven't reviewed. It reads "Yesterday left 4 things." when all are from yesterday, otherwise "Left over: 5 things.", with three buttons:

- **Go through** opens the first item beside Today. The card counts down as you deal with each.
- **Dismiss all** marks the captures reviewed and clears the suggestions. Nothing counts as ignored.
- **Hand off** gives a task "Review yesterday's leftovers" to an agent, with each item and the pages it links to. The card reads "Handed to an agent." until the report comes back under **Feed**. Hand off needs **Projects** on in Settings › AI; see [Assign tasks to agents](/ai/tasks-for-agents).

::: info Limits
- <kbd>⌘Z</kbd> after a nod puts the words back but leaves the task page the nod made. Use the row's **Undo**, which takes back both.
- Suggestions come only for plain paragraphs, not for list items or headings.
- Tail offers only the kinds of line in the tables above.
:::

## Related

- [The bar](/workspace/bar)
- [Quick capture](/capture/quick-capture)
- [Captures inbox](/capture/inbox)
- [Tasks](/organize/tasks)
- [Tags and daily notes](/organize/tags-daily)
