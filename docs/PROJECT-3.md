# Project 3 — Tail, a peer that reads along

2026-10-26. The design is [TAIL.md](TAIL.md), the contract `features/tail.feature`, the why
DECISIONS 29. A prototype on the branch `worktree-tail-design` built every surface with word rules
in place of the model (`lib/tail.ts`, `components/tail.tsx`); its frames are the design's
walkthrough. This brief is for the implementing session. The user authorized implementation,
developer-owned QA and the dev app on 2026-10-26; merge and install wait for their word that it works.

## The experience

Open Today and find three lines, each with one verb: the page you left mid-sentence, the ideas
that piled up since Tuesday, the task that names a day but has none. Nod at one or none. Write a
line in a page and, when you stop, a chip beside it offers to make it a task; ⌃↩ takes it, and
the chip says what it did with Undo. Come back to a page after a break and the band above its
title says where you stopped. Type an idea into the capture box and the project button guesses
where it goes. Most of the time, nothing at all. Nothing moves, nothing asks, nothing piles up.

## Build on what shipped

- The Ask runner (`src-tauri/src/agent.rs`, `lib/turn.ts`, `lib/ask-prompt.ts`): one process per
  turn, Codex app server for GPT models, threads resumed by id, a page re-sent only when changed.
  Tail's turns are a new turn kind on this runner, not a second runner.
- The browser stand-in (`lib/agent-standin.ts`) plays the protocol without Claude Code or Codex.
  It gains tail's turns, answered with the prototype's word rules, and logs what was sent, so
  every scenario runs headless.
- `lib/live.ts` (watchLive, editPage, liveEditor), `lib/space.ts` (every page's summary in memory,
  with created and updated times), `lib/templates.ts` (newPage), `lib/assign.ts` (Assign, isTask),
  the sidenote math in `packages/editor/src/sidenotes.tsx`, the writing tools' Use on setting and
  its per-type default (`lib/writing.ts`), the shortcuts table (DECISIONS 15), the usage meter.
- The prototype's store, triggers, expiry, nod and undo, the four surfaces, ⌃↩ and the seed. Keep
  them; replace the word rules with the model behind a stand-in-or-model seam.

## Contracts and boundaries

**Lines.** One sentence under twelve words, one verb button, the same row everywhere (TAIL.md,
"Where it speaks"). Names and quoted words in the foreground open their page. After a nod the
same row in the past tense with Undo for eight seconds; Undo reverts exactly what the nod did.
Lines expire as TAIL.md's timing table says. Every line names what it read.

**Nothing moves.** Measure it: the body's top in a pane is the same before a row appears, while
it shows and after it leaves, in a single pane and in a split; the text column is as wide with a
chip as without; the sidebar never folds for tail. A beat never redraws Today while it is the
focused page in a focused window.

**Acting.** A nod writes through the page's open editor, makes a page with newPage, sets a
property, or assigns a task; never a delete except, on Undo, of the page that nod just made.
Nothing tail shows is stored in a page. Tail never writes into a report (DECISIONS 20).

**Context.** Scoped per trigger with the budgets in TAIL.md's "What it sees"; summaries from the
space store, bodies only of what changed and once per thread. Never sidenotes or Thoughts pages
unless sent, never pages reached only through a tag or a daily note, never a type unticked in
Reads on. The stand-in's log is the proof: QA reads it to see what left the app.

**Memory.** The nod ledger (thirty days, local). The page about how the person works: one per
space, a system type made by the app, found by type id, never in New, at most about forty dated
lines, rewritten by tail and editable by the person, read at the start of every turn; the
quieting lives there as sentences. Threads: one per day for the beat, one per page for chips.

**Settings › AI › Tail.** Off, Quiet, Normal; model and effort as Ask; Reads on per type with
Writing's defaults; a link to the page about you. Tail is on in the Mac app, off nowhere else by
default; the capture box guess works in the browser build and the in-window box; the Mac panel's
guess is in Later.

**Model.** GPT-6.1 Sol at high through the Codex app server by default, Claude through Claude
Code as the switch, both as Ask does it (DECISIONS 7). Spend shows in the usage meter.

## Small delivery sequence

Each row is a usable boundary. Gherkin first (`features/tail.feature`); typecheck; one short
smoke; QA by a Sonnet subagent in the browser; the native parts in the dev app (CLAUDE.md).

| Slice | User-visible result | Required behavior to prove |
|---|---|---|
| 1. The beat with the model | Today's rows and the return row come from the model, or the stand-in in a browser | The four Today kinds; the return row above the title; expiry at the next beat; no redraw while on Today; nothing moves, measured; the Codex and Claude paths; usage moves |
| 2. Context and Reads on | Tail reads only what the trigger needs and what the person allows | Digest for the beat, bodies once per thread; sidenotes and tag-reached pages never sent; Reads on with Writing's defaults; the stand-in's log proves each |
| 3. The chip and the capture guess | A chip beside the line you wrote, the guess in the capture box, both from the model | Pause rule, one chip per page, margin fit or the row above the title, ⌃↩, Undo; capture guess yields to the person's pick; Quiet turns both off |
| 4. Memory | Tail quiets what you ignore and keeps a page about how you work | Two ignores quiet a kind; the page's dated sentences, the forty-line cap, editing it changes the next offer; delete the quiet line and the kind returns; threads end with the day |
| 5. Settings and the Mac app | Off, Quiet, Normal, model, effort, Reads on and the page, all in Settings › AI › Tail | Each setting takes effect at once; the page opens from Settings and from search; the Mac app runs a real beat and chip with Codex signed in |

Integrate in two releases: **A** (1–2), **B** (3–5). Keep intermediate slices compatible. Deferrals
go in `DEFERRED.md` with their reason and what brings them back.

## Acceptance and closeout

In the browser with the stand-in: seed, open Today, nod one row, Undo it; write a task-like line,
take the chip with ⌃↩; come back to a page and press Show; capture an idea and take the guess;
untick a type in Reads on and show the log holds nothing of it; ignore a kind twice and see it go
quiet, then delete its line and see it return. In the dev app with Codex signed in: one real beat,
one real chip, the usage meter moving, the person's own notes untouched. Then the closeout in
CLAUDE.md step 8, once the person says it works.
