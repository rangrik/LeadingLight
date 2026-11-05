# Installed-app validation — 2026-11-05

The UI smoke pass built and installed `/Applications/LeadingLight.app` from source `2872106`, with runtime `v0.3.31-ll.33+248ea384` (signed build `b604de31dbd8`), exercised the native shell, and used three high-reasoning agents in separate worktrees. Vercel AI Gateway remained disabled throughout. Concurrent calendar and mobile/agent work was preserved.

## Fixes found during validation

- Retain previously installed runtime binaries so existing agent processes and their tmux clients continue to find their executable paths.
- Keep sidebar navigation visible when a narrow second pane is active.
- Wrap task status and controls at narrow pane widths, including Large interface text.
- Forward the Enter carriage return to browser pages. Return and keypad Enter activate buttons and insert textarea newlines.
- Read saved conversation transcripts after a session stops, without resuming an agent. The existing parser bounds large records and retains cursor/history paging. Runtime patch 0048 advances the bundle to `v0.3.31-ll.33+248ea384`.

The isolated PostgreSQL fixture now fixes `LC_ALL=C`, avoiding macOS locale discovery starting threads before PostgreSQL forks.

The QA fixtures now declare desktop capability for native downloads, locate the Authorship dialog specifically, preserve authorship metadata when converting tasks, and target paragraph ends without brittle screenshot coordinates. Gallery screenshots disable animations. The cloud Safari selection includes large snapshots and guard checks. A development-only Lucide bundle group reduces request fan-out during test startup.

## Automated checks

| Group | Result |
| --- | --- |
| Browser matrix | 199 Chromium, 34 Safari, 4 iPad WebKit, and 1 gallery passed; 15 gallery images reviewed |
| Cloud fixture matrix | 30 applicable Chromium/WebKit checks passed; 12 PostgreSQL-backed service checks passed |
| Unit/native agent | 751 checks passed: desktop 48, themes 24, shared/vendor 628, credentials/release 16, services 5, Rust 24, task layout 4, adjacent headers 2 |
| Isolated native backend | 7 smoke checks passed |
| Capture fixture | Chromium and WebKit passed blank-draft, clear-after-save, immediate-hide, and repeated-show behavior |
| Browser Enter regression | Before-fix button activation failed; two focused Chromium tests passed after the fix, with independent WebKit verification of button/keypad/newline behavior |
| Saved-chat regression | 10 Chromium/WebKit cases passed; focused Go cases cover Claude/Codex/ACP, records over 44 MB, cursor/history paging, invalid IDs and unchanged files with no session manager |
| Default live integrations on runtime ll.33 | Codex, Claude, ACP/OpenCode and agent-browser all passed; Gateway excluded |
| Full fixture-enabled runtime on ll.33 | 1,458 top-level tests / 1,664 including subtests passed, zero failures; all 51 test-bearing packages passed |
| TypeScript and packaging | Workspace/desktop typechecks and release builds passed |

Counts are reported by suite, not summed: some focused and cloud checks overlap. The 22 cloud-gated browser entries and 10 database-gated service entries were covered by the separately provisioned cloud runs. Two production-only cloud gates were covered by the browser production/offline pass. Cold parallel runs exceeded harness test limits under host load; the accepted serial runs retained normal assertion deadlines and allowed longer overall test setup.

## Installed macOS app

Verified startup, About source stamp, runtime health, signatures and exact installed-bundle match; all ten Settings sections; existing Claude and Codex sign-ins; note creation/editing, save, close/reopen, full relaunch persistence and history preview; audio file import/playback and local speech transcription; capture-panel save; linked disposable folder; real Claude and Codex UI turns reading the expected local file marker; Feed, Captures and Suggestions; narrow task status; browser navigation, text input, Return activation, Back/Forward and download export.

The installed app also refreshed both existing Google calendars without writing an event. The concurrent calendar task's combined-code browser/service checks are documented separately in `CALENDAR-VALIDATION.md`.

The native browser's unrelated-localhost refusal was expected. The fixture was served on its assigned workspace port without changing allowlists. Native Return on the rebuilt app visibly changed the fixture to “Button pressed 1.” Both live providers returned `NATIVE_SMOKE_OK_20261105`; no model request was sent into an existing user's chat. The download UI reported Completed, 46 B, and an export path. Shell readback of Downloads was denied by macOS; byte equality is not claimed.

## Preservation and cleanup

The original notes database was compared read-only against the pre-test backup: zero pre-existing object rows changed or disappeared. The two named test pages were removed through the UI, the disposable folder unlinked, and only the two explicitly identified test chat sessions stopped. A newly edited user capture was preserved. All four pre-existing runtime binary hashes remained unchanged. The temporary browser tab and its fixture history were removed. The 46-byte test download may remain in Downloads because macOS denied cleanup access.

The final installed app displayed the existing 44,135,336-byte chat record as a bounded 18,833-byte response (71 items). Both the metadata and record hashes remained unchanged; the runtime still had zero sessions after the read. The About stamp and browser Return behavior were checked again in this same installed artifact. Later changes are the isolated PostgreSQL fixture locale and this validation record.

The full runtime runner exited 0 and removed its isolated PostgreSQL, browser, homes and build directory. Its seven skips are the subprocess helper entry, four live checks passed separately, the Linux-only systemd check previously verified in `RUNTIME-VALIDATION-2026-11-05.md`, and the user-excluded Gateway check. No Gateway result is counted as passing.

All four task-owned worktrees and branches were merged and removed. Other agents' worktrees were left untouched. The installed app remains open on the original task and its restored chat.

Evidence is retained locally under `apps/desktop/qa/report/app-smoke-2026-11-05/`, including browser/cloud reports, before/after layout images, native evidence, focused Enter reproduction and build logs. Private database/configuration backups are not included in that report.
