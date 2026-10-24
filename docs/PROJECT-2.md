# Project 2 — Read, ask, and review work in LeadingLight

2026-10-24. Follows the delivered [Project 1](PROJECT-1-STATUS.md), reported merged and installed
at `c954e40` with runtime `0.3.30-ll.24`. This plan incorporates the full planning conversation and
its later corrections. The user has authorized implementation, developer-owned QA, merge and install.

## The experience

Read a brief, assign an agent, and carry on. The task shows real activity and linked workers. When
an agent needs a decision, the Feed opens the question with the exact supporting material beside it.
When work is ready, read its explanation and watch or inspect the evidence in LeadingLight. Highlight
several passages, choose which sidenotes to send, add an optional overall comment, and send once.
Read one new response answering those points. Accept the main task when satisfied. Code, terminals
and transcripts are optional detail throughout.

Keep the existing sidebar, reading panes, sidenotes and media. Feed is a secondary lane between the
sidebar and content, with All projects / one-project filtering; it can be closed. On a narrow window,
use the existing pane navigation instead of squeezing three unreadable columns together. Use COSS
controls and calm existing typography. No new dashboard, arbitrary widget programming, mandatory
planner/worker/reviewer hierarchy, political-system harness, or extra provider runtime.

## Build on what actually shipped

- `lib/project-runtime/{transport,live,chat,requests,submission,transcript}.ts` and the pinned berthd
  already own project conversations, turns, requests, workers, browsers and retained file outputs.
  Keep their opaque identities and acknowledgement semantics; an HTTP success is not agent completion.
- `ProjectFolder` in `lib/store.ts` binds a page to the external folder/runtime location. Use it for
  scope, including GitHub checkouts. Project 2 does not add another workspace manager or scheduler.
- Tasks already exist as configurable page types, with `done`, due date and project relation
  (`starter.ts`, DECISIONS 17). Extend them without replacing custom types or changing existing tasks.
- `catalog.ts`, Settings › Types/Properties, `linked.ts`, `doc-links.ts`, panes and sidenotes are the
  source model. `agents.ts` describes reusable agent profiles; a running Agent object is a separate
  instance linked to a profile and stable runtime conversation, not a second profile with the same name.
- `note-tools.ts` currently serves editor-dependent note chats. Project agents need a scoped bridge
  to LeadingLight's stored content. `live.ts` coordinates open editors, but is not a durable background
  publication service. Chat watching currently follows visible chats; Feed must reconcile all assigned
  work, including pages never opened this launch.
- Existing outputs retain provider-observed file writes. They do not automatically retain shell-created
  files or display image previews. Explicit evidence publication must import these too; a workspace
  path or temporary browser URL alone is not retained evidence. Reuse `assets.ts` and native media.

## Contracts and boundaries

**Content and scope.** Add a small authenticated local tool bridge for Claude and Codex project agents,
using the existing runtime's extension/MCP path. Resolve author, project and conversation from the
caller binding, not agent-supplied labels. Expose typed reads and narrowly scoped actions, not raw DB
writes. Support page bodies, properties with IDs, outgoing links, backlinks, Thoughts, essays,
attachments, tasks and evidence, alongside authorized external files through Project 1. Return stable
source references, pagination and explicit missing/denied results. Traverse cycles safely from the
assigned project's authorized scope, using existing data rather than a second graph database.
Personal/unselected sidenotes must not leak through whole-page, Thoughts or graph reads: share selected
notes only through the batch. Ordinary authorized documents remain traversable.

**Safe publication.** Prefer immutable linked Report pages, displayed as attributed groups in the
parent document/task's reading stream, over rewriting its body. A report stores author instance,
conversation/turn, destination, time, stable block anchors, source links and optional batch ID.
Published prose is append-only, including the agent's own earlier prose. Corrections are new reports.
Human text has no agent label. Authenticate authorship and reject agent overwrite/delete operations
on published reports and human prose in this project-interaction flow. Keep existing explicit editing
features for other workflows; do not expose their blanket `write_page` action to autonomous publication.
Reports must be searchable, linkable and readable through the same tools, not an invisible side store.

Persist each accepted publication once before acknowledging it. Separate immutable reports from the
human editor's mutable body so a delayed autosave cannot erase either. Preserve IDs, open drafts,
selection and scroll position. Closed-page publication works immediately; if the app is fully quit,
retain pending publication durably through the runtime and reconcile on reopen rather than silently
losing it or claiming it is already visible. No new background agent is needed for reconciliation.
Live widgets are a deliberate exception: their structured data can change in place. Reading position
must not jump with routine status updates.

**Objects and ownership.** Preserve the page/type/property model. Use the existing Task plus linked
Agent, Report, Feedback batch and Evidence records/pages where appropriate. Runtime questions and
approvals remain canonical runtime records; their Feed presentation need not create duplicate pages.
Agent instances link task, parent/children, profile and conversation; retain finished-worker associations
instead of relying only on the runtime's current notification watch list. History remains available
when a session stops. Retain a readable conversation reference/snapshot as needed before runtime
cleanup; do not put whole transcripts in page properties.

An explicit Assign action on a task or project document starts one execution with its brief and scoped
context. A casual mention does not launch work. A document assignment binds a linked task; repeated
clicks/reconnects do not spawn copies. Agents can create supported pages/blocks, tasks/subtasks,
conversations and subagents and operate the connected browser using the existing runtime. Agents
complete their own subtasks. The main task progresses through understandable Working / Needs your
input / Ready for review states; only a user action marks its Done property. A turn ending or workers
finishing does not mean acceptance. Gate this in the mutation boundary as well as the UI. Ordinary
unassigned tasks retain today's checkbox behavior.

**Evidence.** Publishing evidence copies the specific image/video/document into LeadingLight-owned
storage and records task, author, source output ID/path, time and immutable revision identity. Show it
inside the report with normal media/document viewing. Later source edits produce a new revision;
existing feedback still opens the reviewed one. Workspace cleanup must not remove published evidence.
Do not execute arbitrary embedded artifact scripts just to preview a result. Missing or failed imports
remain explicit, and cannot be presented as successfully retained evidence.

**Feed.** Aggregate questions, approvals, meaningful notices and ready-for-review items across projects.
Each item has a plain-language reason, responsible agent/task, project, and exact context target(s):
page/block, submitted question, retained evidence revision, image or video moment when applicable.
Selecting opens that context beside the item and preserves the current reading location. Require
agents to supply useful context when raising a project question; provider approval details remain
available when needed. Reuse Project 1 request IDs/generations and answer receipts, so answering here
also settles the chat card and stale events cannot reopen it. Preserve answer drafts and clear failure
states. Routine tool activity, worker counts and checklist changes stay on task/project pages. No
notification for every status update; one actionable event is one Feed item after reconnect.

**Widgets.** Start with five supported compositions: current activity, concrete checklist, question/
decision, evidence, and review. Reuse these in task pages and Feed rather than separate implementations.
Agent-authored checklist/activity data may update; runtime state and worker count come from canonical
records. Show completed/total only when a concrete checklist defines the total. Never invent a percent
from an agent's estimate. Decisions and evidence references remain attributable and durable.

**Batch feedback.** Extend the existing sidenote flow with selection and one “Send feedback” action.
No per-note send buttons or response threads. Preserve the draft and selection through navigation.
Show the recipient and selected items before sending, plus an optional overall comment. On send,
freeze one envelope with batch/command ID, selected note text/IDs, source page/block and excerpt,
evidence revision/location when relevant, task, responsible conversation and overall comment. Private
notes and unrelated text are excluded. Deliver once through Project 1, with a visible retryable state
and the same command ID after lost acknowledgement. Never silently reroute feedback to another agent.

The agent publishes ONE new attributed response, with an answer block for each submitted point and
links to its question/source; an unanswered point gets an explicit explanation. Validate those links
and coverage before marking the response ready. Do not reply inside the old sidenotes, duplicate old
comments in the document, or require the user to visit/close each one. Submitted notes may collapse
out of the current draft; the minimum immutable context remains accessible through source links even
if the original note/passage changes or disappears. The user reads the new response, makes fresh notes
there, and sends a new batch. A latest-answer view beside an original passage is a later optional
presentation; earlier prose stays stored, and “latest” is never labelled “correct” automatically.

**Settings catalogue.** Extend Settings with one understandable catalogue of supported objects and
widgets, including kinds the app/agents create that are absent from New. Explain purpose, creator,
what can change, where it appears and how to open examples/instances. Cover existing project/task,
agent profile versus instance, report, batch, evidence, request/approval, and each widget. Add entries
with each slice, not as a final documentation sweep. Keep data-defined types/customizations intact;
use capability/creation metadata instead of hardcoding starter display names. Agents create instances
of supported kinds, not arbitrary hidden executable widget definitions.

## Small delivery sequence

Each row is a usable boundary; split it further when necessary. Aim for 250–600 meaningful changed
lines per change, investigate >800, split around 1,200. This includes tests and copied adaptations;
do not compress code or hide changes in generated files to meet a count. Reuse mature code already
adopted in Project 1; new upstream copies keep pinned provenance, license and relevant tests. Do not
reimport whole apps. Implement Gherkin first; the implementation agent owns its normal smoke, automatic
QA, fixes and release checks. The parent dispatcher does not add another reviewer or test cycle.

| Slice | User-visible result | Required behavior to prove |
|---|---|---|
| 1. Scoped content reads | An agent can answer from the linked project without attaching every page | Both providers; IDs/properties/links/backlinks/Thoughts/essays/attachments/external sources; cycles, pagination, missing links and private-note exclusion |
| 2. Attributed publication | A new readable report appears beside the brief, even if that page is closed | One durable append per command; authentic author; stable response anchors; simultaneous human edits survive; reopen/retry; prior prose cannot be overwritten |
| 3. Evidence inside the report | Images, videos and documents explain the work in LeadingLight | Explicit shell-output import; preview; later source changes and workspace cleanup leave the reviewed revision accessible |
| 4. Assign a task/document | Assign once and see a linked Agent object begin work | Exact project/brief; duplicate-click/restart safety; existing custom Tasks preserved; transcript optional; unsupported setup is explained |
| 5. Subtasks and live widgets | See concrete work, participating workers and completed subtasks | Real runtime state; finished-worker links survive; stop/recovery updates; mutable widgets leave reports intact; agent cannot mark main Done |
| 6. Feed and contextual answers | Answer an agent's question beside its supporting material | All projects/filter; closed tasks included; exact anchor/artifact; keyboard/narrow layout; same request settles in chat; lost/stale/duplicate answers covered |
| 7. Select and send feedback | Read at leisure, select notes and send one batch | Private notes excluded from every agent path; draft survives navigation; excerpt/revision captured; one delivery across retry; clear responsible recipient |
| 8. Read the new response | One fresh report answers the batch point by point | Each answer/source link works; removed source has saved context; no per-note closure chore; a second batch works; partial response stays honestly incomplete |
| 9. Accept the result | Review evidence and mark the main task Done | Agent report produces Ready for review; only user accepts; later work/late events do not silently overwrite that acceptance; Settings covers every introduced kind |

Integrate in three releases: **A** read/publish/retain (1–3), **B** assign/follow/answer (4–6),
**C** review/respond/accept (7–9). Keep intermediate slices compatible and commit them separately;
complete all three releases, not only the first slice. Maintain a short status/evidence table and
record genuine deferrals with their limits. Avoid turning documented Project 1 gaps into an unrelated
cleanup campaign; close only the ones required for these contracts.

## Acceptance and closeout

Use a plain-folder project and an isolated software project, with real Claude and Codex where the
provider boundary matters. In ordinary user actions: assign a brief; receive a contextual question;
answer from Feed; read an attributed report with retained evidence; make four notes, keep one private,
send three with an overall comment; read one three-point linked response; ask a fresh follow-up;
accept the main task. Complete this without opening code or a transcript. Exercise reopen/reconnect,
closed-page publication and human-edit concurrency along this path. Verify catalogue explanations in
Settings and an existing space with customized types. The developer reports what passed and any limits.

Commit, integrate main, run the change's required checks, merge and install using normal repository
closeout. The user authorized finishing without another plan approval. Never kill regular LeadingLight
or touch its data to unblock installation. If a native-only check needs assistance, supply the isolated
named dev app and exact steps; the parent is authorized to perform that requested check, then coordinate
its removal. Report real user-only blockers accurately. Stop your own servers/remove your own dev app.
**Preserve `/Users/pranavkanade/work/LeadingLight-agents-project-1` and its branch as the Project 1
recovery reference.** Project 2 must execute in its own new Shipyard worktree, created through New Task.
