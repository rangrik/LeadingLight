# QA report — M1.5 (blocks, selection, polish) and the COSS rebuild

Run by the QA subagent (Sonnet 5.5, xhigh) in the worktree's Berth browser, browser build,
1280x800. Screenshots referenced below are in this folder.

**95 scenarios: 90 PASS, 4 FAIL, 1 NOT RUN.** pages 14/14 and shell 8/9 were run against the
previous sidebar and are re-run after the switch to the official sidebar-08 block files.

| Feature | Pass | Fail | Not run |
|---|---|---|---|
| pages | 14 | 0 | 0 |
| shell | 8 | 0 | 1 (dark mode following the system can't be driven) |
| editor | 28 | 0 | 0 |
| selection | 8 | 0 | 0 |
| blocks | 16 | 4 | 0 |
| polish | 16 | 0 | 0 |

## Findings and what happened to them

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | `/columns` inserted a table (keyword "columns" on Table ranked first) | major | Fixed: name matches rank before keyword matches |
| F2 | Columns: caret started in column 2; empty columns invisible | major | Fixed: caret in column 1; empty columns outlined |
| F3 | Clicking a file card opened nothing (`url` was undefined) | major | Fixed |
| F4 | "a. " / "i. " right under a numbered list joined it | minor | Fixed: only same-style lists join |
| F5 | Dropping a file mid-paragraph split the paragraph | minor | Fixed: files go before or after the block, by which half was hit |
| F6 | Browser build: a large image exceeds localStorage and stops autosave | major (browser only) | Fixed in round 3: the browser store is IndexedDB, one record per page |
| F7 | File toolbar covered the size label | cosmetic | Fixed: file and audio toolbars float above the card |
| F8 | Block drop side follows the pointer's x inside the text, not its y | minor | Fixed in round 3: blocks drop by height alone, shown by one line |
| F9 | Link and embed fields rejected bad input silently; selection vanished while typing a link | minor | Fixed: fields show invalid; selection stays highlighted |
| F10 | `/todo` found nothing | minor | Fixed |
| F11 | Typing with a block selected replaced its text | minor | Fixed: typing does nothing |
| F12 | Spec drift (slash order, toolbar order, Add block "/") | spec | Specs updated |

## Design review: what changed

- Emoji prefix centred on its line (was 5.6 px low and made the line 35.6 px tall): now 0.00 px, line unchanged.
- Toggle: lucide chevron-right at 16 px, centred on the title line (0.00 px); content starts at the title text.
- One 24 px inset for list, to-do, quote and toggle text (was 16 / 26 / 26 px).
- Code controls centred on the first line (−0.54 px), 16 px chevron; code, image, video and embed use the COSS radius.
- Table toolbar text buttons are 28 px like the icon buttons.
- Slash menu: distinct icons for alphabetical, roman and toggle.
- A selected image is outlined with its toolbar inside its top-right corner, no tint past the image.

Still open from the review: native audio and video controls (not COSS), and floating toolbars
covering the title when the first block is selected. Both fixed in round 3: a player built
from COSS parts, and toolbars that flip below when there is no room above.

## Round 2 — official sidebar-08 files and the fixes above

Partial: the browser dev server hit its time limit mid-run. **32 run, 32 PASS, 0 FAIL.**
pages 14/14, shell 8/9 (dark mode following the system can't be driven), the seven fixed
blocks scenarios 7/7, and three of the four fixed editor scenarios. Not reached: the link
scenario, the three selection re-runs, polish.feature, and the every-kind regression sweep.

Notes from round 2, all fixed: the collapsed sidebar stayed reachable by Tab (now inert);
the empty-column outline was too faint (now muted-foreground at 40%); empty lines inside
columns, toggles, lists and cells showed no placeholder (now they do). Left as is: the embed
placeholder keeps its selected tint while its URL field has focus; in the browser build the
file card opens a data: URL, which Chromium may block (the app opens real files). Both fixed
in round 3: no tint while a field inside has focus, and files open as blob: URLs.

## Round 3 — everyday situations, the new player and drop line, round-2 leftovers

**39 run, 37 PASS, 2 FAIL.** everyday 10/10, editor 3/4, blocks 4/4, polish 11/12, selection 9/9.
Screenshots are `r3-*`. Shortcuts, drags and pastes were sent as synthetic events, because the
Berth browser can't press key chords or drag.

| # | Finding | Severity | Status |
|---|---|---|---|
| R3-1 | Block and file drags showed our line plus ProseMirror's drop cursor | major | Fixed: ours stops the other for those drags; any dragend clears the line |
| R3-2 | Selected image tinted full width, no outline (selector missed the node element) | minor | Fixed |
| R3-3 | Embed placeholder kept its tint while its field had focus (same cause) | minor | Fixed |
| R3-4 | Selection toolbar hid under the header on a scrolled page | major | Fixed: toolbars flip inside the visible scroll area too |
| R3-5 | Video toolbar covered the title | minor | Fixed: toolbars stay inside their block |
| R3-6 | Audio toolbar covered the video's controls above | minor | Fixed: audio actions end its controls row |
| R3-7 | Empty line above a selected block showed its placeholder | cosmetic | Fixed: no placeholders without a text cursor |
| R3-8 | Escape in the link field dropped focus to the page body | minor | Fixed |
| R3-9 | Block handle drew over the selection toolbar | cosmetic | Fixed |
| R3-10 | Handle sat at the top of file and audio cards, not on their row | cosmetic | Fixed |
| R3-11 | Spreadsheet paste (HTML + text + PNG) kept only the picture | minor | Fixed: HTML with text wins |
| R3-12 | Emoji-picker or dictation text replaced selected blocks | minor | Fixed: blocked at beforeinput |
| R3-13 | BlockNote tables lost their cell text | minor | Fixed; old video, audio and file blocks map too |

Also fixed from the design notes: the tint now leaves 4 px before the handle (was 2), the
player clock shows hours, full screen keeps our controls, the to-do checkbox has no focus
ring. A page with blocks this version can't read used to open empty and editable; it now
opens read-only with a notice. ⌘Q in the app used to skip the last 500 ms of edits; it now
saves first (native only, not testable here).

Made-up situations that passed as they were: copy, cut and paste of selected blocks; undo after
a drag; deleting a page right after typing (it stays gone); ⌘A then Backspace; rich HTML
paste; long words and URLs; the 800x480 minimum window; Tab everywhere; a 3000-line paste;
corrupt stored pages. Typing in a 2000-paragraph page: slowest handler 11 ms, at the limit.

## Round 4 — re-check of round 3

**43 run, 39 PASS, 4 FAIL, 1 NOT RUN** (⌘Q is native only). 13 of the 15 re-checks passed.
Screenshots are `r4-*`.

| # | Finding | Severity | Status |
|---|---|---|---|
| R4-1 | Read-only page: the handle's "Add block" still edited it, and autosave overwrote the stored page | major | Fixed: such a page is never saved from the editor; no handle, drop line or media controls |
| R4-2 | File card actions were a bordered pill poking out of the card | minor | Fixed: flat buttons |
| R4-3 | Placeholder stayed on a line after the cursor left it (TipTap 3.32 nested mode) | minor | Fixed: our own placeholder, only on the cursor's empty line |
| R4-4 | Selecting an audio card grew it by 10 px | minor | Fixed: flat buttons, no growth |
| R4-5 | First keystroke on a 2000-paragraph page took 20 ms | minor | Now 14 ms handling in headless; the rest 3–7 ms |
| R4-6 | Slider moved as the time readout grew | cosmetic | Fixed: the readout keeps its widest width |
| R4-7 | Full screen had no way out but Esc | cosmetic | Fixed: the button toggles |
| R4-8 | Read-only page: uneven gaps, readable blocks hidden | cosmetic | Fixed: 12 px gaps, known blocks shown |
| R4-9 | Long file name re-truncated on select | cosmetic | Fixed: the card's end is always reserved |
| R4-10 | Clicking a video to select it also played it; media tint vs image outline | cosmetic | Fixed: click selects; all media outlined |

## Round 5 — re-check of round 4

7 of 9 re-checks passed; every scenario run passed except the read-only one. Stored data stayed
byte-identical through every attempt to change a read-only page. Keystrokes on 2000 paragraphs:
first 13–13.5 ms, the rest 8–11 ms. Screenshots are `r5-*`.

| # | Finding | Severity | Status |
|---|---|---|---|
| R5-1 | Read-only page: emoji picker, code language, embed field and Choose file still changed the screen (never saved) | minor | Fixed: all locked or hidden |
| R5-2 | Video toolbar floated over the picture in full screen | minor | Fixed |
| R5-3 | Player icons muted, card actions full colour | cosmetic | Fixed: one colour |
| R5-4 | File card edge differed from the player's | cosmetic | Fixed: the player uses the outline button's edge |
| R5-5 | Audio actions take room from the slider when selected | cosmetic | By design: the card keeps its size |

## Round 6 — re-check of round 5

**5 of 5 PASS.** Read-only pages can't be changed on screen by any means tried, and the stored
record's SHA-256 matched before and after. Card edges match pixel for pixel in light and dark.
Screenshots are `r6-*`.

| # | Finding | Severity | Status |
|---|---|---|---|
| R6-1 | Read-only emoji still showed its hover fill and pointer | cosmetic | Fixed |
| R6-2 | The title of a read-only page can be renamed | design | Kept: it can't lose the body |
| R6-3 | A portrait video ran taller than the window; a broken file showed a black box | cosmetic | Fixed: videos cap at 70vh; missing files show a row that says so, with Choose file |

## Round 7 — missing media files, tall video, read-only emoji

**All PASS.** Missing image, video and audio files show a row matching an empty placeholder
(46 px, same padding, icon, text and button) with Choose file, which brings the media back.
Tall video caps at 70% of the window; full screen still fills it. Screenshots are `r7-*`.

| # | Finding | Severity | Status |
|---|---|---|---|
| R7-1 | Read-only missing-file rows were 42 px, not 46 | cosmetic | Fixed: the button is hidden, not removed |
| R7-2 | Read-only emoji was still a focusable "Change emoji" button | accessibility | Fixed: plain text there |
| R7-3 | A media block between two media blocks lost its selection after the harness's blur and focus | low | Deferred: Chromium with DevTools input only; the Mac app (WebKit) keeps the selection. See `docs/DEFERRED.md` |

## Round 8 — blank-space clicks, Meta+A, spacing, plain new lines (user-reported)

**All scenarios PASS** (editor 4/4, selection 10/10, polish 12/12); stopped early on request.
Screenshots are `r8-*`. Found in extra situations, all fixed for round 9:

| # | Finding | Severity | Status |
|---|---|---|---|
| R8-1 | A blank click above or beside the title added a line before the first block | minor | Fixed: those go to the title; the title-to-body gap goes to the body's start |
| R8-2 | Meta+A's tint broke into stripes at headings, quotes, dividers and media | minor | Fixed: all block spacing is padding; media tint inside a run |
| R8-3 | A side-margin click beside a to-do, toggle, table or group landed in the next block | minor | Fixed: it finds the line at that height |
| R8-4 | Gaps between block kinds ranged from 8 to 17 px | cosmetic | Fixed: visible edges 10 px apart; dividers 15 |
| R8-5 | With the link field open, a blank click added a line and lost the selection | minor | Fixed: focus in the editor's toolbars counts as active |
| R8-6 | On a read-only page a blank click held focus on the title | cosmetic | Fixed: the click is only cancelled when it acts |

Also from the user in this round: block drags never started with a real mouse (the handle
cancelled mousedown) and Tauri swallowed all drags on macOS (`dragDropEnabled`); list items
weren't blocks; the panel header wasted space above the window buttons. All changed for round 9.

## Round 9 — real drags, list items as blocks, one spacing rhythm

**60 run, 58 PASS, 2 FAIL.** editor 28/29, selection 10/10, polish 11/12, shell 9/9. Every
visible edge is 10 px from the next block's across 361 kind pairs (dividers 15); Meta+A tints one
unbroken shape on 41 blocks; handles sit at 0.00 px on every kind and list depth. Screenshots
are `r9-*`.

| # | Finding | Severity | Status |
|---|---|---|---|
| R9-1 | A blank click left the link field open | minor | Fixed: leaving the toolbar closes it |
| R9-2 | 15 px below an open toggle | minor | Fixed |
| R9-3 | A list inside a quote broke the rhythm by 2 px | cosmetic | Fixed |
| R9-4 | The empty-columns outline touched its neighbours | minor | Fixed |
| R9-5 | Margin clicks beside a table or columns went to the second cell | minor | Fixed: first cell from the left, last from the right |
| R9-6 | A bullet item dropped on a numbered list turned numbered | minor | Fixed: items join only lists of their kind |
| R9-7 | Items inside columns, groups, toggles and quotes had no handle of their own | minor | Fixed |
| R9-8 | Shift+Arrow past a list's end jumped two steps | cosmetic | Fixed: the whole list first |
| R9-9 | Escape twice on an item with children left the cursor in a child | cosmetic | Fixed |
| R9-10 | Plain-text copy of items had blank lines | cosmetic | Fixed: one line per line of text |
| R9-11 | A drop line showed where the drop does nothing | cosmetic | Fixed |
| R9-12 | A read-only page's title takes clicks | by design | Kept (R6-2) |

## Round 10 — re-check of round 9

**All 11 re-checks PASS.** Meta+A one shape on every kind; handles 0.00 px on 21 top-level
blocks and 17 list items; read-only body unchanged. Screenshots are `r10-*`.

| # | Finding | Severity | Status |
|---|---|---|---|
| R10-1 | In side-by-side columns, hovering an item in column 1 targeted column 2's item | major | Fixed: inside columns the columns block keeps the handle (per-item there is deferred) |
| R10-2 | A column-2 item's handle covered column 1's text | minor | Gone with R10-1 |
| R10-3 | In a quote, the list lost its marker indent and the handle sat on the bar | minor | Fixed: indent kept; container items' handles sit in the gutter |
| R10-4 | Margin clicks in a block's padding landed on the wrong line or cell | minor | Fixed: find the line under the pointer, clamp into its text |
| R10-5 | Two lists in a quote were 12 px apart | cosmetic | Fixed |
| R10-6 | The empty-column outline sat 0.6 px off the rhythm | cosmetic | Replaced: an "Empty column" hint, no outline |
| R10-7 | Typing into an empty column shifted text and blocks | cosmetic | Fixed: the hint changes no layout |
| R10-8 | Dropping an item at its own list's edge split the list | cosmetic | Fixed: no line, no change |
| R10-9 | After deleting a quote's only item the cursor landed one character in | cosmetic | Fixed |
| R10-10 | Shift+Arrow from a list in a container selects the container | low | By design, spec reworded |

## Round 11 — re-check of round 10

**14 of 15 PASS.** Columns keep one handle; quote lists keep their indent with handles clear of
the bar; empty columns show a hint and nothing moves when typing; list-edge drops change
nothing; 1,018 real margin clicks swept. Screenshots are `r11-*`.

| # | Finding | Severity | Status |
|---|---|---|---|
| R11-1 | A right-margin click beside a code block's first line went to the code's start | minor | Fixed: the line is found from its start and walked to its end; hidden code controls ignore the pointer. Verified by a real-click sweep (Playwright, headless): every band lands on the line at that height, both sides, for paragraph, wrapped paragraph, heading, to-dos, code and tables |
| R11-2 | The 1 px row at a block join went to the block below | cosmetic | Fixed: lines are taken from the block beside the click only |
