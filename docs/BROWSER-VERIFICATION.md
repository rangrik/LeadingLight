# Shared browser verification

2026-10-28 · `codex/shared-browser`

The browser opens from the sidebar or beside a project chat. Personal tabs keep
their sign-ins in a workspace profile. Ask about page shares that exact tab with
one conversation; element feedback includes the selected element and the person's
comment. Website content remains untrusted.

Research and the parity matrix are in `BROWSER-RESEARCH.md`. Significant choices
are recorded in decision 31 in `DECISIONS.md`; remaining gaps are in `DEFERRED.md`.

## Automated checks

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Desktop unit tests | 30 passed |
| Full headless app suite | 118 passed in the final clean run (6.6 minutes) |
| Browser UI regressions | 15 passed, including startup races, shared-chat context, permissions, element feedback and two panes sharing a tab |
| Packaged agent browser probe | All five checks passed using the installed app's runtime `v0.3.30-ll.26+9cfe1f46` |
| Packaged-runtime UI smoke | Passed with real Chromium: input, navigation, dialogs, upload, exact download bytes, popups, feedback, viewport modes and profile clearing |
| Go race and real Chromium suite | Passed; all 31 runtime patches replay cleanly |
| Native download helper harness | 19 passed, including 33 MiB, partial writes, cancellation and malformed chunks |
| Surface input and lifecycle | Passed at DPR 1/2: coordinates, text/IME, clipboard, drag, stale frames, reconnect, hidden panes and viewport changes |
| Shared viewport controller | Passed: ownership, fixed modes, queued requests, delayed frames, failure recovery and later agent resizes |
| Independent Sonnet 5.5 QA | Earlier navigation, permission and layout failures resolved; all three feedback rechecks passed on the final runtime |
| Long note | 2,000 paragraphs, 165 keys; every editor transaction under 16 ms, p95 2.8–3.0 ms |
| Production frontend build | Passed |
| Isolated macOS app build | Built and installed as `LeadingLight Dev a60fb8`; native UI checks remain manual |

The runtime checks cover profile persistence and clearing, agent cookie isolation,
slow navigation, Stop, popups, Command/middle-click tabs, permission boundaries, dialogs, chooser identity, upload
cleanup, download bytes, scoped element handles and exact style reset. Inspector
tests include zoom, scroll, removed elements, hostile page helpers and navigation.
Feedback keeps the selected element visible after resizing, permits scrolling in
the picker, and restores the exact original style attribute when safe.
Agent cookie isolation covers both named and legacy unnamed tabs.

Four existing QA fixtures were corrected: an exact Settings heading, the intended
split-page editor, long-page seeding without moving the selection, and waiting for
the block menu to return focus before sending Undo. No product
behavior was changed to satisfy those fixtures.

Independent Sonnet 5.5 QA uses the browser build and records screenshots under
`apps/desktop/qa/report/sonnet-browser/`. Native windows are never automated.

## Native checks for the isolated development app

Use **LeadingLight Dev a60fb8**, which has its own data. These checks remain manual
because a headless Chromium test cannot prove WebKit's OS menu and file-dialog behavior.

1. Open Browser and visit a site with a text field. Click the page's field and try
   typing, Select All, Copy, Cut, Paste, Undo and Redo through the macOS Edit menu
   and their shortcuts. The page should change once per action. Click a note and
   verify the same menu actions edit the note again.
2. Use **Browser menu → Save screenshot**, then **Downloads → Save…** for a
   completed download. Cancel one save, then choose a destination. Only the chosen
   file should be written, and it should open correctly.
3. Sign in to a site you choose, quit and reopen the dev app, and restore its tab.
   The sign-in should remain. **Clear browsing data** should explain what it removes;
   Cancel should preserve everything, and confirming should sign out this workspace
   while retaining bookmarks and downloaded files.

The current implementation does not provide audio/device prompts, a native page
accessibility tree, frame/area annotations, a full developer inspector, extension
attachment or cloud browsing. It should not be described as exact proprietary
Browser parity.
