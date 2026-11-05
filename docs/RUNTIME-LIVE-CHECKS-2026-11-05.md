# Live provider checks — 2026-11-05

This continues the [credential audit](RUNTIME-CREDENTIALS-2026-11-04.md).
The later [full runtime validation](RUNTIME-VALIDATION-2026-11-05.md) records
the complete suite rerun and default live checks after these changes.

## Claude completed

The normal Claude subscription sign-in completed successfully. The real
`TestALiveClaudeSessionWorks` then reached its terminal handoff but stopped at
Claude Code's first-run bypass-mode confirmation. Its reply and Bash-tool
assertions had already succeeded.

The fixture now writes `skipDangerousModePermissionPrompt: true` to its own
private `settings.json`, matching the bypass mode explicitly selected by this
integration test. The file is mode 0600 within the disposable configuration
directory. The existing assertions and production behavior are unchanged.

With that fix, the complete live check passed in **15.19 seconds**: first reply,
the `echo shipyard-live` tool call, switching to Claude's terminal, switching
back to chat, and remembering the original reply. The test exited successfully
and removed its temporary credential/configuration directory. The normal
Claude settings and credential files were unchanged by the test.

## Gateway excluded by user choice

The user declined Vercel model usage after reviewing the billing requirement.
The live Gateway check is therefore excluded from the requested validation,
not counted as passed. No further Gateway requests or billing setup will be
performed for this task. The default live-provider run and `all` now select
only Codex, Claude, ACP and browser; Gateway requires explicit `turncheck`.

The existing local `~/.berth/turncheck.json` had Gateway turn checking enabled.
Its `enabled` field was changed to `false`, preserving the other settings and
a private backup. The runtime reads this file for each turn, so no daemon
restart was necessary. LeadingLight's embedded runtime has no separate
turn-check configuration. Credentials and other agents' worktrees were untouched.

Before this opt-out, the following live probes established the account issue:

The gateway check ran with a fresh OIDC token from LeadingLight's existing
Vercel project. All five cases reached the service and received HTTP 403. The preceding
audit identified `customer_verification_required`. The verification page
was opened in Safari before the user declined this provider.

The configured `typesafe-ai/jev` model is not eligible for free Gateway
credits, so verification alone may not be sufficient: purchased Gateway
credits may also be required. Its published input price is approximately
$0.04 per million tokens. No payment details were submitted, credits purchased,
or auto top-up enabled by the agent.

The gateway check remains unverified and is no longer a completion requirement.
Across the original 30 skipped entries,
**28 now pass, one helper is covered by its passing parent, and one live
gateway check is excluded by user choice**. The previously passing full fixture suite
was not rerun for this three-line change to the live Claude fixture.

## Evidence and rerun

Logs are retained under `apps/desktop/qa/report/runtime-live-2026-11-05/`,
including the initial Claude onboarding failure, the passing Claude run, and
the gateway response. Authentication metadata excludes tokens and account
identity. Work was isolated in dedicated worktrees; other agents' worktrees
were not modified. This changes test tooling only, so no application rebuild
or daemon restart is needed.

```sh
pnpm runtime:test:providers claude
# Inspect the default selection without contacting any provider:
pnpm runtime:test:providers --list
```

References: [Claude's fixture setting](https://code.claude.com/docs/en/settings-reference#skipdangerousmodepermissionprompt),
[Jev pricing and free-credit eligibility](https://vercel.com/ai-gateway/models/jev),
and [Vercel Gateway credits](https://vercel.com/docs/ai-gateway/pricing).
