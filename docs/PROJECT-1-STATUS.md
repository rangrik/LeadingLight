# Project 1: where it stands

The plan is [PROJECT-1.md](PROJECT-1.md). One row per slice, updated as each merges.

| Slice | State | Evidence |
|---|---|---|
| 0a Pin, ownership, structured-session probe | Built, QA'd | `pnpm runtime:build` (reproducible, checksummed), `pnpm runtime:probe` 9/9 on 2026-10-24 against Claude Code 2.1.310 and Codex 0.164.0; independent QA 9/9, its findings fixed; DECISIONS 18 |
| 0b Browser probe, plain-folder extension | Built | `pnpm runtime:probe browser`: an agent in a non-Git folder drives its page through the runtime's browser, an observer sees that tab's frames, the folder is left as it was; DECISIONS 18 |

## Runtime pin

Shipyard `12d35552d515` (MIT), Go 1.27.3, patches in `runtime/shipyard/patches`. Its license and
notices are vendor/shipyard's, checked equal at build time.

## Open gaps carried forward

- Answers and approvals are not yet keyed by request ID and lifecycle; a second click gets a 409,
  not its receipt; an approval answers the oldest pending request (slice 4a).
- tmux is the person's Homebrew copy; the installed app must provision it (slice 2).
- An earlier agent's probes (03:14–03:35, under `/tmp/ll-p1-*` and four `/tmp/ll-probe-*`) left
  idle tmux servers on their own private sockets, not in the person's `berth` server. Not ours to
  stop; reported.
- Each probe run leaves the providers' own records of its sessions (`~/.claude/projects`,
  `~/.codex/sessions`), which show in their resume lists; the probe doesn't delete them.
- Build is arm64 only.
