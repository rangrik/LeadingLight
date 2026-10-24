# Project 1: where it stands

The plan is [PROJECT-1.md](PROJECT-1.md). One row per slice. Merged means on main with its checks
run again there; the rest are on the agents-project-1 branch, built and checked in the browser
build, and wait for the native check of slice 2 (the runtime inside the Mac app) before they merge.

| Slice | State | Evidence |
|---|---|---|
| 0a Pin, ownership, structured-session probe | Built, QA'd | `pnpm runtime:build` (reproducible, checksummed), `pnpm runtime:probe` 9/9 on 2026-10-24 against Claude Code 2.1.310 and Codex 0.164.0; independent QA 9/9, its findings fixed; DECISIONS 18 |
| 0b Browser probe, plain-folder extension | Merged | `pnpm runtime:probe browser`: an agent in a non-Git folder drives its page through the runtime's browser, an observer sees that tab's frames, the folder is left as it was; DECISIONS 18; probe 12/12 again on main |
| 1 Link a local folder | Built, QA'd twice | features/external-projects.feature; folder identity by device and inode, moves found again, aliases refused |
| 2 The runtime in the app | Built, QA'd; native check pending | bundled berthd and tmux (built from pinned source), own process group, backup before replacing a build; features/project-runtime.feature |
| 3 Claude project chat | Built, QA'd twice | features/project-chat.feature: exact folder, streaming, stop, approvals, resume, named outputs |
| 4a Requests named and answered once | Built, QA'd | runtime ledger with generations and receipts; `pnpm runtime:probe requests`; seam tests in requests.test.ts |
| 4b Question and approval cards | Built, QA'd twice | features/agent-interactions.feature, with a real Claude session |
| 5a Codex in project chats | Built, QA'd | features/project-chat.feature (Codex), agent-interactions.feature (Codex); probe codex 6/6 |
| 5b Model, effort, files, skills, MCP | Built, QA'd | model and effort reach both providers mid-chat; attachments kept out of the folder; "/" lists the agent's skills; a configured MCP tool ran; settings untouched |
| 6 GitHub checkout, own branch | Built, QA'd | clone with this Mac's Git sign-in (a private repo too), stop cleans up, existing checkout reused with its changes kept; worktrees in the runtime's state |
| 7 Outputs kept as each turn left them | Built, QA'd | probe: Claude's and Codex's written files kept, unchanged by later edits; Then, Now and Change views |
| 8a Watching the agent's browser | Built; QA running | Browser view: live frames, path and workspace port, tabs, console read without using up the agent's |
| 8b Public pages, a tab per agent, a lost browser | Built; QA running | probe: two agents, two tabs, two cookies; Allow for a refused site; the view says when the browser closed |
| 9a Workers | Built; QA running | probe: a lead hands a task to a Codex worker from its instructions alone and hears back; one worker however often launched |
| 9b Worker cards | Built; QA running | features/agent-coordination.feature: rows per worker with live state, outcome, Stop and Open |
| 10 Checked loops, Claude's subagents | Built; QA running | probe: a checked loop repairs within its bound and the lead hears how it ended; subagents shown as steps |
| 11 Recovery, installed acceptance | Recovery built and probed; acceptance waits for merged main | probe recovery 3/3: a moved chat resumes with its memory; a restart between a send and its repeat is one turn; a restart in a checked loop leaves one run |

## Runtime pin

Shipyard `12d35552d515` (MIT), Go 1.27.3, 24 patches in `runtime/shipyard/patches`, version
0.3.30-ll.22. Its license and notices are vendor/shipyard's, checked equal at build time; tmux 3.6a
with libevent and utf8proc, built from pinned sources, their licenses in `runtime/tmux/licenses`.

## Open gaps carried forward

- A chat whose session was removed outside the app (the API's DELETE) shows only "Send a message to
  pick this chat up again" until then; the runtime reads a conversation's record only through a session.
- After a relink to a moved folder, an older chat resumes in the new place (runtime ll.21); one
  still running at the time keeps working in the old path until it is stopped.
- With its session gone, a turn's file view has no Change (the runtime reads a call's detail through
  a session), and the composer shows the mode the chat list last read.
- A file deleted by a shell command (rm) isn't seen as deleted; only Codex's own deletes are.
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
