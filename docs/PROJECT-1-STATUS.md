# Project 1: where it stands

The plan is [PROJECT-1.md](PROJECT-1.md). One row per slice, updated as each merges.

| Slice | State | Evidence |
|---|---|---|
| 0a Pin, ownership, structured-session probe | Built, QA'd | `pnpm runtime:build` (reproducible, checksummed), `pnpm runtime:probe` 9/9 on 2026-10-24 against Claude Code 2.1.310 and Codex 0.164.0; independent QA 9/9, its findings fixed; DECISIONS 18 |
| 0b Browser probe, plain-folder extension | Built, QA'd | `pnpm runtime:probe browser`: an agent in a non-Git folder drives its page through the runtime's browser, an observer sees that tab's frames, the folder is left as it was; DECISIONS 18 |

## Runtime pin

Shipyard `12d35552d515` (MIT), Go 1.27.3, patches in `runtime/shipyard/patches`. Its license and
notices are vendor/shipyard's, checked equal at build time.

## Open gaps carried forward

- A chat whose session was removed outside the app (the API's DELETE) shows only "Send a message to
  pick this chat up again" until then; the runtime reads a conversation's record only through a session.
- A started chat's model and effort are fixed: the runtime can't change them in a running session yet
  (slice 5b).
- After a relink to a moved folder, older chats can't resume: their conversations keep the old path
  (slice 11). The app checks the folder before each send; the runtime doesn't refuse a session in a
  missing location yet (next runtime bump).
- A question card hides the composer, so Stop is out of reach until it's answered.
- tmux is the person's Homebrew copy; the installed app must provision it (slice 2).
- An earlier agent's probes (03:14–03:35, under `/tmp/ll-p1-*` and four `/tmp/ll-probe-*`) left
  idle tmux servers on their own private sockets, not in the person's `berth` server. Not ours to
  stop; reported.
- Each probe run leaves the providers' own records of its sessions (`~/.claude/projects`,
  `~/.codex/sessions`), which show in their resume lists; the probe doesn't delete them.
- Build is arm64 only.
- With BERTH_EMBEDDED=1 set, upstream's TestEmittedEventsReachTheStream and
  TestAPermissionRequestIsKeptOnTheWaitAndNeverPublished fail by design (embedded drops hook
  events), and TestRepoHooksRunOnlyForTheirRepoInTheWorktree depends on the port base;
  TestAttachPassesShiftEnter fails on unpatched source too. All pass in a default environment.
- For slice 8a: the runtime's workspace addresses (BERTH_URL, the browser's base) use port 1377,
  which is the person's Shipyard app's proxy; only the runtime's own browser proxy should see
  them. Services() doesn't credit a plain folder's ports to it yet.
