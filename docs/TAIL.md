# Tail

Tail is a peer that reads along. It watches what you do in LeadingLight, guesses what you
meant, and offers one line you can nod at. It never asks a question and never writes into
your words until you nod. Silence is an answer.

This file is the design. `features/tail.feature` is the contract, `PROJECT-3.md` the build
brief, and DECISIONS 29 the why. A prototype on the branch `worktree-tail-design` built every
surface with word rules in place of the model, so the feel was judged first.

## Rules

- One line, under twelve words, with one verb button: the nod. If it would need a choice,
  it is not a tail line.
- Never while you type. Only at a pause, when a page opens, when you come back, at day start.
- Nothing moves. Tail never narrows the text, collapses the sidebar, scrolls, or opens a popup.
  No toast, sound, badge or count.
- Everything a nod does is undoable, and the line says what it did, with Undo, for a moment.
- Lines expire: a chip when its words change or after a while, Today's lines at the next beat.
  Nothing piles up. A beat never redraws Today while you are on it; it waits until you are back.
- Every line names what it read. "You left *Garden plan* mid-sentence" says which page tail
  opened, and the name opens it. There is no separate screen of what tail saw.
- Tail acts through what exists: a page's open editor, a new page, a property, Assign. Never a
  delete, except on Undo, of the page the nod itself just made.

## Where it speaks

The same row everywhere, after the work panel's rows (`components/work-panel.tsx`):
`flex min-h-6 items-center gap-x-2 text-sm`; the icon `MessageSquareDashed` (lucide, 16 px,
muted); the sentence muted, with page names and quoted words in the foreground, clickable;
the nod a `Button size="xs" variant="outline"`. It fades in and out over 150 ms.

1. **Today, at day start.** Up to three rows under the day bar, above the body. No heading,
   no border. They come from the records and are never stored in the note.
2. **A page you come back to.** One row in the band above the title, where the hover controls
   (Add icon, Add cover) already sit so that nothing moves; they wait while the row is there.
   It says where you stopped and leaves on the first edit.
3. **The line you just wrote.** A chip in the margin, placed like a sidenote (13 px on 19.5 px,
   level with the first baseline, 32 px right of the text, at most 224 px wide): the sentence,
   then the nod with its key. Shown only when the margin fits beside the text as it is; else
   the row above the title, quoting the words. One chip per page at a time.
4. **The capture box.** The project button shows the guess, muted, with a trailing "?", and the
   footer offers `⌃↩ Task in Garden`. ⌘↩ still saves an idea, as before.

The key: ⌃↩ nods the chip or row on the page in front, the first row on Today. It is in the
shortcuts table, so it can be changed.

Settings › AI › Tail: Off, Quiet (Today's rows and the return row only; no chips, no capture
guess) or Normal; the model and effort, as Ask has them; Reads on; and a link to the page about
you (below). Tail's spend shows in the usage meter at the bottom of the sidebar, beside Ask's.

## What it says

Present tense, plain words, no "I", no exclamation. The verb on the button says what the nod
does. After a nod, the same row in the past tense, with Undo, for eight seconds.

| When | Line | Nod | After |
|---|---|---|---|
| A page left mid-sentence before today | You left *Garden plan* mid-sentence yesterday. | Open | opens it beside |
| Two or more ideas since a day, some task-like | 3 ideas since Tuesday. 2 look like tasks for *Garden*. | File them | Filed 2 as tasks in *Garden*. Undo |
| A task that names a day but has none | *Call Sam about the invoice* has no day. | Set Friday | Due Friday. Undo |
| An untitled page with words in it | An untitled page from Friday starts "Soil for the back bed…". | Name it | Named *Soil for the back bed*. Undo |
| Back on a page after a while | You stopped at "ask Sam whether the". | Show | scrolls there, lights it |
| A line that reads as a task | Make this a task? | Make task | Made a task, due Friday. Undo |
| A word that is a page's name | *Sam* has a page. | Link | Linked. Undo |
| Capture text that reads as a task for a project | (project button) Garden? | ⌃↩ Task in Garden | saved as a task, box closes |

## What it sees

Context is scoped by the trigger, never a dump of the space. Each trigger has a budget.

| Trigger | Sees | Budget |
|---|---|---|
| A pause on a page | The block you are on and a few around it; the page's title, type and properties; the index: every page's title, type and aliases, no bodies | about 2k tokens |
| Coming back | The page's text, which block was edited last, and when | about 4k |
| The beat | A digest of what changed since the last beat: title, type, updated time, first line, done, due, project. Bodies only of changed pages, capped. Captures since; open tasks; reports not accepted | about 8k |
| Capture | The words typed, the project titles, the last few captures | about 1k |

Never: sidenotes and Thoughts pages, unless sent as feedback; pages reached only through a tag
or a daily note, which nearly every page shares (DECISIONS 19); pages of a type not ticked in
**Reads on**. Reads on is Settings › AI › Tail › Reads on, per type, the same control and the
same defaults as Settings › Writing › Use on: on for pages written in, off for records.

A thread sends a page's text once and again only when it changed, as Ask does (the Seen map in
`lib/turn.ts`). The beat sends summaries from the `space` store, which already keeps every
page's summary in memory, and reads bodies only for pages whose updated time moved.

What changes against today: Ask reads only what you point it at; the beat reads summaries of
pages you did not open. Reads on is the control for that. Nothing leaves the Mac except the
model calls themselves, exactly as with Ask.

## What it remembers

Three plain things, all on this Mac, all readable.

1. **The nod ledger.** What you took and ignored, by kind, page type and project, for thirty
   days. It quiets a kind after two ignores in the same place and ranks the rest. Small, local,
   never shown as a list; its effect shows as a sentence on the page about you.
2. **The page about how you work.** One page per space, of a system type the app makes (as
   Agent and Report are, DECISIONS 20), never offered in New. Tail rewrites it in sentences,
   each dated: "Most ideas go to Garden." "Tasks get their day on Fridays." "Links on Meeting
   pages are quiet." At most about forty lines, so it stays readable; tail prunes the old. You
   can edit or delete any line and tail follows: delete the quiet line and that kind comes
   back. Tail reads this page at the start of every turn. It is reached from Settings › AI ›
   Tail and by search.
3. **Threads.** One resumed thread per day for the beat and one per page for chips, as Ask
   threads work, carrying what tail already saw so nothing is re-sent. The day's thread ends
   with the day; a page's after four hours.

Tail never keeps your words beyond a thread, never keeps a sidenote, and never keeps anything
from a page it was not allowed to read.

## Timing

Design mode was the prototype's; the real values go with the model.

| | Design | Real |
|---|---|---|
| Pause before a chip | 3 s | 20 s |
| Away before "you stopped at" and a beat | 10 s | 15 min |
| Beat while the app is open | 2 min | 30 min |
| A chip's life | 60 s | 10 min |
| A done row | 8 s | 8 s |

## The model

GPT-6.1 Sol at high by default, through the Codex app server exactly as Ask runs GPT models
(DECISIONS 7), with Claude as the switch. Sol is not in ChatGPT itself, only the API and Codex,
so this is the one path. The browser build's stand-in (`lib/agent-standin.ts`) plays the model
with the prototype's word rules, so every scenario runs headless without Codex, and its log
shows exactly what would have been sent.

## The prototype on this branch

`lib/tail.ts` and `components/tail.tsx` hold the store, the triggers, the word rules, expiry,
nod and undo, and the four surfaces; `__tail.seed()` fills a browser build with the pages the
scenes use, `__tail.beat()` runs a beat now. It lacks the model, Settings, the memory, Reads on,
chips on list items and headings, and is off in the Mac app.

## Later, not in this project

The Feed row for a report tail has read, with its one-line verdict and Accept; trust earned
per kind, so a nodded-at kind acts first and tells you after; drift detection, the thread held
for you after ten minutes of page switching; the capture guess in the Mac panel; tail as a
standing agent in the runtime that takes chores itself.
