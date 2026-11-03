# Runtime reliability follow-up — 2026-11-03

This follows the [upstream refresh](UPSTREAM-2026-11-03.md), starting at
`6667250`. Three high-reasoning agents worked in separate reporting, lifecycle,
and portability worktrees. The integration worktree collected their commits
and independent reviews. Existing calendar, iPhone, agent-project, and
simple-agent-UX worktrees were left untouched.

The runtime remains pinned to Shipyard
`a6ee436af12210c00aca4a40f8f69955afd18fc1`, now with patches 0001–0043 and
version `v0.3.31-ll.30+5b47e8c8`.

## Fixed behavior

- Worktree setup finishes after service discovery and startup finish. Failures
  reach the setup result; the HTTP request still returns while setup runs.
- Service-manager commands honor cancellation and have bounded execution and
  pipe-drain times. Autostart has an overall deadline. Interrupted installs can
  be retried, including when a service definition already matches: a pending
  marker requires a successful load before the definition counts as installed.
  Per-unit locks coordinate concurrent installers, and rollback preserves prior
  definitions and unrelated edits, including permission-only changes. Definition
  reads reject symlinks and special files without blocking on a FIFO.
- Browser requests can cancel while queued for a tab, launch, viewport store,
  zoom, upload, inspection, developer command, or screencast operation. A blocked
  CDP write can cancel without preventing shutdown. A partially written command
  closes its transport so a later command cannot complete its JSON frame.
- Navigation remains tied to the HTTP request until its command has been sent;
  a sent navigation can continue after the request ends. Superseded queued
  navigation cannot execute later. Viewport changes cancelled while waiting for
  admission are not saved.
- Private browser startup waits for its unused initial tabs to disappear.
  Chromium's close acknowledgement can arrive before target destruction; the
  runtime now waits only for the selected startup targets and honors cancellation.
- CLI help and flag parsing agree: `--after` belongs to `developer-events` and
  is rejected by unrelated commands before they contact the runtime.

## Corrected tests and repeatable validation

The worker-report failure came from a fake caller that never announced readiness
and a test that never ran the inbox dispatcher. The replacement covers a busy
caller, delivery after it becomes idle, startup-queued delivery, and duplicate
finish events. The production report remains queued while the caller is busy.

The review-route cleanup race exposed real premature setup completion, now fixed.
The team-setup test also closes its event observer correctly. The Shift+Enter test
checks all ten emitted bytes without depending on BSD `od` spacing. See the
[lifecycle evidence](RUNTIME-LIFECYCLE-2026-11-03.md).

The vendored UI tests resolve the syntax-color module through the same adapter
the application uses. The loader redirects only that test's import; the adapter's
own upstream import is unchanged. Vendored source remains verbatim. All 628 UI
tests and 48 desktop tests pass, as do both affected TypeScript checks.

`pnpm runtime:test` prepares the exact pinned source and ordered patches with
the pinned Go toolchain. It isolates HOME, Git configuration, runtime state,
browser profiles, and tmux files. Short temporary paths preserve Unix-socket
coverage on macOS. Its process supervisor forwards cancellation, stops its own
remaining process group, and removes only marked, identity-checked directories.
It does not stop existing user daemons.

On macOS, a disposable test-only browser wrapper prevents Keychain prompts from
stalling isolated tests. Production browser flags and credential encryption are
unchanged. Both full Chromium and headless-shell probes pass; see the
[browser investigation](RUNTIME-TEST-BROWSER-2026-11-03.md).

## Validation and acceptance

Focused checks include 280 browser cancellation regressions with the race
detector, four real-Chromium browser checks, 170 final service-package race
checks, and 12 final service/setup race checks. Linux service cross-compilation
passes. Each exported patch was reapplied to its exact baseline and compared
byte for byte with the tested source. The
[CDP evidence](RUNTIME-CDP-CANCELLATION-2026-11-03.md) records the negative probes
and operation coverage.

The unchanged startup-tab browser test passes ten consecutive runs and three
race runs. The new delayed-close regressions fail against the original code and
pass twenty race repetitions after the fix. Independent review verifies that
private and later unrelated blank tabs are retained, and that cancellation and
protocol errors propagate.

The complete ordered patch set passes `pnpm runtime:test -json ./...`: 1,628
tests and subtests pass, with zero failures, across all 51 test-bearing packages.
Five packages contain no tests. The box package finishes in 316.113 seconds.
Thirty opt-in or helper tests are skipped; the original three failures and the
real Chromium browser tests all run and pass. The test supervisor exits cleanly
and removes its isolated state. The final run explicitly selects Playwright's
Chromium headless shell.

Evidence is retained under
`apps/desktop/qa/report/runtime-fixes-2026-11-03/`, including the full Go JSON
stream, focused regression logs, and the build/install verification log.

The suite's opt-in live-provider, PostgreSQL, real-systemd, and native computer-use
checks need their external fixtures; isolated tests do not establish signed-in
native acceptance. Existing unrelated deferred items remain in
[DEFERRED.md](DEFERRED.md).
