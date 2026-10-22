# QA

Two layers, both against the browser build at `http://127.0.0.1:1420`. Pages live in
IndexedDB there; to start clean run `indexedDB.deleteDatabase("leadinglight")`, then reload.

- Scenario QA: a subagent drives the worktree's Berth browser (`berthd browser … --tab qa`,
  visible live in Shipyard), following `features/*.feature`, and writes `qa/report/REPORT.md`.
  The Berth proxy reaches the dev server over IPv4, so start it with
  `pnpm exec vite --port 1420 --strictPort --host 127.0.0.1`. The browser has no "type"
  command: fill the Title input, and insert editor text with
  `eval 'document.execCommand("insertText", false, "# ")'` in pieces so shortcuts fire.
- Playwright, headless Chromium, for the smoke, the gallery and regression specs:

```sh
pnpm qa            # smoke and seam specs
pnpm qa:gallery    # screenshots of the main states into qa/report/
```

Conventions:

- Never drive the native Tauri window.
- Scenarios come from `features/*.feature`; report them by scenario name.
- Locate by role and accessible name (see the names listed at the top of each feature file).
- After clicking into the editor, wait ~50 ms before typing or pressing keys. The editor
  reads the new caret position on the next task; a human can't type faster than that.
- Dialogs and the sidebar animate for 200 ms. Wait for the animation before a screenshot.
- `berthd browser eval` reads a first argument containing "/" as a location; write `\x2f` in the JS instead.
- Synthetic drag events skip the browser's own drag start, so they can't show that a drag
  starts. `qa/editor.spec.ts` drags with Playwright's real mouse; trust it for that part.
- A media block selected between two other media blocks loses its selection on the next harness
  input. That's Chromium plus DevTools input, not the app (see `docs/DEFERRED.md`); don't report it.
- In dev the editor instance is on `window.__editor` for reading state (`__editor.state`, `__editor.getJSON()`).
- Screenshots for a report go to `qa/report/` (ignored by git).
