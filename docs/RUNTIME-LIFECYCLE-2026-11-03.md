# Runtime lifecycle follow-up — 2026-11-03

Patch `0038-runtime-lifecycle.patch` applies after the 36 existing patches
to Shipyard `a6ee436af12210c00aca4a40f8f69955afd18fc1`.

`TestReviewRoutesOverTheWire` could remove its temporary repository while
review setup was still running. Repetition reproduced the cleanup failure
3 times in 30 runs, and 3 times in 15 runs with Go's race detector. Each
failed directory contained a newly recreated `box/ports.json`.

The final writer was service discovery: setup's callback started another
goroutine, allowing `worktree.setup.finished` to arrive before autostart
discovery and startup completed. Setup already runs in the background, so
the callback now performs that work directly. Review creation and first-open
setup use the same helper. HTTP requests still return asynchronously;
service failures still publish their existing `service.failed` events.

The route test waits for setup completion and verifies the setup script's
output. A regression test checks that `service.started` precedes
`worktree.setup.finished`. Restoring the original callback through a Go
overlay makes that regression fail in all three repetitions.

The team setup test also leaked its event collector: cancelling a bus
subscription does not close its channel, so a goroutine ranging over that
channel never exited. A removable synchronous observer now records events,
and the assertion waits for `team.done` instead of sleeping.

Validation after the fix:

- Review route, setup ordering, and team setup: 10 repetitions each,
  30 passes in 112.298 seconds.
- The same three tests with `-race`: 10 repetitions each, 30 passes in
  64.746 seconds, with no reported data races.
- Related review, setup, first-open, and service tests: 16 passes in
  56.131 seconds.
- Final ordering regression after explicitly selecting `/bin/sh` for its
  fixture: three passes in 1.746 seconds.
- Source `git diff --check` and reverse patch application check passed.

The earlier package timeouts do not establish a hung Git operation. At the
three-minute deadline, the submodule removal test had run for only seven
seconds; at six minutes, the team setup test had run for only three seconds.
Both tests passed five repetitions each in 103.145 seconds together. Full
package runs need a deadline covering the entire suite.

Validation uses the pinned Go 1.27.3 toolchain, a fresh temporary `HOME`,
temporary test and tmux directories, a dedicated `BERTH_TMUX_SOCKET`, and
the existing Go module/build caches. Each tmux fixture further isolates its
server. No existing server, application state, or vendor UI is modified.
