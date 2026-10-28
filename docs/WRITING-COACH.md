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
While I write enables underlines that open the same review. Quiet mode also hides grammar
totals in the header. It does not silently rewrite, normalize tone, or expand sentences.

The review shows one suggestion, its original words and the proposed replacement. Why is
collapsed. Supported rules have a short authored lesson and two-choice practice; other rules
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
