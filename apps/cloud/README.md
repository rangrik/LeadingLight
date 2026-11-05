# LeadingLight cloud

Optional accounts, encrypted journal transport and browser-to-Mac pairing. Notes keep working locally. Agents run in the installed Mac app through the user’s signed-in Claude Code or Codex CLI. An approved browser can control page-agent conversations through the encrypted relay; this service does not run models, accept model API keys or bill for usage. Public workspace sign-in is enabled; Google Calendar verification and device acceptance limits are tracked in `docs/DEFERRED.md`.

## Local development

1. Run `docker compose -p leadinglight-cloud-qa -f apps/cloud/compose.yaml up -d`.
2. Copy `.env.example` to `apps/cloud/.env`. Set a random `AUTH_SECRET` (32+ characters), OAuth client credentials, and `APP_ORIGIN=http://127.0.0.1:1431`.
3. Run `pnpm --filter @leadinglight/cloud migrate`, then `pnpm --filter @leadinglight/cloud dev`.
4. Run `pnpm --filter @leadinglight/desktop dev --port 1431`. Vite forwards `/api` to port 8787.

Register OAuth callbacks at `APP_ORIGIN/api/auth/callback/google`, `/github`, and `/chatgpt`. ChatGPT commercial clients need OpenAI approval. Workspace sign-in is separate from local CLI sign-in. Cloud writes default to private: add the account id returned by `/api/me` to `CLOUD_ALLOWED_USERS`. Set `CLOUD_ACCESS=public` only when you intend to open access. No provider secret belongs in a `VITE_` variable. Use TLS database connections in production and keep the database private.

## Vercel deployment

The canonical app address is [leadinglight.app](https://leadinglight.app), in Vercel team `pranavs-projects-9ffa1d28`, project `leadinglight-web`. Neon resource `leadinglight-web-db` uses the free plan in Washington, D.C. (`iad1`), connected only to Production. Neon Auth is off; Auth.js owns sign-in. The existing image service is separate. Deployments currently use the CLI, not a connected Git pipeline.

Production has `APP_ORIGIN`, `DATABASE_URL`, `AUTH_SECRET` and, since 2026-11-04, `CLOUD_ACCESS=public`. Each signed-in identity still has its own workspace; public access does not share notes, calendar grants or paired devices. Use the same sign-in provider on every device: matching emails do not link accounts. Vercel stores credentials as secrets; downloaded production env files contain `[SENSITIVE]` placeholders, not usable credentials. Initial schema setup runs in the Vercel build environment with a one-time build command before the normal frontend build.

GitHub OAuth app `3973995` (`LeadingLight`, owned by `rangrik`) is registered, with expiring user tokens and an exact production callback. The live redirect requests `read:user user:email` and uses PKCE S256 with a secure HttpOnly verifier cookie. Google Cloud project `leadinglight` (`767500484378`) has a web client with the production origin and exact callbacks. Its consent setup is External / In production; Google verification is pending. Sign-in requests basic profile/email; connecting Calendar separately requests the scopes below. Both providers' credentials are deployed as production-only secrets. Real Safari callbacks succeeded for both providers; GitHub session restoration and sign-out after reload also passed. The unverified-app warning and Google user cap remain until Google approves the requested sensitive scope.

Google and GitHub variables below are configured in [Production environment variables](https://vercel.com/pranavs-projects-9ffa1d28/leadinglight-web/settings/environment-variables). ChatGPT identity remains optional and unconfigured. Model API keys are neither required nor supported. Never paste OAuth secrets into chat or commit them.

| Feature | Variables | Registration |
|---|---|---|
| GitHub sign-in | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Homepage is the production origin; callback is `https://leadinglight.app/api/auth/callback/github` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Web OAuth client; origin is the production origin; callback is `https://leadinglight.app/api/auth/callback/google` |
| Optional ChatGPT sign-in | `CHATGPT_CLIENT_ID`, `CHATGPT_CLIENT_SECRET` if issued | Approved commercial client; callback is `https://leadinglight.app/api/auth/callback/chatgpt` |

Local editing and history work without an account; encrypted sync and browser pairing need workspace sign-in. Agents use the person’s existing CLI account and its limits on the Mac. Browser Ask becomes available after the user pairs and selects an online Mac. No API-key setup or usage billing is implemented.

Create a **new** Vercel project using this repository's root and `vercel.json`. Do not change `apps/image-service`. Set the environment variables from `.env.example`, using the final HTTPS origin and managed PostgreSQL URL. Run the migration once against that database before deploying. The API entry point is `api/gateway.mjs`.

The previous model adapters, hosted queue worker and recovery cron are removed. Older clients receive a paired-Mac explanation when submitting a job, before note context is read or stored. Existing database tables are retained without destructive migrations. No model API request has been made by this deployment work.

The service stores encrypted sync envelopes. The sync recovery key never reaches the service. Loss of every device and the recovery key makes encrypted notes unrecoverable. History stays until storage management is added.

Native Mac and iPad apps now join this same account through browser approval. The server stores
only hashed device credentials and encrypted recovery-key envelopes. Native sessions are scoped
to note sync and cannot grant browser agent access. Additive schema setup runs in the production
build before the web client is deployed. See [native sync](../../docs/NATIVE-SYNC.md) for limits
and the required device acceptance.

Redeploy from the linked repository root with `pnpm dlx vercel@65.7.0 deploy --prod --yes --scope pranavs-projects-9ffa1d28`.

## Verification

`TEST_DATABASE_URL=postgres://leadinglight:local-development-only@127.0.0.1:55439/leadinglight pnpm --filter @leadinglight/cloud test` checks encrypted sync durability, deduplication, account isolation and refusal of legacy agent requests. Tests inject authentication; they do not claim to validate live OAuth or local CLI accounts.

For browser tests, start `test/browser-server.mjs` with that same `TEST_DATABASE_URL`, then run `CLOUD_QA=1 QA_PORT=1431 pnpm --filter @leadinglight/desktop exec playwright test -c qa/playwright.config.ts --project=qa --project=safari cloud.spec.ts cloud-large.spec.ts cloud-guards.spec.ts native-account.spec.ts pairing-integration.spec.ts`. This exercises encrypted sync, account approval and the relay in Chromium and WebKit. The production-only agent check needs a separate production preview in `OFFLINE_QA`. This test-only localhost server accepts a `qa-user` cookie and never runs in the production gateway. Remove its container with `docker compose -p leadinglight-cloud-qa -f apps/cloud/compose.yaml down`; add `-v` only to discard its test data.

## Paired Mac relay

`/api/relay/pairs` uses the browser's workspace session. Its writes require the exact app origin and authenticated workspace access. The native `/api/relay/device/*` routes reject browser origins and use a per-pair bearer token; only its SHA-256 hash is stored. Pairing starts with a five-minute high-entropy invitation hash, permits one claim, and requires approval on the Mac before commands can flow. Each account may keep five live invitations and ten active connections, with thirty invitations per day.

The relay saves routing IDs, connection state and AES-GCM envelopes; it cannot read prompts, tool results, model events, pairing keys or CLI credentials. A browser explicitly acquires a controller lease. Another tab needs an explicit takeover; expired leases require a new controller ID. A start requires a Mac heartbeat within 25 seconds and expires after 30 seconds. Commands do not move to another controller or restart after uncertain execution. The Mac's durable start ledger remains the execution deduplication boundary.

Commands are capped at 256 KiB, 200 pending messages and 5 MiB per connection; each connection allows one active turn and thirty starts per hour. Events are appended atomically with run-state updates, with a 20 MiB quota for outstanding payloads. Reads are bounded to 1 MiB. Received event ciphertext clears when the browser acknowledges its cursor; takeover clears the previous controller's payloads. Unacknowledged event payloads expire opportunistically after 24 hours. Fingerprints remain with run records for seven days to reject replay. Command ciphertext remains with its run record. Revocation rejects future messages and device polling; the Mac also stops work when its connection lease expires. This is an encrypted mailbox, not a cloud model worker.

Pair responses include relay time. Readiness, start expiry and leases use that time plus elapsed time on the receiving device, so different device clocks do not change permission or freshness. Stops immediately block new browser note mutations while the Mac confirms process termination. A definite start refusal keeps the connection; uncertain delivery stops renewing its lease.

In the web app, open **Account and sync → Agents → Connect a Mac**. Paste its code into the same panel in the Mac app, review the workspace and browser, then choose **Allow this browser**. Back in the browser, choose **Use this Mac**. Keep both apps open and connected and the Mac awake. This grant covers page agents; it does not expose project folders or terminals. Pairing does not enable note sync. A reload preserves the partial transcript and interrupts the turn; reconnect explicitly before starting another.

The browser keeps a non-extractable connection key in IndexedDB. The Mac keeps its key and relay credential in Keychain. Each pairing is independent; clearing browser storage requires pairing again. No new provider or infrastructure credentials are needed beyond this deployment’s existing database and workspace sign-in configuration. The Mac build uses the production relay origin.

## Google Calendar

The Calendar API uses the existing Google **web** OAuth client, separately from Auth.js login.
Run `pnpm --filter @leadinglight/cloud migrate` for `calendar_accounts` and `calendar_oauth`.
Set `CALENDAR_TOKEN_KEY` to a stable random 32-byte base64 key (`openssl rand -base64 32`).
Tokens are AES-256-GCM encrypted with workspace/account binding. Keep this key separate from
Google credentials, back it up privately, and never expose it through Vite. Replacing it requires
users to reconnect; there is no automatic key rotation migration.

In the same Google Cloud project, enable Google Calendar API and register the exact redirect
`https://YOUR_APP_ORIGIN/api/calendar/callback` alongside the existing login callback.
Request `openid`, `email`, `calendar.calendarlist.readonly`, and `calendar.events` scopes.
Add calendar scopes to the consent configuration. External testing permits only listed test
users and Google's testing refresh-token restrictions apply. Production availability requires
publishing the consent app and completing Google's required verification. Do not claim support
for any Google user while the consent app is still in testing or cloud access is private.
Workspace administrators can still block access. On 2026-11-03, Safari verified the existing OAuth credentials in Vercel, added the exact
calendar redirect URI to the Google client, and saved `CALENDAR_TOKEN_KEY` as a Production
secret. After explicit approval, Google Calendar API was enabled and the calendar-list read and
event read/write scopes were saved. The service was deployed to
`https://leadinglight-web.vercel.app`, including the additive calendar migration. Safari
completed a live Google connection and verified creating, editing and deleting a guest-free
test event in both LeadingLight and Google Calendar. The account remains connected.

Calendar requests use the same workspace session or scoped native credential as sync, with
origin checks on browser writes. Native callbacks finish in the system browser signed into the
same LeadingLight workspace. Calendar accounts are distinct from the workspace login provider.
Connecting personal and work Google identities does not merge LeadingLight accounts.

The service fetches events on demand and does not store event bodies. Events pass through the
service unencrypted in memory, so this integration is **not** the end-to-end encrypted note
journal. Logs must never include Google token bodies or event content. Disconnect deletes the
saved grant locally; users may revoke the app separately in Google. Google receives
`sendUpdates=all` for writes, including agent writes. ETags guard edits and deletes; deterministic
Google event IDs guard retried creates. A repeated create ID returns the existing event.

Validation: run `TEST_DATABASE_URL=... node --test --test-concurrency=1 src/*.test.mjs` after
initializing a separate test database. Google responses are mocked; tests exercise real SQL
ownership, OAuth state consumption, token refresh and conditional writes. A real consent grant
and disposable event were also verified in Safari against the deployed Google project on
2026-11-03. Public verification and native agent checks remain separate.

On 2026-11-04, public account access was deployed and Safari repeated calendar connection and
event create/edit/delete. The public homepage and privacy policy are served under `/help/`.
Search Console ownership is verified by `public/google91415a0dc0d5c471.html`; preserve this file
and its static Vercel route. Google review status and follow-up are recorded in
[Google verification](../../docs/GOOGLE-VERIFICATION.md).


## Custom-domain migration

`APP_ORIGIN=https://leadinglight.app` and
`LEGACY_APP_ORIGINS=https://leadinglight-web.vercel.app` keep existing sessions and native
credentials working at the earlier hostname. The gateway retains the actual request host;
only these configured hosts are accepted, and browser writes require their own exact origin.
New sign-ins and browser calendar grants use the canonical hostname. Update both Google and
GitHub callbacks before deploying. Native origins are pinned to leadinglight.app in new builds;
older installed devices retain existing credentials but need an updated build to reconnect.

Do not redirect the old browser address: IndexedDB notes belong to that origin. Its Copy notes
action transfers a snapshot directly between trusted browser tabs and refuses an occupied
destination. The original notes remain. Reconnect encrypted sync with the existing recovery
key after signing in with the same provider. Pair browser agents again; credentials are excluded.

The owner verified leadinglight.app through a Search Console DNS Domain Property on November 5.
The older URL-prefix HTML proof did not meet Google's OAuth domain requirement. Public OAuth
verification is still pending; see docs/GOOGLE-VERIFICATION.md.
