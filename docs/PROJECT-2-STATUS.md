# Project 2: where it stands

The plan is [PROJECT-2.md](PROJECT-2.md). One row per slice. Each was built Gherkin first, with a
short end-to-end run against real agents in the browser build; then an independent QA pass per
release, its findings fixed; then the plan's acceptance path; then the checks on merged main.

| Slice | State | Evidence |
|---|---|---|
| 1 Scoped content reads | Built | features/project-context.feature; runtime 0.3.30-ll.25 (patch 0030, its Go test); scope seam test; a real Claude and a real Codex chat read Plan's text and status, were refused an outside page without its title, and found no private note |
| 2 Attributed publication | Built | features/reports.feature, objects.feature; a real Claude chat published to a page open with unsaved typing (the words, cursor and scroll stayed), a retried publish made one report, a publish with the app closed was told "kept" and appeared once on reopen; sources checked against the page's words |
| 3 Evidence inside the report | Built | features/evidence.feature; a real Claude chat made chart.png with a shell command and published it with a caption: the report shows the image, still red and blue after the agent overwrote it green and deleted it; a missing file was refused at once with its reason |
| 4 Assign a task/document | Built | features/assign.feature; through the UI: Assign pressed twice quickly made one Agent page and one conversation; the agent (real Claude) worked in the folder, wrote summary.md and published a ready report with it as evidence; after a reload the same agent showed |
| 5 Subtasks and live widgets | Built | features/task-work.feature; a real Claude agent set its activity and checklist, made subtasks Outline and Draft and ticked Outline, was refused ticking its own task, started a Codex worker (kept as an Agent page under it) and published a ready report; the panel went Working, Ready for review; Stop and Continue from the panel; growing the checklist moved a paragraph being read by 0 px in Chromium and WebKit |
| 6 Feed and contextual answers | Built | features/feed.feature; a real Claude agent gave its question's context, asked; the Feed counted 1, listed it with task and project, opened Plan beside it with the quoted words lit and centred while the page being read stayed put; answering June in the Feed resolved the chat's request and the agent went on to a ready report, which the Feed listed; the Feed's key (now ⌥⌘F) in an 820 px window opened and closed the Feed as a pane |
| 7 Select and send feedback | Built | features/feedback.feature; on a real agent's report: typing changed nothing, four notes added, three ticked, still ticked after leaving and coming back; one left out in the dialog, a comment added, sent; the stream shows the batch as Sent; the agent's message had exactly the two points, and reading the Thoughts page through its tools showed those two and "2 private" |
| 8 Read the new response | Built | features/response.feature; a real Claude agent answered a two-point batch with one report, Point 1 and Point 2 each linking to the noted words and the batch; a second batch on that response, where the agent was asked to leave the point out, read "0 of 1 points answered", wasn't ready though the agent asked, left the task Idle, and the first response kept its answers |
| 9 Accept the result | Built | features/accept.feature; a real Claude agent's ready report made the panel say "Read Summary, then accept it or send feedback."; Accept ticked Done ("Accepted just now"); a report published afterwards left Done ticked, showed "a report since" and a Feed notice; a task no agent was given showed no panel; Settings › Objects lists every kind and widget Project 2 brought |

## QA, acceptance and checks

- **Release A QA** (independent, Sonnet, real Claude and Codex, browser build): 22 of 25 scenarios
  passed. Fixed: a read just after quitting waited 40 s (now refused in seconds); a Codex agent's
  report signed "Claude"; Ask's Insert below could reach an open report; Agent and Report in the
  Type menu; every chat agent named "Claude"; images in a report did nothing on a click; sources
  not shown; spellcheck marks on reports; agents couldn't find their kept outputs' ids.
- **Acceptance, plain folder, Claude** ("Field Report": two notes and a CSV): assigned through
  Assign; its question came to the Feed with "Every region should pass 400 units" lit in Targets
  beside it and was answered there; LeadingLight was quit and reopened while it worked; its report
  with a chart it drew arrived for the closed task while I typed in Targets (kept); four notes on
  it, one kept private, three sent with a comment; one response, a part per point, with no private
  note in it; a follow-up note sent and answered; accepted. No code or transcript opened.
- **Acceptance, software project, Codex** (a Git checkout, a space with Task renamed "To-do" and its
  own "Chore" type): a Chore assigned to GPT-6 Luna changed stats.py and its test, ran them and
  published a ready report with the test output as evidence; accepted; the Chore kept its type;
  Settings › Objects read "To-do, Chore" and listed every kind. A Codex agent outside Plan mode has
  no question tool: it asks in its reply, which the Feed lists with a reply field (checked).
- **Checks**: typecheck; seam tests 9/9; runtime Go tests for the touched packages (bridge seam
  test included); the app's Rust tests; Playwright 69/69 after one fix; `pnpm runtime:probe` 27/28
  on runtime ll.25: "agent config changed" failed because the Codex acceptance run, at the same
  time, made Codex add its Git checkout to ~/.codex/config.toml as trusted, which Codex does
  itself (Project 1's acceptance checkout is there too); those two test entries were taken out.

## Limits
