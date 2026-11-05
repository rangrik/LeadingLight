# Calendar validation — 2026-11-03

Implementation is on `codex/google-calendar`, isolated from other worktrees. In Safari, the
existing production OAuth client was verified, the calendar callback was registered, and
`CALENDAR_TOKEN_KEY` was saved as a production-only Vercel secret. No client secret was
rotated or copied into this repository. After explicit approval, Google Calendar API was enabled
and both calendar scopes were saved. Google showed “Enabled” and “Data access changes saved!”
in Safari. The production build applied the additive migration and was promoted to
`https://leadinglight-web.vercel.app` after verifying no newer production release was displaced.
No other worktree or branch was changed.
Final deployment: `dpl_3R692pqSoQkJdWsS7siqrdSbBoKr`. The previous production release
was `dpl_G88moY7Yk2kFz6kdrny86xSRYRdU` (October 29).

Live Safari verification on November 3, 2026, around 6:05–6:08 PM Pacific:

- Connected the owner's Google account; two subscribed calendars loaded.
- Created `LeadingLight integration test 2026-11-03` for November 4, 9:00–9:05 AM Pacific,
  without guests or reminders. Google Calendar independently showed the event.
- Changed its title to `LeadingLight calendar test - edited`, its time to 9:10–9:15 AM,
  and its notes. A Google Calendar reload showed the new title and time; reopening it in
  LeadingLight showed the saved notes.
- Deleted that event through LeadingLight. Both agendas showed it absent after refresh.
  The Google account remains connected; no test event remains on the calendar.

The live check also caught raw repeat/reminder values in the selected controls and a generic
save notice after deletion. The final version shows readable choice labels and a deletion notice.
All 12 browser checks passed again after the fixes, and independent QA verified the labels,
save-state controls and delete notice. Safari then reloaded the final deployment, retained
both calendars, and showed the corrected labels. The separate development app was rebuilt.

Checks passed: workspace typecheck, 45 desktop unit tests, 15 cloud tests, two native
credential-route tests, six calendar scenarios in Chromium and six in WebKit, the note-editor
smoke, and the docs build. The isolated test servers were stopped afterward.

Automated checks use real local PostgreSQL and simulated Google responses. They validate
workspace isolation, state/PKCE handling, refresh, pagination, read-only refusal, ETags,
all-day dates and recurrence limits, and safe retries including changed drafts.
Browser QA covers the visible agenda, edits/deletes, conflicts, visibility, focus, narrow
screens, stale data, sign-out and agent access. The separate live grant is recorded above.

The requested Sonnet QA attempt failed because the local Claude OAuth session expired.
An available independent QA agent completed browser review instead. Berth was not installed
on the host; QA used headless Playwright on port 1437, not the native window.

The long-note probe used 2,000 paragraphs and 20 real keypresses. Keydown to editor transaction
was 5.1–9.6 ms. Keydown to the next animation frame was 10.4–22 ms; that includes frame
scheduling and does not establish a 16 ms total rendering budget.

## Native checks still requiring manual verification

1. Open the merged **LeadingLight** from Applications and open **Calendar**. Expect the
   calendar view in your existing workspace. Use disposable events for the checks below;
   the development app was removed during closeout.
2. Open **Calendar → Connect Google Calendar**. Expect the system browser, Google's account
   picker and calendar consent. Approve a disposable personal test account, return to the app,
   and press **Refresh**. Expect its calendar names and events.
3. Add a second disposable work account. Expect both accounts in **Calendars**, including
   writable and read-only shared calendars. Organization restrictions should appear as an
   explicit refusal rather than a successful connection.
4. Create a guest-free test event, edit it and delete it. Check Google Calendar after each
   step. Expect matching title/time changes and deletion. Repeat with an all-day event and
   one occurrence of a bounded weekly series.
5. Open a test event in LeadingLight, change it in Google, then save the older app form.
   Expect a conflict and the newer Google event to remain intact.
6. Ask a note agent to schedule a disposable event. Expect approval in Ask mode, a real
   Google write after approval, and no write in Plan mode. Repeat with Claude and Codex
   when their local CLI sessions are signed in.
7. Disconnect one account. Expect the other account's calendars to remain and the disconnected
   account's Google events to remain untouched. Sign out of LeadingLight; expect event data
   and open drafts to disappear.

The native window and real local agent sessions have not been driven or manually verified.
Google consent is now In production and cloud access is public. Google approval remains
pending; see GOOGLE-VERIFICATION.md for the review record. Calendar
reminders are Google's; LeadingLight does not yet have an offline calendar or notification daemon.

## Public deployment, November 4, 2026

Deployment `dpl_9CTknrEiwdDZdH9RmwzAzLP1P3qs` serves the public homepage, privacy policy and
Search Console ownership file. Anonymous `/api/config` reports allowed/ready/calendar, while
anonymous `/api/calendar/accounts` still returns 401. Public access keeps workspace isolation.

Safari reconnected the Google account and created `LeadingLight verification demo` at
9:00–9:25 AM Pacific, changed its title and end time to 9:26, then confirmed deletion.
No guests or reminders were added. The account remains connected; the test event is gone.

Independent public-page QA found no login dependency or broken internal links, and no
overflow at 390px. Report: `/tmp/ll-calendar-public-docs-qa-report.md`.

## Domain migration, November 5, 2026

Deployed `dpl_Em3JAyCZf8urY9E6mPBfRxCBGAHd` to leadinglight.app and the retained Vercel address.
Public config/homepage/privacy checks pass; www redirects to the apex with path/query preserved.
Google and GitHub callbacks were saved for the new domain. Live Safari cutover tests passed.

Validation: workspace typecheck and production build passed; 6 migration UI checks passed
against the production build in Chromium/WebKit; 12 calendar regression checks passed.
Native-account fixture checks were skipped without CLOUD_QA; no native window was driven.
Cloud unit run passed 5 checks, with 11 database integration cases skipped without the test DB.
The new legacy-host test verifies same-host writes and rejects unrelated hosts and cross-origin writes.

Independent QA checked all six stores, inline attachments, history, emergency recovery,
account ownership, credential exclusion, spoofed origin/window/code, occupied destinations,
write rollback and terminal timeouts in both engines. It also checked WebKit legacy notes and
mobile layouts. Two defects were fixed and rechecked: pre-IndexedDB notes and late delivery
after timeout. Evidence: `apps/desktop/qa/.results-independent-copy/REPORT.md`.


Live Safari copied 63 notes to the new domain, retaining the original workspace. The first
attempt hit an unnecessary 100 MB validation limit before any destination write. Removing
that whole-snapshot serialization also avoided an extra large memory allocation. Independent
WebKit QA then copied 117,443,517 bytes with exact SHA-256 equality after both origins reloaded;
malformed input, localStorage quota and IndexedDB abort checks still refused or rolled back.
The production-build migration suite passed all six Chromium/WebKit checks again.
Large-library evidence: `apps/desktop/qa/.results-independent-copy/LARGE-COPY-REPORT.md`.

Live Safari on the new domain, November 5 around 1:39–1:43 PM Pacific:

- Google workspace sign-in and calendar reconnection succeeded using the same owner.
- Two subscribed calendars loaded, including the read-only Holidays in India calendar.
- Created `LeadingLight domain verification test` for November 6, 9:00–9:25 AM Pacific,
  with no guests, no reminders and no recurrence. Google readback showed the saved event.
- Changed the title to `LeadingLight domain verification — edited` and the end to 9:26 AM;
  the refreshed agenda showed both changes.
- Confirmed deletion. The app reported `Deleted from Google Calendar.` and the day was empty.
  The Google account remains connected. No test event remains.

After Google verified and published branding, another Safari reconnect at about 1:51 PM
showed the LeadingLight name/logo and https://leadinglight.app/help/privacy-policy.html in
Google consent, then returned successfully. The sensitive calendar-scope warning remains
until that separate review is approved. Old Google origin/callback URLs were removed and
re-read; only the new domain's origin and two callbacks remain.

This new-domain run did not separately open Google Calendar's external event UI; it checked
Google responses through LeadingLight. Earlier November 3 tests did independently verify
Google Calendar. Native app/agent manual checks above remain unperformed; this deployment
does not claim they passed. The merged installed app now uses the new origin; the old development app was removed.

## Submission and merge validation, November 5, 2026

Google received the sensitive-scope submission at approximately 22:25 UTC. The Unlisted
4K demo is https://www.youtube.com/watch?v=Pqjj8axkWJM. Verification Center reports data access
under review; approval and the post-approval consent check remain pending.

Main through `1f04275` was merged into this branch, preserving the other agents' changes.
All 34 calendar, browser-copy, device-approval and editor checks passed in Chromium/WebKit
on the combined code. All 48 desktop unit tests, workspace typecheck, production and docs
builds passed. Cloud tests pass 16/16 with a fresh isolated PostgreSQL database. Their command
now runs shared-database fixtures sequentially to avoid concurrent schema-creation races.
Initial cold browser runs hit 30-second limits under host load; the complete final run used
90-second test limits and passed without skips. The browser device tests do not drive the
native app or validate real CLI sessions.

Independent QA passed 11 Claude/Codex approval, account-change, plan and cancellation cases,
plus 21 browser-copy protocol probes. It found a narrow split-pane table overlap, fixed with
pane-size queries and checked in both engines at narrow and wide sizes. Durable reports and
screenshots are in the verification artifact folder's `postmerge-qa/` and
`migration-independent-qa/` directories. The final primary suite ran after the last main merge.

The user's merge/cleanup authorization covers this closeout. The installed app was still
running during verification, so installation waited for the user to quit it normally.
Native manual checks above remain unperformed. The old development app is no longer the
build to test; use the merged installed LeadingLight after installation completes.

Final web release `dpl_DTBy4QFXqdoJWSF9hPZ2dMvtzYaM` was promoted after confirming production
still pointed to this task's previous release. It includes the narrow-pane fix and main through
`1f04275`. Safari reload fetched both connected calendars at 2:48 PM Pacific. Canonical/legacy
config and public homepage/privacy requests passed; anonymous calendar accounts returned 401.
Own test servers and isolated PostgreSQL were stopped. LeadingLight Dev 98634f and its data
were removed. Other worktrees and servers were not stopped or changed.

The user confirmed quitting LeadingLight. The release Mac bundle was built from main,
installed at `/Applications/LeadingLight.app`, and verified with `codesign --verify --deep
--strict`; the installed binary exactly matches the prepared SHA-256 recorded in the durable
`mac-installation.json`. Both Rust native credential tests passed. Main's final additional
`5451a4f` merge changed only an unrelated test expectation; application code remained identical.
The agent did not open or drive the native window. The branch's checkout is ready to archive;
Google review monitoring now uses the surviving main checkout.
