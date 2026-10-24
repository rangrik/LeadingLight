# Project 1: where it stands

The plan is [PROJECT-1.md](PROJECT-1.md). One row per slice, updated as each merges.

| Slice | State | Evidence |
|---|---|---|
| 0a Pin, ownership, structured-session probe | Built | `pnpm runtime:build` (reproducible, checksummed), `pnpm runtime:probe` 9/9 twice on 2026-10-24 against Claude Code 2.1.310 and Codex 0.164.0; DECISIONS 18 |

## Runtime pin

Shipyard `12d35552d515` (MIT), Go 1.27.3, patches in `runtime/shipyard/patches`. Its license and
notices are vendor/shipyard's, checked equal at build time.

## Open gaps carried forward

- Answers and approvals are not yet keyed by request ID and lifecycle; a second click gets a 409,
  not its receipt; an approval answers the oldest pending request (slice 4a).
- tmux is the person's Homebrew copy; the installed app must provision it (slice 2).
- An earlier probe's berthd (`/tmp/leadinglight-project1-toolchain`) left a `probe-claude`
  session in the person's own `berth` tmux server. Not ours to stop; reported.
