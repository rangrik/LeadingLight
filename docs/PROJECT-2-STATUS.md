# Project 2: where it stands

The plan is [PROJECT-2.md](PROJECT-2.md). One row per slice, filled in as each lands.

| Slice | State | Evidence |
|---|---|---|
| 1 Scoped content reads | Built | features/project-context.feature; runtime 0.3.30-ll.25 (patch 0030, its Go test); scope seam test; a real Claude and a real Codex chat read Plan's text and status, were refused an outside page without its title, and found no private note |
| 2 Attributed publication | Built | features/reports.feature, objects.feature; a real Claude chat published to a page open with unsaved typing (the words, cursor and scroll stayed), a retried publish made one report, a publish with the app closed was told "kept" and appeared once on reopen; sources checked against the page's words |
| 3 Evidence inside the report | Built | features/evidence.feature; a real Claude chat made chart.png with a shell command and published it with a caption: the report shows the image, still red and blue after the agent overwrote it green and deleted it; a missing file was refused at once with its reason |
| 4 Assign a task/document | Built | features/assign.feature; through the UI: Assign pressed twice quickly made one Agent page and one conversation; the agent (real Claude) worked in the folder, wrote summary.md and published a ready report with it as evidence; after a reload the same agent showed |
| 5 Subtasks and live widgets | Built | features/task-work.feature; a real Claude agent set its activity and checklist, made subtasks Outline and Draft and ticked Outline, was refused ticking its own task, started a Codex worker (kept as an Agent page under it) and published a ready report; the panel went Working, Ready for review; Stop and Continue from the panel; growing the checklist moved a paragraph being read by 0 px in Chromium and WebKit |
| 6 Feed and contextual answers | Built | features/feed.feature; a real Claude agent gave its question's context, asked; the Feed counted 1, listed it with task and project, opened Plan beside it with the quoted words lit and centred while the page being read stayed put; answering June in the Feed resolved the chat's request and the agent went on to a ready report, which the Feed listed; ⇧⌘I in an 820 px window opened and closed the Feed as a pane |
| 7 Select and send feedback | Built | features/feedback.feature; on a real agent's report: typing changed nothing, four notes added, three ticked, still ticked after leaving and coming back; one left out in the dialog, a comment added, sent; the stream shows the batch as Sent; the agent's message had exactly the two points, and reading the Thoughts page through its tools showed those two and "2 private" |
| 8 Read the new response | | |
| 9 Accept the result | | |

## Limits
