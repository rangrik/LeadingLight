# Shared sidebar prototype review

Final result: passed

The selected Arc direction is implemented as a browser-only prototype using the
existing COSS sidebar and real editor. Notes and Browser share one sidebar; modes do
not replace open panes. Recents are removed. There is one available sidebar toggle.

## Visual evidence

Source visual truth:
`/Users/pranavkanade/.codex/generated_images/01a1e86f-48e2-7db1-817c-0c6026303823/exec-c88f8645-878e-4e5b-9db8-a06ef6f4efdf.png`.

Implementation screenshots are generated under `apps/desktop/qa/report/`:

- `sidebar-prototype-clean-notes.png`: Notes, Trip to Kyoto, sidebar open.
- `sidebar-prototype-clean-split-light.png`: Browser sidebar, note and guide side by side.
- `sidebar-prototype-clean-split-dark.png`: the same split with system dark appearance.
- `sidebar-prototype-clean-narrow.png`: 900 × 800, horizontally scrollable split.
- `sidebar-prototype-comparison.png`: full source and implementation side by side.
- `sidebar-prototype-sidebar-comparison.png`: sidebar crops at original density.

Source and desktop capture are both 1487 × 1058 pixels. Browser viewport is
1487 × 1058 CSS pixels at DPR 1. The full comparison scales both to 744 × 529;
the focused comparison keeps 1:1 pixels, cropping source width 330 and implementation
width 272. It exposes the intentionally denser COSS rows and icon sizes.

## Findings and fixes

| Severity | Earlier finding | Fix and post-fix evidence |
|---|---|---|
| P1 | Three sidebar toggles competed across sidebar and panes. | Sidebar owns the toggle while open; first pane owns it while hidden. Hidden sidebar is inert. Recorded toggle/resize scenario verifies exactly one available control. |
| P1 | Title and editor had duplicate React keys after the autofocus change, leaving stale titles on navigation. | Distinct keys. Creation and note-switching scenarios pass; clean capture and long-note probe have no console errors. |
| P2 | Editor table of contents escaped a split pane. | Hide its floating rail in this prototype. Clean split screenshots show contained note content. |
| P2 | Mode choices stacked; an incorrect radio composition emitted a Base UI warning. | Use the existing horizontal SegmentedControl/RadioPrimitive pattern. Focused comparison shows both modes on one line; warning is gone. |
| P2 | Divider moved several pixels away from the grab point. | Account for workspace padding and pointer offset. Recorded pointer and keyboard resize checks pass. |
| P2 | New page retained focus on the creation button. | Remount the title field per note and select Untitled. Creation scenario verifies title focus. |
| P2 | Serializing the full document on each edit slowed long notes. | Defer reads until typing pauses; flush pending edits before pane changes and pagehide. Reload with save timers paused passes. |
| P2 | Resetting the currently open note left its old editor content visible. | Reset remounts the workspace. The recorded reset scenario checks original text returns immediately. |
| P2 | Closing a browser tab could duplicate its visible neighbor. | Choose an unopened replacement and keep panes unique. A two-browser regression scenario passes. |
| P2 | Narrow panes trapped horizontal scrolling and could clip header controls after focus or resize. | Allow horizontal scroll chaining and reveal the focused pane on focus and workspace resize. The close control is fully in view at 900 px. |
| P2 | Wheel gestures missed the sidebar's delayed sheet mount. | Attach the listener to the actual mounted node. The 740 px sheet gesture regression passes. |
| P2 | App shortcuts could create a hidden note behind a dialog. | Consume workspace shortcuts while a dialog is open. Library checks retain the mode and create no Untitled note. |
| P3 | Sidebar tooltip displayed two backslashes. | Correct the literal to show one shortcut key. |

## Fidelity surfaces

- Typography: system font and real editor styles. COSS rows use 16 px Lucide icons;
  headings retain the source hierarchy. Split titles scale to 28 px below 600 px.
  Long row text truncates beside actions without shrinking them.
- Spacing: 272 px sidebar, 32 px rows, 8 px pane gap, 12 px pane radius. The mock's
  larger sidebar and row density are adapted to the existing desktop controls.
  Pin and Library hierarchy and the consolidated footer match the selected direction.
- Colors: existing semantic theme tokens, system light/dark, selected-row fill.
  No new hardcoded colors or decorative gradients.
- Assets: existing LeadingLight icon and Lucide controls remain sharp. This concept
  needs no photography or generated illustrations; no assets are approximated with CSS.
- Copy: realistic Kyoto notes and four local sample websites. Placeholder account
  actions explain simulation. Empty tabs, unmatched search and unknown addresses recover.

The footer mode control is the user's requested change to the mock. Native traffic
lights, account integrations and the production tool rail are outside this browser
prototype. Narrow split panes scroll horizontally with a 350 px minimum; automated
QA reaches the right pane's close button and restores the sidebar. These differences
are intentional, not claims of pixel-identical recreation.

## Checks and limits

Nine recorded Playwright scenarios pass, including actual Shift-click, wheel events,
keyboard shortcuts, editing, persistence, menus, resize and light/dark/narrow layouts.
Workspace typecheck, desktop build and docs build pass. Clean capture has no console
errors; reduced-motion emulation produces only the library's informational warning.

The 2,000-paragraph probe preserved typing and measured keydown to next animation
frame at median 14.9 ms, maximum 28.4 ms after deferring document reads. This does not
establish a 16 ms worst-case frame budget; the existing editor performance item in
`docs/DEFERRED.md` still applies. Physical trackpad feel and native webviews are not
claimed by the synthetic browser checks. No native window was driven.

Implementation checklist: complete for this isolated prototype. Native promotion
remains a separate decision after the interaction is tried.
