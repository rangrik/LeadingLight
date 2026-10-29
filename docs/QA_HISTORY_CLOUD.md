# History, authorship and cloud web QA — 2026-10-28

## Browser-to-Mac pairing — 2026-10-29

Decision 33 adds an encrypted page-agent relay while preserving the local CLI
runtime. This section describes the current pairing work; the older sections
below retain evidence from earlier implementations.

- All seven PostgreSQL relay tests pass: account isolation, claim/approval,
  concurrent starts, deduplication, quotas, expiry, cancellation, revocation and
  clearing acknowledged ciphertext without losing retry fingerprints.
- Browser integration reaches the actual relay with a simulated Mac endpoint.
  Chromium and WebKit pass code creation, Mac approval, encrypted status/start,
  note approval, exactly-once edit, follow-up and confirmed Stop.
- Browser fixtures exercise Claude and Codex protocols, partial transcript
  preservation, offline drafts, explicit takeover and changing accounts while
  an encrypted reply is in flight. The final combined run passes 26 scenarios,
  including 12 existing Ask checks and seven pairing checks in both engines.
  A further two real-relay checks confirm that an encrypted stopped event is
  sufficient even if its separate cancellation receipt is lost.
- Browser crypto checks non-extractable keys and ciphertext binding to every
  routing field. Rust checks include a Node-generated AES-GCM interoperability
  fixture, protocol restrictions, durable start records, lease/revoke decisions
  and isolated process-group cancellation. All 17 Rust tests pass, including
  cancellation while a fake child's stdin pipe is full and clock changes/sleep.
- Workspace typecheck and frontend production build pass. Build output retains
  the existing bundle-size warnings. No hosted model execution or model keys.

Independent Sonnet 5.5/xhigh QA found and verified fixes for late tools after Stop,
account changes during pending saves, refused starts disconnecting unnecessarily,
account-loading flashes, offline draft loss and device clock skew. Its final
targeted retests pass eight Stop/account cases and six reload/refusal/clock cases
across Chromium and WebKit. Both final iPad screenshots were inspected. Berth was
unavailable, so QA used headless Playwright. Normal acknowledged event payloads now
clear from the relay, and native queue accounting avoids repeated serialization.

Deployment `dpl_568QWhuyib8qg2t6hPMSkxLMrEWi` was promoted to
`https://leadinglight-web.vercel.app`. The additive relay schema migrated in
Vercel's production build environment. Seven public HTTP checks pass: home/config,
anonymous browser denial, a database-backed invalid claim, malformed polling,
browser-origin denial on native routes and the retired model worker. Config has
Google/GitHub and no hosted agents. The live Chromium Ask smoke also passes.

`LeadingLight Dev bc9e3f` is installed with its own bundle ID and data. Its bundle
signature verifies. Native acceptance is complete as described below; browser
fixtures alone were not treated as proof. No source commit has been made.

The user then explicitly requested automated native acceptance, overriding the
repository's manual-only rule. Computer use paired Safari with the installed dev
app through the production relay after the user approved the exact access grant.
Claude's real CLI appended an approved paragraph; history labeled the edit Claude
and retained the human baseline. Stop changed from Stopping to Stopped and the
observed Claude process exited. Quitting the dev app made Safari report Offline.
The first real Codex run exposed inherited MCP helpers and a disabled internal
tool dispatcher. Remote launch now disables each inherited MCP entry and notification
hook, verifies the same process's effective configuration, and retains the isolated
dispatcher for note tools. A separate rendering fix keeps item IDs and message phases,
so final replies stay visible outside folded activity. All 17 Rust tests pass;
independent Sonnet 5.5/xhigh retests pass four focused browser cases in both engines.
The browser fix is live in `dpl_2Vsw5ZxkLiA3mdTAj2jUxHx8zSTx` and the updated dev
app is installed. macOS prompted for Keychain access after its ad-hoc signature
changed; computer use cannot control SecurityAgent, and the user could not see its
prompt. The obsolete test grant was already revoked in the browser. Its local
metadata was moved to `retired-qa-relay` inside the dev app's data directory; the
protected Keychain item was left untouched. A fresh pairing with the same test
scope succeeded. Quitting and reopening the unchanged build restored that pairing
without a prompt, establishing ordinary restart persistence.

The final real Codex run used the installed CLI 0.165.0 and GPT-6.1-Sol. It requested
approval, appended the exact paragraph once, displayed `Done.` outside folded
activity, and recorded GPT/model attribution alongside the earlier Claude and human
versions. Its process tree contained Codex and its isolated code-mode host, with no
inherited MCP helpers. A resumed follow-up reached another note approval; revoking
the browser from the Mac dismissed that approval and terminated the observed Codex,
wrapper and dispatcher processes. The unapproved paragraph never appeared, and
Safari settled to the unpaired state. Both temporary grants are revoked. The
two test records were archived locally and the development app was quit normally;
protected Keychain items were not altered for cleanup. The disposable note remains
for review. No API keys were added or provider credentials
copied. Physical iPhone/iPad Safari remains a separate acceptance check.

## Original history and sync pass

Built against `features/history.feature`, `features/authorship.feature` and
`features/cloud-web.feature`. Browser QA used localhost 1431, production preview
1432, and PostgreSQL 17 in the isolated OrbStack Compose project
`leadinglight-cloud-qa`. Model responses and signed-in identities were fixtures.
This first round used no live model spending or native UI automation. Production
deployment checks are recorded below. The fixture cloud-generation and worker checks describe
the earlier implementation, retired by decision 32 on 2026-10-29; they are not current product features.

Independent QA used Claude CLI Sonnet 5.5 at xhigh in three rounds. Berth was
unavailable, so it drove headless Playwright instead. Its final review found three
remaining defects: the first replacement character inherited agent authorship,
a production CLI stand-in showed an update toast, and replacing a recovery key
could erase the working key. All three were fixed and their failed paths rerun.

| Scenario | Result |
|---|---|
| Autosave, milestones, preview, restore and retained history | Pass in Chromium and WebKit |
| Human insertion and selected-word replacement within agent text | Pass in both engines; every replacement character belongs to You |
| Whole-action undo, overlapping edits and human work between agent steps | Pass; rejected undo changes no page |
| Delete immediately after typing, then restore the deleted snapshot | Pass in both engines |
| Reload immediately after typing; legacy storage and unknown fields | Pass in both engines |
| Separate browser databases sync ciphertext and preserve offline conflicts | Pass in both engines |
| Wrong recovery key and server failure preserve the saved key | Pass in both engines |
| Large encrypted history uploads in parts and a following small page arrives | Pass; separate browser contexts and real PostgreSQL |
| Cloud result survives browser closure, rejects stale replacement, keeps an attributed new page | Pass in both engines with fixture providers |
| Account isolation, durable jobs, duplicate requests, provider failure and private access | Pass against PostgreSQL |
| Accepted model drafts do not load external media | Pass; independent QA exercised nine media vectors |
| Phone 390px and iPad 820px editor, history and account navigation | Pass in both engines; screenshots inspected |
| Production offline reload, editing, history and no fake CLI update toast | Pass in both engines |
| Native SQLite multi-page commit, stale-write rollback, delete and restore | Pass using an in-memory SQLite probe; native runtime not exercised |

Final checks: workspace typecheck and production build pass; 25 existing unit tests
pass; the PostgreSQL integration test passes. The final targeted browser runs cover
45 cases. One existing Markdown clipboard test failed once before the title was
ready, then passed three repeats; an explicit focus expectation was added and all
five editor scenarios passed again. The earlier broader editor/pages/links/tables/
Ask regression run passed 40 cases. Build output retains bundle-size warnings.

A 2,000-paragraph probe measured editor transaction dispatch at median 3.5 ms,
p95 4 ms and max 5.8 ms. Independent end-to-end key handling measured about 24 ms
with and without authorship; this does not establish a 16 ms total typing budget.

Screenshots are generated under `qa/report/`; failure traces use ignored
`qa/.results-*` directories.

## Vercel deployment checks — 2026-10-28

Historical checks: the queue worker and cron below were removed on 2026-10-29.
The current deployment serves accounts, encrypted sync and the encrypted Mac relay.

The app is live at `https://leadinglight-web.vercel.app`. Neon `leadinglight-web-db`
uses the free plan, production-only credentials and the `iad1` region. Its schema
was initialized inside Vercel's build environment because downloaded secrets are
redacted. The normal build command is restored after initialization.

- Chromium and WebKit each passed the offline editing/history test against the
  live production URL (2 tests).
- Home, manifest, cloud config and Auth.js CSRF return 200. Config reports ready,
  with Google and GitHub configured. No model keys were supplied.
- Anonymous sync, jobs, worker and queue-worker requests return 401.
- A real queue delivery reached the private Node worker in `iad1` and queried
  Neon. Final deployment `dpl_Af4eTWiGSkDVK3mcKuZEEtd56vnV` logged probe
  `eace60f2-45c3-4fdb-b6cb-46146287c6e9`; no model was called.
- Authenticated recovery returns 200 with zero stranded jobs. Vercel lists the
  daily `/api/worker` cron. Its scheduled run has not yet been observed.
- Two PostgreSQL integration cases pass, including queue failure after commit,
  retry deduplication, account isolation, active/expired leases and batch recovery.
- Independent Sonnet 5.5/xhigh queue review found unbounded retries and recovery
  processing only one task per day. Both are fixed and their paths retested.

Physical iPhone/iPad Safari and native account/attachment handoff remain unverified.
Paid model execution was never enabled and has since been removed. The private allowlist stays enabled.
See `apps/cloud/README.md`, decision 31 and `docs/DEFERRED.md` before inviting users.

## OAuth setup follow-up

GitHub's live authorization redirect requests only `read:user user:email`, uses
PKCE S256, and stores its verifier in a Secure, HttpOnly cookie. Both providers have
production-only secrets and exact callbacks. Google remains in testing mode with
the owner added as a test user. Safari completed both real consent/callback flows.
GitHub restored the correct account after reload, showed private sync access, and
stayed signed out after logout and reload. Google showed the correct account and
returned its provider-specific identity from a fresh `/api/me` request. Sync was
not enabled during account switching; no notes were uploaded by these checks.
Both owner identities are separately allowlisted. Production deployment
`dpl_HJNhty1Qrxq9mUXJ2BgrXt27gyFc` was Ready and owned the public alias at that check. After that
deployment, Google's session returned `allowed: true` from `/api/config` and an
empty job list from the authenticated database route. Model providers remain absent.

A discovered logout bug is fixed: HTTP failures, malformed replies and Auth.js
error redirects keep the account visible. The focused Chromium check covers 500,
MissingCSRF, success and reload. Independent Sonnet 5.5/xhigh QA repeated it with
one pass and no defects. Desktop typecheck and production build pass.

## Local agents correction — 2026-10-29

Decision 32 replaces the earlier hosted model implementation. Provider adapters,
queue execution, cron and browser task/outbox code are removed. The legacy jobs
schema remains untouched; no model API keys or usage billing are required.

- Workspace typecheck and production build pass.
- Backend: two tests pass, including real PostgreSQL encrypted sync and account
  isolation. Legacy jobs/workers reject requests with zero database/provider calls,
  even when both model-key environment variables are present.
- Browser: logout failure/retry, stale outbox refusal, large encrypted history,
  offline conflicts, recovery-key preservation and 390/820px layouts pass.
- Production Ask shows the installed-app explanation in an empty workspace;
  existing development Ask selection → answer → insert still passes.
- Native execution was not changed or driven. Browser-to-Mac transport and hosted
  user-authenticated CLI runners remain future work.
- Independent Sonnet 5.5/xhigh QA passed the outbox, account, offline and paid-route
  checks, including 672 route variants with no database/provider call. It found an
  inline selection prompt that discarded questions; all browser Ask entry points
  now gate before opening that prompt. Its manual recheck passed toolbar, keyboard
  and page-button flows. The automated partial-selection test also passes after
  correcting an AllSelection fixture that could not open the selection toolbar.
- Production deployment `dpl_3G4dF3WTDehv7Vowcm9GKrPik2v9` is Ready at
  `https://leadinglight-web.vercel.app`. The full Ask entry-point check passes on
  that URL. Google/GitHub remain configured; `agents` is empty, worker endpoints
  return 410, only the gateway function is deployed, and Vercel cron definitions
  are empty.
