# Runtime CDP cancellation — 2026-11-03

Patch `0041-cdp-cancellation.patch` applies after patches 0001–0040 to
Shipyard `a6ee436af12210c00aca4a40f8f69955afd18fc1`. It extends command
cancellation through transport writes and the other browser operation gates.

The original CDP transport held its pending-reply mutex while writing to
Chromium. A full pipe kept both the command and connection close blocked
past cancellation, and prevented replies from other tabs being delivered.
An OS-pipe probe reproduced this three times with the race detector.

The transport now serializes writes separately, admits writers with their
contexts, and uses the pipe's write deadline to interrupt an active write.
It removes abandoned reply entries. A zero-byte cancelled write leaves the
connection reusable; a partially written frame closes it so those bytes
cannot become a command later. Deadline callbacks complete before the next
writer starts, preventing an old cancellation from interrupting a new call.
Reply delivery and connection shutdown no longer wait behind a pipe write.

The same context-aware gate protects zoom, upload, inspection, screencast,
developer commands, browser launch, tab opening, and viewport persistence.
The existing ordering between these operations is retained. A cancelled
resize cannot change its saved preference while waiting for admission.
Ordinary browser, tab, developer, and reply-map state locks remain mutexes;
background cleanup still waits for its operation gate to preserve ordering.

Navigation uses the HTTP request's context until the complete command is
sent. Its reply can then continue after that request ends, preserving slow
navigation and Stop behavior. Superseding a navigation synchronously cancels
its pending send. A failed send clears loading state only while it still
owns the current navigation sequence.

Evidence and validation:

- Restoring the original operation gates made all 25 endpoint/admission
  cases fail their deadlines. The cancelled resize also reached Chromium
  or changed its saved viewport on the original paths.
- Restoring the original navigation handler while retaining the fixed
  transport made both blocked-write and cross-tab-queue navigation tests
  fail. Neither returned within one second of a 30 ms deadline.
- The final transport, admission, resize, zoom, navigation, and existing
  per-tab queue regressions passed 20 repetitions with `-race` in 57.594 s.
  They cover OS-pipe saturation, partial frames, shutdown, concurrent reply
  delivery, repeated cancellation/recovery, command ordering, and retained
  navigation ownership.
- Real Chromium controls, developer commands, inspection, and slow
  navigation passed in 23.862 s after the final navigation change.
- A broader browser selection passed 52 tests and exposed one independent
  startup-target ordering failure in
  `TestBrowserUnnamedAgentKeepsPersonalDataSeparate`. That failure is being
  handled separately in patch 0043; this patch does not change target
  discovery or weaken that assertion.
- The exported patch applied cleanly to a fresh first-40-patch baseline;
  all 15 changed files matched the tested source byte for byte. The focused
  regression set passed again from that clean application in 2.953 s.
  `git diff --check` passed.

Prepared source: `/tmp/ll-runtime-cdp-20261103/source`. Evidence logs and
the clean reapplication are under `/tmp/ll-runtime-cdp-20261103`.

Checks use Go 1.27.3 with dedicated HOME, temporary, and tmux namespaces.
Real-browser checks explicitly select the Playwright Chromium headless
shell; full Chrome under an isolated HOME can wait on macOS Keychain.
Production browser flags, application state, and vendor UI are unchanged.
