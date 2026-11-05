# Full runtime validation — 2026-11-05

This reruns the fixture-enabled runtime suite, the default live integrations,
and the separate Linux systemd fixture after the
[Claude fix and Vercel opt-out](RUNTIME-LIVE-CHECKS-2026-11-05.md).
Independent worktrees kept the existing calendar, iPhone, agent-project,
and simple-agent-UX work untouched.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm runtime:test:fixtures -json ./...
pnpm runtime:test:providers
pnpm runtime:test:systemd
node --test scripts/project-runtime/provider-credentials.test.mjs
```

The runs used the existing pinned toolchain/source cache through
`LL_RUNTIME_CACHE`. The full suite and default live command resolved their own
Playwright browser without a browser override. Default live selection and
`all --list` both selected only Codex, Claude, ACP and browser. No Vercel model
request, credential setup, or billing operation was performed.

## Pairing fixture fix

The first complete fixture run produced 1,657 passing tests/subtests and one
failure: `TestUseThisMacEndToEnd`. Pairing succeeded, then the first box-info
request received HTTP 502 with an HTTP/2 GOAWAY.

The fake service omitted `PATH` from its rendered service environment. The
runtime's normal service maintenance consequently identified it as a legacy
installation and restarted its daemon during the request. A controlled
four-second delay reproduced the maintenance message and changed daemon PID
before the fix. With the service PATH supplied, the same daemon survived the
delay and the original API, reconnect and uninstall assertions passed.

Patch `0047-localbox-service-fixture-path.patch` supplies the fixture PATH using
`service.ComposePATH`. It changes only `internal/agent/localbox_e2e_test.go`;
no production runtime logic or test acceptance assertion changed. All eight
focused pairing, app-update and legacy-service-maintenance tests passed.

The Shipyard commit remains `a6ee436af12210c00aca4a40f8f69955afd18fc1`.
The source patch set is `v0.3.31-ll.32+13287943`. Because this is a test-only
change, the installed application was not rebuilt or restarted.

## Live and Linux results

The exact default live-provider command exited 0:

| Check | Test time | Result |
| --- | ---: | --- |
| Codex | 14.04 s | Passed |
| Claude | 14.91 s | Passed |
| ACP / OpenCode | 18.46 s | Passed |
| agent-browser | 7.36 s | Passed |

The real Linux systemd scope test passed, including cgroup membership, memory
accounting and limits, detached-child cleanup, and scope shutdown. Its uniquely
named VM was deleted and OrbStack returned to its empty baseline. All 15
credential-discovery tests passed with zero skips.

These checks ran on `b17fe74`. The subsequent fix touches only the local-pairing
E2E fixture; provider, Linux and production runtime code are identical.

## Full rerun and skip accounting

The full rerun with patch 0047 exited **0**: **1,658 tests/subtests passed,
zero failed**, across all **51 test-bearing packages**. Five packages have no
tests. The box package completed in 384.173 seconds. The local-pairing test
passed in 5.58 seconds. Fixture cleanup completed without errors.

Seven entries are intentionally separate from the full local suite: the four
live integrations above, the Linux-only systemd test, the subprocess helper
that its passing parent invokes, and the user-excluded Vercel Gateway test.
The Vercel test is excluded by choice, not counted as passed. Among the original
30 skipped entries, 28 have passing checks, one helper is covered by its parent,
and one Gateway check is excluded.

Evidence is retained under
`apps/desktop/qa/report/runtime-full-verification-2026-11-05/`: complete initial
and accepted Go JSON streams, the failure reproduction, focused checks, live
provider results, Linux results and the updated coverage ledger.
