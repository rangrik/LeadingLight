# Remaining live checks — credential audit

This follows the [runtime fixture validation](RUNTIME-FIXTURES-2026-11-03.md).
The two remaining checks were retried using existing local credentials, with
private temporary configuration and no changes to existing agent worktrees,
provider logins, application settings, or running daemons.

## Gateway

The earlier runner looked for both `turncheck.json` and `turncheck.key` in
`~/.berth`. Shipyard actually separates them: its default macOS configuration
is `~/.berth/turncheck.json`, while the pasted key is in
`~/Library/Application Support/berth/box/turncheck.key`. LeadingLight's embedded
runtime instead uses `<runtime>/user/turncheck.json` and
`<runtime>/box/turncheck.key`.

A key exists in the native Shipyard location. The actual `TestTurnCheckLive`
ran all five cases with it; each received HTTP 401. The existing Vercel CLI
login is valid against Vercel's account API. Gateway requests using that login
require the selected team header; with that header, the service returns HTTP
403, `customer_verification_required`, and asks for a valid credit card before
serving requests. LeadingLight's linked Vercel project belongs to that same team.

An isolated `vercel env pull` for that existing project returned an OIDC token,
and no Anthropic or AI Gateway API key. Running the actual Go check with that
OIDC token reached the gateway, but all five cases received HTTP 403. No project
was created or deployed, no billing settings were changed, and the temporary
Vercel configuration, environment file, and token copies were removed.

The runner now discovers the real split storage locations, respects explicit
`BERTH_HOME` and `BERTH_USER_DIR`, and accepts `AI_GATEWAY_API_KEY` or
`VERCEL_OIDC_TOKEN` as explicit environment credentials. An explicit
`BERTH_TURNCHECK_LIVE_KEY_FILE` takes precedence. A configured model or
`BERTH_TURNCHECK_LIVE_MODEL` is still required. General Vercel login tokens are
not selected automatically, since the pinned runtime does not send their
required team header.

## Claude

The installed Claude Code 2.1.314 reports `loggedIn: false`. Its normal
Keychain credential exists, but has no access token or refresh token. There
is no fallback `.credentials.json`, configured API key, alternate Claude
Keychain profile, or relevant key in the inspected CLI/app settings and
LeadingLight environment files.

Claude Desktop has a separate encrypted OAuth cache. Reading its `Claude Safe
Storage` Keychain item timed out, so that cache could not supply a verified
credential. The app's login was not modified, refreshed, or replaced. macOS
Keychain approval or a normal `claude auth login` is needed to continue with
that account. The fixture lookup now also selects the correct Keychain account
and custom configuration-directory service when those are configured.

## Current result and rerun

Neither live check is marked passed. Gateway access is blocked by account
verification; Claude still needs an accessible, usable login. This does not
change the earlier result of 27 formerly skipped checks passing and one
subprocess helper covered by its parent.

After resolving the account requirements locally, supply a valid Gateway key
through `AI_GATEWAY_API_KEY` or the app configuration, or a fresh project
`VERCEL_OIDC_TOKEN`, then run:

```sh
pnpm runtime:test:providers claude turncheck
```

All 15 credential-discovery regression tests pass. The default runner now
finds the native gateway key and attempts the live check instead of reporting
that the key is missing. These changes affect test tooling only; the installed
application and runtime version remain unchanged.

Credential values are excluded from the report. Redacted test logs and the
credential-discovery checks are retained under
`apps/desktop/qa/report/runtime-credentials-2026-11-04/`.

References: [Claude credential storage](https://code.claude.com/docs/en/authentication#credential-management),
[Vercel gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok),
and [local Vercel OIDC authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc).
