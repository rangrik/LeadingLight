# Project 2: where it stands

The plan is [PROJECT-2.md](PROJECT-2.md). One row per slice, filled in as each lands.

| Slice | State | Evidence |
|---|---|---|
| 1 Scoped content reads | Built | features/project-context.feature; runtime 0.3.30-ll.25 (patch 0030, its Go test); scope seam test; a real Claude and a real Codex chat read Plan's text and status, were refused an outside page without its title, and found no private note |
| 2 Attributed publication | Built | features/reports.feature, objects.feature; a real Claude chat published to a page open with unsaved typing (the words, cursor and scroll stayed), a retried publish made one report, a publish with the app closed was told "kept" and appeared once on reopen; sources checked against the page's words |
| 3 Evidence inside the report | Built | features/evidence.feature; a real Claude chat made chart.png with a shell command and published it with a caption: the report shows the image, still red and blue after the agent overwrote it green and deleted it; a missing file was refused at once with its reason |
| 4 Assign a task/document | Built | features/assign.feature; through the UI: Assign pressed twice quickly made one Agent page and one conversation; the agent (real Claude) worked in the folder, wrote summary.md and published a ready report with it as evidence; after a reload the same agent showed |
| 5 Subtasks and live widgets | | |
| 6 Feed and contextual answers | | |
| 7 Select and send feedback | | |
| 8 Read the new response | | |
| 9 Accept the result | | |

## Limits
