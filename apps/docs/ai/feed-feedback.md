---
title: The Feed and feedback
description: See what your agents need from you in one place, answer them, and send chosen sidenotes as feedback on their work.
---

# The Feed and feedback <Badge type="info" text="Mac app" /> <Badge type="warning" text="Preview" />

The Feed lists what your project agents need from you, from every project, whether or not their
pages are open. Feedback is how you answer an agent's work: you write sidenotes on its report, pick
the ones it should answer, and send them together.

Both need **Settings › AI › Projects › Linked folders and project chats** turned on, and a task
given to an agent (see [Assigning tasks to agents](/ai/tasks-for-agents)).

## Open the Feed

Click **Feed** in the bar, or press <kbd>⌥⌘F</kbd>. Its icon shows how many items need you. The Feed
opens as a lane beside your pages; press it again to close it. In a window too narrow for a lane
beside a page, the Feed opens as a pane instead, as any page does.

When nothing needs you, it says so: questions, approvals and work ready for review show there.

## What the Feed shows

| Item | Reads like | What you can do |
| --- | --- | --- |
| A question | "Claude: Write the summary asks: Should we ship in May or June?" | Choose an answer, or type your own |
| An approval | "Claude: Write the summary wants to run a command", with the command | **Allow once**, **Always allow in this chat** or **Decline** |
| A plan | "… has a plan ready to start" | Choose how it starts |
| Ready for review | "“Write the summary” is ready for review" | **Accept**, or **Later** |
| An answer to your feedback | "Claude answered your feedback on “Write the summary”" | Open it, or **Later** |
| A stop | "… stopped before “Write the summary” was ready" | Open the task, or **Dismiss** |
| Late work | "Claude published after you accepted “Write the summary”" | Open it, or **Dismiss** |

Each item also names its task, its project and when it arrived ("Write the summary · Research").
**Later** takes a review item off the Feed until a newer report arrives.

Routine work stays out. An agent reading pages, running commands it is allowed to run, updating its
checklist or making subtasks adds nothing to the Feed.

## Answer with the material beside you

Select an item to open what it is about beside the Feed. The page you were reading stays open
where you were.

- **A question about some words.** When the agent said what its question is about, that page opens
  scrolled to those words, which are lit for a moment. The words show on the item too; click them
  to show them again.
- **A question about evidence.** If the question is about a moment in a video, the report opens at
  the video, set to that time (0:42, say).
- **Ready for review.** The report opens beside the Feed.
- **No context.** If the agent didn't say what its question is about, the item says so, and its
  task opens instead.

In a narrow window, where the Feed is a pane, what you select opens in that pane, and its crumb
leads back to the Feed.

## Answered once, wherever

A question in the Feed is the same question as in the agent's chat. Answer it in either place:

- Choose an answer in the Feed, such as "June". The item says "Sent. Waiting for the agent to take
  it.", then goes. The chat shows the question answered "June", with nothing waiting.
- If you answered in the chat first, the Feed item goes on its own.

An answered question never comes back, after a reload or when the runtime reconnects, and the same
answer can't be given twice.

If you type an answer of your own and reload before sending it, your words are still in the item.

### An agent that asks in its own words

A Codex agent outside Plan mode has no question tool, so it asks in its reply and stops. The Feed
lists it as "Codex asks: …" with its words and what it said the question is about. Type in the
item's **Reply** field and press **Send**: the agent gets your reply as a message in its chat,
carries on, and the item goes.

## One project at a time

The Feed's project menu shows **All projects** by default. Choose a project, such as "Garden", to
list only its items. Choose **All projects** to see them all again.

## Use the keyboard

| Key | What it does |
| --- | --- |
| <kbd>⌥⌘F</kbd> | Open or close the Feed, with the focus on its first item |
| <kbd>↓</kbd> <kbd>↑</kbd> | Move between items |
| <kbd>↩</kbd> | Open the item |

## Write notes on a report

Open the report as its own page (press **Open** on its byline, or select its review item in the
Feed). Select a sentence and press **Add sidenote**, or press <kbd>⇧⌘M</kbd>. A note opens beside the
sentence, as on any page.

A report's own words can't change: typing in it does nothing, and its selection bar offers only
**Add sidenote** and **Ask**. See [Sidenotes](/write/sidenotes) for how notes work.

## Choose which notes go

On a page whose task has an agent, each note has a tick at its start, labelled "Send note 1 to
Claude" and so on. Tick the notes you want the agent to answer. Leave the rest: they are yours.

While notes are ticked, the page's header shows **Send feedback**, with how many ("Send feedback ·
3"). Your ticks are kept on this Mac per task: they are still there when you open another page and
come back, or reload.

## Send feedback

1. Press **Send feedback**.
2. The dialog, "Send feedback to Claude", lists the ticked notes, each with the words it is about.
   Press **×** on a note to leave it out.
3. Write an **Overall comment** if you like, such as "Keep it short."
4. Press **Send 2 notes** (the count follows what you picked).

The dialog closes, saying it was sent to Claude. In the task's stream, after the report, a new
entry reads "You sent feedback · 2 points to Claude · Sent", with both notes and your comment. The
sent notes show **Sent** where their ticks were, and **Send feedback** goes.

Feedback always goes to the agent given the task, in its own conversation, never to another agent
or chat. If that conversation was removed, the send says the agent can't be told, and nothing goes
anywhere else.

### Private notes stay private

A note you didn't tick never reaches an agent. The agent's message has only the notes you sent.
If an agent reads the report's notes through LeadingLight's tools, it sees only the sent ones, and
is told how many are private.

### Sent as it was

What you send is kept as it was sent, with the words each note was about. If you change a note
afterwards, or the agent publishes a new report, the batch still shows the note as sent, and an
agent reading the notes reads it as sent.

### When sending fails

If the agent's conversation can't be reached, the stream shows **Not sent** and why, with **Try
again**, and the notes say "Not sent". When it can be reached, press **Try again**: it says
**Sent**, and the agent gets the batch once.

## Read the response

The agent answers a batch with one new report in the task's stream, after the batch, with "answers
your feedback" in its byline. The Feed lists "Claude answered your feedback on “Write the
summary”".

The response has one part per point you sent: **Point 1**, **Point 2** and so on. Each says what the
point was about ("On “…” in Summary") and then the agent's answer.

- Press the words of a point to open the report with your note lit.
- Press **your note** to open the batch as you sent it.
- If you deleted the sentence a note was about, the response and the batch still show what the point
  was about, as it was when sent.

### A point left out

- If the agent says why it can't answer a point, the point reads, for example, "Not answered: it
  needs the budget figures".
- If it leaves a point out altogether, the point reads "Not answered", and the byline says "1 of 2
  points answered". A response like this doesn't make the task ready for review.

Only the agent you sent the batch to can answer it, and only about its own points. Any other
answer is refused.

## A second round

You never close or tidy old notes: once sent, they are done. To go on, add a note to the response
(on an answer, say), tick it and send it. That is a second batch; the agent answers it with a
second response, and the first response and batch stay as they were.

When you are satisfied, press **Accept**. See [Review and accept](/ai/tasks-for-agents#review-and-accept).

::: info Limits
- Ticks waiting to be sent are kept on this Mac only. Clearing the app's storage loses them.
- The Feed matches a question to what it is about by the question's first words. If the agent
  rewords the question in between, the item falls back to the task and says so.
:::

## Related

- [Assigning tasks to agents](/ai/tasks-for-agents)
- [Project chat](/ai/project-chat)
- [The bar](/workspace/bar)
- [Sidenotes](/write/sidenotes)
