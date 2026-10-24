# Project 1: where it stands

The plan is [PROJECT-1.md](PROJECT-1.md). One row per slice. Every slice is merged into main
(2026-10-24) and its checks were run again there: typecheck, seam tests 8/8, Playwright 69/69, the
runtime probe 28/28 (Claude, Codex, browser, requests, workers, recovery), and an independent QA pass
on main. Its findings (links in answers, the Browser view going stale, stopped workers, chats whose
folder moved, workers listed as chats) were fixed and passed QA again. The Mac app is installed
from main.

| Slice | State | Evidence |
|---|---|---|
| 0a Pin, ownership, structured-session probe | Merged | `pnpm runtime:build` (reproducible, checksummed), `pnpm runtime:probe` 9/9 on 2026-10-24 against Claude Code 2.1.310 and Codex 0.164.0; independent QA 9/9, its findings fixed; DECISIONS 18 |
| 0b Browser probe, plain-folder extension | Merged | `pnpm runtime:probe browser`: an agent in a non-Git folder drives its page through the runtime's browser, an observer sees that tab's frames, the folder is left as it was; DECISIONS 18 |
| 1 Link a local folder | Merged | features/external-projects.feature; folder identity by device and inode, moves found again, aliases refused |
| 2 The runtime in the app | Merged | bundled berthd and tmux (built from pinned source), own process group, backup before replacing a build; checked in the installed dev app from outside its window: the runtime starts from the app's own copies, an agent finishes with the app quit, relaunch finds the same runtime, its own data, ports and tmux, SQLite migration 3 |
| 3 Claude project chat | Merged | features/project-chat.feature: exact folder, streaming, stop, approvals, resume, named outputs |
| 4a Requests named and answered once | Merged | runtime ledger with generations and receipts; `pnpm runtime:probe requests`; seam tests in requests.test.ts |
| 4b Question and approval cards | Merged | features/agent-interactions.feature, with a real Claude session |
| 5a Codex in project chats | Merged | features/project-chat.feature (Codex), agent-interactions.feature (Codex); probe codex 6/6 |
| 5b Model, effort, files, skills, MCP | Merged | model and effort reach both providers mid-chat; attachments kept out of the folder; "/" lists the agent's skills; a configured MCP tool ran; settings untouched |
| 6 GitHub checkout, own branch | Merged | clone with this Mac's Git sign-in (a private repo too), stop cleans up, existing checkout reused with its changes kept; worktrees in the runtime's state |
| 7 Outputs kept as each turn left them | Merged | probe: Claude's and Codex's written files kept, unchanged by later edits; Then, Now and Change views |
| 8a Watching the agent's browser | Merged | Browser view: live frames, path and workspace port, tabs, console read without using up the agent's |
| 8b Public pages, a tab per agent, a lost browser | Merged | probe: two agents, two tabs, two cookies; Allow for a refused site; the view says when the browser closed |
| 9a Workers | Merged | probe: a lead hands a task to a Codex worker from its instructions alone and hears back, also when it starts the worker with its task in one step; one worker however often launched |
| 9b Worker cards | Merged | features/agent-coordination.feature: rows per worker with live state, outcome, Stop and Open |
| 10 Checked loops, Claude's subagents | Merged | probe: a checked loop repairs within its bound and the lead hears how it ended; subagents shown as steps |
| 11 Recovery, installed acceptance | Merged; acceptance run on main | probe recovery 3/3: a moved chat resumes with its memory; a restart between a send and its repeat is one turn; a restart in a checked loop leaves one run |

## The acceptance projects (on merged main, the browser build)

- **A plain folder's summary** (`/tmp/ll-acceptance/Field Report`: two notes and a CSV): Claude wrote
  summary.md with every statement naming its file, totals by region and in all that match the CSV
  exactly (North 350 / $12,300 … all 1,230 / $44,200), noticed North didn't lead as the notes
  expected, made summary.html and served it; the Browser view showed it live on the workspace's port.
- **LeadingLight builds a feature in itself** (an isolated clone of main, `/tmp/ll-acceptance/LeadingLight`):
  the lead added "Copy page link" to a page's ··· menu (5 files, +24 −11, the scenario in
  features/pages.feature), exercised it in its browser (that browser refuses clipboard writes, so it
  recorded what would be copied: the same @mention the sidebar's Copy link makes, byte for byte), and
  handed a review to a Codex worker, whose answer came back to it by itself: a real gap (an untitled
  essay copies "@Untitled" where the sidebar copies "@Essay") and a scenario setup nit. Left
  uncommitted in the clone. The first reviewer it started never reported back, which is how runtime
  ll.23 came about.

## Runtime pin

Shipyard `12d35552d515` (MIT), Go 1.27.3, 29 patches in `runtime/shipyard/patches`, version
0.3.30-ll.24. Its license and notices are vendor/shipyard's, checked equal at build time; tmux 3.6a
with libevent and utf8proc, built from pinned sources, their licenses in `runtime/tmux/licenses`.

## Open gaps carried forward

- A chat whose session was removed outside the app (the API's DELETE) shows only "Send a message to
  pick this chat up again" until then; the runtime reads a conversation's record only through a session.
- After a relink to a moved folder, a chat resumes in the new place (runtime ll.21); one still
  running at the time is stopped by the relink and picks up there on its next message.
- Workers started by an earlier runtime (before ll.24) still show in the chat menu: only newer
  conversations say which agent started them.
- With its session gone, a turn's file view has no Change (the runtime reads a call's detail through
  a session), and the composer shows the mode the chat list last read.
- A file deleted by a shell command (rm) isn't seen as deleted, and a file written by one isn't listed
  under its turn; only the agents' own writes and Codex's deletes are.
- An agent's browser refuses clipboard writes, so an agent can't check a real copy there.
- In the browser build the GPT models are this Mac's Codex's once project chats are on (the dev
  server asks it); otherwise the stand-in's, which the Ask regression spec expects.
- An earlier agent's probes (03:14–03:35, under `/tmp/ll-p1-*` and four `/tmp/ll-probe-*`) left
  idle tmux servers on their own private sockets, not in the person's `berth` server. Not ours to
  stop; reported.
- Each probe run leaves the providers' own records of its sessions (`~/.claude/projects`,
  `~/.codex/sessions`), which show in their resume lists; the probe doesn't delete them.
- Build is arm64 only.
- With BERTH_EMBEDDED=1 set, upstream's TestEmittedEventsReachTheStream and
  TestAPermissionRequestIsKeptOnTheWaitAndNeverPublished fail by design (embedded drops hook
  events), and TestRepoHooksRunOnlyForTheirRepoInTheWorktree depends on the port base;
  TestAttachPassesShiftEnter fails on unpatched source too, and TestReviewRoutesOverTheWire fails
  about one run in three on its temp folder's cleanup, with or without our patches.
- The runtime's workspace addresses (BERTH_URL) name port 1377, routed by its own browser proxy to
  the workspace's port; the Browser view shows the path and that port. Services() doesn't credit a
  plain folder's ports to it yet. Images don't preview in a turn's file view.
