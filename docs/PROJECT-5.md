# Project 5 — The task is the place

2026-11-07. Follows Project 2 (reports, assignment, the Feed, feedback) and Project 4 (the bar).
Why: one round of agent work took 14 clicks over three pages (Assign, the work panel, the Feed,
the report's own page to note it, a tick per note, a dialog, the answer at the bottom of a stream,
Accept), and nothing showed at a glance what was being worked on. The prototype that settled the
design is `docs/research/agent-work-three-ways-2026-11-06.html`, option B. The user authorized
implementation, developer-owned QA, merge and install.

Contracts: `features/assign.feature`, `breakdown.feature`, `task-work.feature`, `reports.feature`,
`feedback.feature`, `work-table.feature`, `this-day.feature`, `new-objects.feature`.
Why: DECISIONS 21, 22, 24 (changed), 42 and 43 (new).

## The experience

An idea is written once. Assign turns that page into a task and gives it to an agent; nothing
else is made. The agent can work in a worktree of its own, named from the task. Everything about
the work shows on the task: how it goes, the steps, the subtasks with their own state, the latest
report under the brief, newest first, taking notes where it is read. Ticking notes and pressing
Send on the card is the whole round. The project page opens with a Work table of every task in
flight, and a task's tab carries its state. A big idea is broken into subtasks, by hand with task
lines or by the agent with Plan first; each starts with a press, in parallel where nothing waits,
and the parent's state rolls up. A day's note lists what was made and what was edited that day.

## Pieces, in build order

1. **Assign converts the page.** A page with no Done is retyped to the task type (a choice only
   when the space has several), its Project carried to the task type's Project property, tagged
   "From idea" (or "From meeting", …). The auto-made task, `brief`, `taskOfDocument` and the
   "Assigned as the task" line go. Dialog copy says what happens. `lib/assign.ts`,
   `components/assign.tsx`, `work-panel.tsx`, `lib/feedback.ts` (`recipientFor`), `lib/kinds.ts`.
2. **Own worktree.** A switch in the dialog, shown for a git checkout. The app makes the worktree
   through the runtime before the session starts (as the chat's "own branch" does,
   `lib/project-runtime/chat.ts`), named from the title (DECISIONS 42), and keeps it in the
   Agent page's `run.location`. The brief says where the agent works.
3. **This day.** `CreatedThisDay` (`components/daily-bar.tsx`) becomes "This day": pages made
   that day and pages edited that day, most recent first, each marked.
4. **The task as the dashboard.** On a task, reports show newest first and older ones fold.
   The embedded report takes sidenotes (closes DEFERRED 2026-10-24); the send dialog goes and
   "Send n notes" sits on the card; an overall remark is a note on the task's own words. The tab
   and the sidebar row carry the task's state as a dot. `components/reports.tsx`, `feedback.tsx`,
   `page-view.tsx`, `tab-row.tsx`, the sidebar rows, `lib/feedback.ts`.
5. **Breaking down.** A task line inside a task is a subtask with the parent's Project
   (`link-views.tsx` `linkHost.create`); an `after` relation; Plan first in the dialog; the Work
   table on the parent's card and on the project page; "Start the ready ones"; a subtask's agent
   gets the parent's words; the parent's state rolls up (`lib/work-watch.ts`). `lib/assign.ts`,
   `lib/agent-tools.ts` (task tool: `after`; project tool: `partOf`), `lib/starter.ts`,
   `components/work-panel.tsx`, a new `work-table.tsx`, `backlinks.tsx`.

## Boundaries

- Reports stay immutable pages (20) and feedback a frozen batch (24); only the dialog goes.
- No side card on the right: the margin is for notes. The card under the title is the card.
- Subtasks never start by themselves when one frees up; "Start the ready ones" is a press.
  Merging a subtask's branch back is not the app's job yet (DEFERRED).
- The worktree's name is made by the app from the title, not asked of the model: the session
  must start in the worktree, and asking first would cost a whole session (DEFERRED).
- Untouched: the Feed's kinds, the chat, workers, evidence, the capture panel.
