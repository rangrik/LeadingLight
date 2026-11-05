# Runtime fixtures — 2026-11-03

This follows the [runtime reliability fixes](RUNTIME-FIXES-2026-11-03.md),
starting at `d04f553`. Separate PostgreSQL, provider, browser/systemd, and
integration worktrees kept the existing calendar, iPhone, agent-project, and
simple-agent-UX work untouched.

The runtime pin remains Shipyard `a6ee436af12210c00aca4a40f8f69955afd18fc1`.
Patches 0001–0046 identify this baseline as `v0.3.31-ll.31+90e1f714`.

## Reproduce

```sh
pnpm runtime:test:fixtures -json ./...
pnpm runtime:test:providers
pnpm runtime:test:systemd
```

The first command prepares the pinned runtime, starts a private PostgreSQL
cluster, and enables the browser screenshot, local pairing, transcript sample,
and real-timing route checks. PostgreSQL's `initdb`, `postgres`, and `psql` must
be on PATH; `LL_RUNTIME_POSTGRES_BIN` can select their directory. It uses a
random password with SCRAM authentication, UTC, an ephemeral loopback port,
and a private Unix socket. It does not consume an existing database URL.
The host runner also requires `tmux`, `lsof`, and `ps` for its private sessions
and process cleanup; missing tools fail preflight instead of silently skipping.

The provider command runs actual integrations sequentially, copies only their
required credentials into private temporary directories, and removes test
history and configuration afterward. It reports `passed`, `failed`, or
`unavailable` for every selected provider and rejects unexpected skips.
Select a subset with `pnpm runtime:test:providers codex acp browser`.
Following the November 5 opt-out, the default and `all` select Codex, Claude,
ACP and browser only. The Vercel `turncheck` group requires explicit selection.
Add `--list` to inspect the selected checks without credentials or network calls.
Use `node scripts/project-runtime/test-providers.mjs --help` for credential and
model configuration. A missing credential produces exit code 2; a failed check
produces exit code 1. No sign-in or persistent provider setup is performed.

The systemd command requires OrbStack. It cross-compiles the pinned test binary,
creates a uniquely named isolated Ubuntu machine with a separate user, installs
its test dependencies, runs a real user-manager scope, and deletes that machine.
The two-minute test deadline and signal cleanup apply only to its own fixture.

Chromium is selected as described in the
[runtime browser notes](RUNTIME-TEST-BROWSER-2026-11-03.md). Use
`BERTH_CHROMIUM` to select an installed test browser. The live browser fixture
can install `agent-browser@0.41.2` into its temporary directory; it never installs
that package globally.
The default is Playwright's matching headless shell, located using its public
installation CLI. Both screenshot checks passed in 9.47 seconds with that shell;
full Chrome took 120.42 seconds for the first check in this environment.

## Accounting for the 30 original skips

| Group | Original checks | Result |
| --- | ---: | --- |
| PostgreSQL driver, wire proxy, box editor and dotenv discovery | 17 | Passed against a real private PostgreSQL 14.17 cluster |
| Screenshot comparison and per-side login | 2 | Passed with real headless Chromium and local fixture servers |
| Use this Mac pairing and API | 1 | Passed with real `berth`/`berthd`; its existing wrapper substitutes for launchd |
| Linux session scope | 1 | Passed with real systemd, cgroup accounting, memory high limit and detached-child cleanup |
| Codex, ACP/OpenCode, agent-browser lifecycle | 3 | Passed with the actual provider/browser CLIs |
| Integration installation, transcript sample, route failover timing | 3 | Passed after correcting fixture defects described below |
| Secret-exec subprocess helper | 1 | Exercised by its passing parent test; the standalone helper intentionally skips |
| Claude | 1 | Requires a usable Claude login or Anthropic API key |
| Live turn check | 1 | Requires a Vercel AI Gateway key and model |

Claude's actual live probe returned “Not logged in”. The gateway has a configured
model but no key. These two checks remain unverified; mocks do not replace them.
Codex uses its account's default model unless `BERTH_LIVE_CODEX_MODEL` is set.
ACP passed with OpenCode 1.18.21 and `opencode/big-pickle`.

A follow-up [credential audit](RUNTIME-CREDENTIALS-2026-11-04.md) found the
saved gateway key in its actual split storage location, corrected discovery,
and distinguished authentication failures from Vercel account verification.
It also checked the separate Claude Desktop credential store.

The secret helper is not an independent acceptance check: its parent starts a
copy of the test executable with the helper flag, and verifies the child's
resolved environment, missing-secret handling, and value-free report. Enabling
that flag globally would replace the entire test process with the helper's shell.

## Fixture defects fixed

- The integrations test replaced PATH with a fake Claude directory, hiding the
  real tmux needed by its server fixture. Its isolated PATH now also contains a
  link to the installed tmux; the person's agent tools remain outside that PATH.
- The transcript diagnostic sliced fixed character positions and misread
  `claude-host:path`. It now splits at the delimiter, validates supported sources,
  rejects empty conversations, and checks the second read's error. The default
  fixture is an existing anonymized recording shipped with the pinned source.
- The route timing diagnostic recreated its timeout on every one-second tick,
  so a stalled stream could evade its twenty-second deadline indefinitely.
  One timer now bounds the whole wait. The real-timing probe measured requests
  moving after about three seconds and streams after about eight seconds.
- The raw PostgreSQL protocol test now has read/write deadlines, preserving its
  portal, COPY, error-recovery, and deferred-constraint assertions.
- The dotenv privacy test now clears the two inherited test-database URLs from
  its own environment. Its existing assertions against leaked dotenv values
  remain intact; unrelated fixture URLs no longer trigger them.
- The route settings test waited only for SSH to become active, then asserted
  that both routes already had healthy latency measurements. It now waits for
  those measurements and asserts against the same snapshot. A controlled paired
  route stall reproduced the old failure five times; both normal and recovery
  scenarios passed twenty repetitions after the fix, with adjacent race checks.

Fixture lifecycle checks cover cancellation, startup failure, repeated cleanup,
and preserving neighboring resources. Runtime test tmux sockets stay beneath
the supervisor's own marked state so interrupted tests can clean up their servers.
Detached database helpers are identified by executable mappings within that same
owned directory, with process identity checked before signaling. A real timeout
probe and an integrated SIGTERM probe both stopped the owned helper while a
separate helper outside the test directory continued answering requests. This
cleanup needs a discoverable executable; it cannot identify one already unlinked.

## Combined validation

The complete default `pnpm runtime:test:fixtures -json ./...` run passes 1,658
tests and subtests, with zero failures, across all 51 test-bearing packages.
Five packages contain no tests. The box package finishes in 335.113 seconds.
The command resolves its own browser, provisions PostgreSQL, and exits cleanly
after fixture cleanup; no browser override is required.

Seven entries still skip in that local suite: the five explicitly separate live
provider checks, the Linux-only systemd check, and the subprocess helper. The
three available providers and real systemd check pass in their dedicated runs;
the helper runs through its passing parent. Across the original 30 entries,
27 checks pass and one helper is covered by its parent; only Claude and the live
gateway turn check remain unverified because credentials are absent.

ShellCheck, Node syntax checks, private-environment validation, and the fixture
cancellation/neighbor-preservation probes pass. Each source patch applies to the
exact pin. Evidence, including the full Go JSON stream, original failure probes,
provider results, and Linux fixture logs, is retained under
`apps/desktop/qa/report/runtime-fixtures-2026-11-03/`.

An initial OpenCode model-discovery command refreshed its disposable model cache
before HOME isolation. Provider authentication and configuration were unchanged;
all actual provider sessions used isolated state.
