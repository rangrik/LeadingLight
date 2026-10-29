# Writing coach

The goal is to make writing easier to finish, understand, and return to. A correction
is a choice, not a judgment. This is an accessibility-informed design to test with the
person using it, not a claim to treat ADHD or measure someone's ability.

## Moments that matter

- Catching a thought: stay quiet. Captures and transcripts do not need cleanup to be saved.
- Sending something soon: show one local correction with Apply and Keep this wording.
- Having energy to learn: Why opens one short rule and an example. Practice is optional.
- Returning after a break: saved tips make the last useful lesson easy to find.
- Writing across subjects: a personal dictionary keeps specialist words from recurring.
- Reading feels slow: opt-in local read-aloud repeats the visible text, with Stop always available.

## First version

Review writing lives in each editable page's Writing menu. When I ask is the default;
While I write enables underlines that open the same review. Select a passage first to
review only those words, or leave the cursor alone to review the page. Quiet mode hides
grammar totals and word counts do not start a grammar check. It does not silently rewrite,
normalize tone, or expand sentences.

The review shows one suggestion, its original words and the proposed replacement. Why is
collapsed. After Apply, the chosen change stays visible with Undo; Next suggestion moves
on when the person is ready. Why, saved tips, and practice still refer to that change.
Supported rules have a short authored lesson and two-choice practice; other rules
use Harper's explanation without inventing a lesson. Either answer explains the choice.

Saved tips contain generic examples, never a log of the person's mistakes. No grades, streaks,
deadlines, or claims of mastery. The person can remove tips and dictionary words. A learned
rule does not mean every future occurrence should be corrected automatically.

Harper runs locally. Apply preserves formatting and gets its own undo step. Stale results
cannot edit changed text. Code, mentions and attributed quotes are outside the review.
Listening uses a local English system voice only. Failure or pending work is explicit.

## What feedback should tell us

Can the person finish a thought without attending to the checker? Can they fix a slip without
reading a lesson? Does an explanation make sense on its first reading? Can they recognize the
pattern in their own next sentence? Do their words still sound like them? Evaluate those
with the person over time; a shrinking issue count alone does not answer them.

Grounding: [W3C cognitive accessibility guidance](https://www.w3.org/WAI/WCAG2/supplemental/)
on limiting interruptions, clear content, and helping people understand corrections.

## Integration — 2026-10-28

Checkpoint `a2bae4a` preserves the unfinished work. Merge `1db5039` brings main
`7d9582b` into `codex/capture-and-writing-coach`; main itself is unchanged.

Main's bar, pane tabs/history, Tail Suggestions, and Quick capture are the base.
The separate webpage dialog and sidebar capture entries stay removed. Webpage
saving and microphone capture use main's box; this branch adds review of the saved
transcript, not another capture flow. Width, caret breathing room, table controls,
highlighting, and selected text → typed page/project are already on main and kept.

Grammar review remains local and on request. Tail's block-reading and suggestions
stay independent; a grammar correction is an ordinary editor change, so Tail must
invalidate an offer whose quoted words no longer match. Native installation and
publishing are outside this integration, as requested.

### Verification

- Full browser suite on `127.0.0.1:1447`: 116 passed after the merge. A final focused
  run passed 16 checks, including the added tab, failure-recovery, and capture-snapshot
  scenarios; the voice agent also passed its report-link and source-tooltip checks. The raw logs and screenshots are in `apps/desktop/qa/report`.
- Desktop unit tests: 25 passed. Image-service tests: 3 passed. Release test: 1 passed.
- Typecheck and production frontend build pass. The broader vendored unit run has
  four upstream failures documented in DEFERRED; it is not claimed green.
- On 2,000 paragraphs, 30 real key presses in each mode took a median 2.95 ms
  (review) and 4.7 ms (inline) from keydown to document change; maxima 12.3 and
  12.5 ms, with none above 16 ms. This excludes paint. Initial grammar and word-class
  analysis took 20.6–26.2 seconds with other QA running; it is asynchronous, not instant.
- Local speech playback and native microphone/transcription still need a person in
  the Mac app. Browser tests use explicit audio/transcription stand-ins. No native
  app was installed or driven in this integration.

### Still to learn from use

The implementation includes four short authored lessons, optional practice, saved
tips, a personal dictionary, and local read-aloud when available. Other grammar
rules use the checker's explanation. Broader lessons and any claim of better writing
or confidence need user feedback; tests establish behavior, not learning outcomes.

Independent Sonnet QA exercised the three combined flows at 1280 and 520 pixels:
quiet review and saved tips, tabs/panes with selected-text conversion, and Quick
capture through original-transcript review to a project-linked task. Correcting
Tail's quoted sentence removes its old offer without a new model turn; typing new
words and finishing the block sends one fresh turn. Evidence:
`apps/desktop/qa/report/merge-independent.md`, `mi-run.log`, and `mi-shots/`.

The independent final runs passed 99 assertions with no page errors. One existing
CLI-update toast can cover the narrow review sheet temporarily; it is recorded in
DEFERRED with its screenshot. The remaining native checks above were not run.

## Passage review and a slower pace — 2026-10-28

The Writing menu keeps a text selection when it opens. Review checks its intersecting
paragraphs and offers only corrections fully inside the selection; a partly selected
word is excluded. Corrections move the range with their changed length. Neighboring
typing stays outside it, and deleting the passage never switches to a whole-page review.
Undo restores both the wording and the original range; a later edit hides that Undo.
It stays visible in the footer while a long lesson scrolls.

Apply holds the before/after words on screen. Next suggestion is an explicit choice.
The optional explanation, practice, saved tip, and local Listen remain about the change
just made. Later checker results do not replace a suggestion already on screen. A
repeated pointer click after Apply or Keep cannot choose a second action as the card
moves. Closing the sheet is always enough to return to writing. Quiet word counts
now skip Harper entirely, so a selected review does not check every other paragraph.

Verification: the new UI journeys and six engine checks pass on port 1447;
inline underlines and grammar totals still work. Typecheck and 25 desktop unit tests
pass. In the 2,000-paragraph probe, quiet counts settled in 1.72 seconds without grammar
work; inline counts and grammar settled in 17.40 seconds. Thirty actual key presses in
each mode took median 3.05/3.10 ms and max 8.6/7.5 ms from keydown to document change
(quiet/inline), with none above 16 ms. These timings exclude paint and ran alongside
browser QA. Evidence: `apps/desktop/qa/report/scope-performance.json`.

The first full suite passed 125 scenarios. Independent Sonnet QA then caught a late
result replacing the visible suggestion, Apply's second click hitting Listen, and
Keep's second click dismissing an unread suggestion. Those three paths now have
regressions that pass; repeated-click cases run at both 1280 and 520 px. The original report is retained at
`apps/desktop/qa/report/scope-independent/report.md`; it describes the state before
these fixes. The final independent recheck is recorded separately.

Final verification: `QA_PORT=1447 pnpm qa` passed all 128 scenarios after the fixes.
Typecheck, the production frontend build, and 25 desktop unit tests pass. Sonnet's
final independent recheck passed 26 checks at each width (52 total), with no page
errors: `apps/desktop/qa/report/scope-independent/recheck.md`. The original report
stays as evidence of the bugs found, not the final state. Raw final logs are in
`apps/desktop/qa/report/scope-verification/`.

Real system speech and native WebKit still need a person in the Mac app. Broader
authored lessons and learning outcomes still need feedback from use. That slice was held uncommitted until the user approved delivery below.

## Approved delivery — 2026-10-28

Committed as `74d56f0`, then merged main `b9a56a9` in `b69a5b9`. Main's shared
browser and idle-runtime Quit fix are retained. The only conflict was decision
numbering: browser stays 31 and writing review is 32.

The combined source passes typecheck, 30 desktop unit tests, eight Rust tests and
all 143 browser scenarios (8.9 minutes). Independent Sonnet QA passed 70 checks
across two-note writing review and voice capture to a project Task, at 1280 and
520 px. Audio/transcription and browser-runtime replies were explicit stand-ins;
these do not establish native behavior. The narrow Browser toolbar finding is in
DEFERRED. On 2,000 paragraphs, quiet/inline typing medians were 3.4/3.2 ms and
maxima 12.7/7.5 ms to document change, excluding paint; no sample exceeded 16 ms.

The user approved merging, building and installing from main, then testing native
parts personally. All earlier report paths in this document are retained beneath
`apps/desktop/qa/report/writing-coach-delivery-2026-10-28/` in the main checkout.
That folder also keeps the final build and install logs.

### Native checks

1. In a note, select “I ate a apple.” and choose Writing → Review writing. Apply
   should change only that passage, pause on its result, and Undo should restore it.
2. Open Why, then Listen. A local English voice should speak only on request;
   Stop and closing the review should stop it. Without a local voice, it says so.
3. Use ⌃⌥I, record a new voice note, and stop. Open it from Captures, play the saved
   audio, then use Review transcript to make a Task with a project. The task should
   contain the selected words and the source should retain its audio and transcript.

The capture shortcut belongs to whichever app copy started first; quit other dev
copies if they intercept it. Browser's separate native menu and file-dialog checks
are in `BROWSER-VERIFICATION.md`. No native window was automated.
