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
- Never while you type. Only when a block is finished, when a page opens, when you come back,
  at day start.
- Nothing moves. Tail never narrows the text, collapses the sidebar, scrolls, or opens a popup.
  No toast or sound. The one count is on the bar's Suggestions icon: offers the panel has not shown.
- Everything a nod does is undoable, and the line says what it did, with Undo, for a moment.
- Lines expire: a suggestion when its block's words change, a nod, or the daily card's Dismiss
  all; Today's lines at the next beat. Nothing piles up. A beat never redraws Today while you are on it; it waits until you
  are back.
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
3. **The bar's Suggestions** (`components/suggestions.tsx`, features/suggestions.feature). What
   tail offers about a block you wrote is a row in the panel, never in the text: no chip, no
   margin, nothing moved. Two groups, each shown only with rows: On this page, where hovering or
   tabbing to a row lights its block's words as Show does and the nod acts in place; and
   Elsewhere, offers about other pages, quoting their words, and the day's rows (not on Today,
   which shows them under its day bar), each name
   opening its page beside the one in front (a nod there opens it first). A new offer raises the
   count on the icon; rows the open panel shows are seen. An offer stays while its block's words
   stand, across pages and restarts; leaving its page once the panel has shown it thirty seconds
   counts as ignored, once. A page coming to the front with offers turns an unpinned panel to
   Suggestions.
4. **The capture box.** For an idea of three words or more, the project button shows the guess,
   muted, with a trailing "?", and the footer offers `⌃↩ Task in Garden` when the words read as
   a task, else `⌃↩ In Garden`, which files the idea there and keeps it an idea; once you pick
   the project yourself, only the task offer stays. ⌘↩ still saves an idea, as before. One turn
   runs at a time per opening of the box: the first after three words and a one-second pause,
   the next only once three or more words changed since the words the last one answered, again
   after a pause. An answer shows when it comes, whatever you typed meanwhile, unless the box
   closed or you picked the project; each one replaces the guess shown.

The key: ⌃↩ nods the first offer or row on the page in front, the first row on Today. It is in the
shortcuts table, so it can be changed.

Settings › AI › Tail: Off, Quiet (Today's rows and the return row only; no suggestions, no
capture guess) or Normal; Read a block after, the two waits below; the model and effort, as Ask has them; Reads on; a link to the page about you
(below); and the last beat, when it ran and how many lines it gave or why it didn't go, with Run
now. Tail's spend shows in the usage meter at the bottom of the sidebar, beside Ask's.

## What it says

Present tense, plain words, no "I", no exclamation. The verb on the button says what the nod
does. After a nod, the same row in the past tense, with Undo for eight seconds. On Today the
sentence then stays, without Undo, until you leave the page or the next beat, so the rows under
it never move; a suggestion just leaves. A count such as "3 ideas" is a name
too: it opens Captures in the bar, where those ideas wait.

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
| Capture text for a project, not a task | (project button) Garden? | ⌃↩ In Garden | saved as an idea in Garden, box closes |

## When it reads

A block is read when it is finished: at once on Enter at its end (the block just ended, not the
empty line the cursor is on); after a full stop at its end and ten seconds of quiet; or after
twenty seconds of quiet in any case (`lib/tail-read.ts`). The word rules still decide whether a
finished block is worth a turn. Each wording goes once: the app keeps, per page, a fingerprint of
every block it sent (its words trimmed and lowercased), kept beside the page's thread and outliving
it, and never sends those words again on that page. One turn per page at a time; a block finished
meanwhile waits and goes only if its words still stand and are still unsent.

The daily card on Today, once a day, when earlier days left offers or captures not reviewed:
"Yesterday left 4 things." when all are from yesterday, else "Left over: 5 things.", with Go through (the first beside Today, in the panel that answers it;
the card counts down), Dismiss all (captures reviewed, offers gone, nothing counted as ignored)
and Hand off (a task "Review yesterday's leftovers", its brief naming each item and its pages,
assigned through `lib/assign.ts`; the card reads "Handed to an agent." until its report comes
back; it needs Projects on).

## What it sees

Context is scoped by the trigger, never a dump of the space. Each trigger has a budget.

| Trigger | Sees | Budget |
|---|---|---|
| A finished block | The block and a few around it; the page's title, type and properties; the index (every page's title, type and aliases, no bodies) once per page thread, then only entries new or changed, kept as a hash per page with its ref | about 2k tokens |
| Coming back | The page's text, which block was edited last, and when | about 4k |
| The beat | A digest of what changed since the last beat: title, type, updated time, first line, done, due, project. Bodies only of changed pages, capped. Captures since; open tasks; reports not accepted | about 8k |
| Capture | The words typed, the project titles, the last few captures | about 1k |

Never: sidenotes and Thoughts pages, unless sent as feedback; pages reached only through a tag
or a daily note, which nearly every page shares (DECISIONS 19); pages of a type not ticked in
**Reads on**. Reads on is Settings › AI › Tail › Reads on, per type, the same control and the
same defaults as Settings › Writing › Use on: on for pages written in, off for records, except
tasks, which the beat reads as open tasks. Reads on governs a page's summary and words. The index
of titles, types and aliases covers every page, so a name can still be linked: a title is what
you type to link, and the sidebar shows it anyway.

A thread sends a page's text once and again only when it changed, as Ask does (the Seen map in
`lib/turn.ts`). The beat sends summaries from the `space` store, which already keeps every
page's summary in memory, and reads bodies only for pages whose updated time moved.

What changes against today: Ask reads only what you point it at; the beat reads summaries of
pages you did not open. Reads on is the control for that. Nothing leaves the Mac except the
model calls themselves, exactly as with Ask.

## What it remembers

Three plain things, all on this Mac, all readable.

1. **The nod ledger.** What you took and ignored, by kind, page type and project, for thirty
   days. It quiets a kind after three ignores in the same place and ranks the rest; a suggestion is
   ignored only if the panel showed it thirty seconds before you left its page. Small, local,
   never shown as a list; its effect shows as a sentence on the page about you. It has a
   version: a build that changes it starts the ledger over and takes tail's own quiet sentences
   off the page, so a quiet that an older build's bug set lifts. A Today row
   shown on two days without a nod stays out, that row only, until its record changes: "Not
   asking again about *Garden plan* for now."
2. **The page about how you work.** One page per space, of a system type the app makes (as
   Agent and Report are, DECISIONS 20), never offered in New. Tail rewrites it in sentences,
   each dated: "Most ideas go to Garden." "Tasks get their day on Fridays." "Links on Meeting
   pages are quiet." At most about forty lines, so it stays readable; tail prunes the old. You
   can edit or delete any line and tail follows: delete the quiet line and that kind comes
   back. Tail reads this page at the start of every turn. It is reached from Settings › AI ›
   Tail and by search.
3. **Threads.** A new thread for every beat, so it never grows; the beat keeps the day's record of
   the bodies sent, so a body goes again only once its page changes. One resumed thread per page
   for its suggestions and the return row, which sends the index once and a block once, and one
   per opening of the capture box, as Ask threads work, carrying what tail
   already saw so nothing is re-sent. The day's record ends with the day, a
   page's thread after four hours, a capture box's after ten minutes.

Tail never keeps your words beyond a thread, never keeps a sidenote, and never keeps anything
from a page it was not allowed to read.

## Timing

Design mode was the prototype's; the real values go with the model.

| | Design | Real |
|---|---|---|
| Quiet after a full stop before a block is read | 3 s | 10 s |
| Quiet before a block is read in any case | 5 s | 20 s |
| Away before "you stopped at" and a beat | 10 s | 15 min |
| Beat while the app is open | 2 min | 30 min |
| A done row | 8 s | 8 s |
| Pause before a capture turn | 1 s | 1 s |
| A suggestion shown in the panel before leaving its page is ignored | 30 s | 30 s |
| Effort of a suggestion or capture turn | low | low |

A suggestion has no timer: it stays while its block's words stand. The two read waits are in
Settings › AI › Tail; a value set there holds in both builds.

## The model

GPT-6.1 Sol at high by default, through the Codex app server exactly as Ask runs GPT models
(DECISIONS 7), with Claude as the switch. Sol is not in ChatGPT itself, only the API and Codex,
so this is the one path. Pause and capture turns run at low whatever the setting, since the
choice is small; beats and the return row keep the chosen effort. The browser build's stand-in (`lib/agent-standin.ts`) plays the model
with the prototype's word rules, so every scenario runs headless without Codex, and its log
shows exactly what would have been sent.

## The prototype on this branch

Real now: every line and the capture box's guess come from a tail turn (`lib/tail-prompt.ts`,
`tailTurn` in `lib/turn.ts`), in the Mac app with the real timings; the nod ledger, the page about
how you work and the quieting (`lib/tail-memory.ts`); and Settings › AI › Tail, whose Last beat row
is the Mac app's one view of it. Not yet: the word rules still find every candidate, the model only
picks; the rest in DEFERRED. In a browser `__tail.seed()`, `.beat()`,
`.reset()` and `.log` drive the scenes, and the stand-in plays the model.

## Later, not in this project

The Feed row for a report tail has read, with its one-line verdict and Accept; trust earned
per kind, so a nodded-at kind acts first and tells you after; drift detection, the thread held
for you after ten minutes of page switching; tail as a standing agent in the runtime that takes
chores itself.
