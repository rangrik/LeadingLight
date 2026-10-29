# Native workspace sync

Mac and iPad use the existing cloud journal. Account connection opens the system browser;
the signed-in workspace approves the named device after checking its displayed code.
The approval encrypts the recovery key with ECDH-P256 and AES-GCM. The private polling
verifier and native bearer credential remain in Rust. Keychain persistence happens only
after key verification; failure restores the earlier local key and login.

Requests expire after ten minutes and can be claimed once. Native sessions expire after
30 days and sign-out revokes them. Only config, identity and encrypted sync routes accept
native credentials. Expected-account headers reject a session change during a sync.
The browser's existing origin checks remain in place.

Attachments travel inside the encrypted, compressed journal payload. Stable content hashes
avoid device-specific paths; receivers validate the complete bundle before writing local
files. Native previews use those files offline. Limits: 32 MiB per file, 64 MiB of unique
attachment bytes per event and 256 assets per event. Missing files and quota failures leave
local notes intact and report that sync needs attention.

A fresh device adopts desktop changes to untouched starter type/property definitions.
Existing receiver customizations remain intact. Later edits or deletions of definitions
are not yet journaled across devices; page content and property values do sync.

## Deployment

Apply `apps/cloud/src/schema.sql` through the production build environment before deploying
the matching web client and native apps. The new tables are additive. The upgraded web
client must be deployed before native clients send attachment references. Keep production
secrets in the existing deployment environment.

## Acceptance

Fixture checks cover account isolation, expiry, revocation, replay, browser origin guards,
encrypted key transfer and failed verification. Browser approval is exercised in Chromium
and WebKit. The installed-device results below are separate from those fixture checks.

2026-10-29, merged source `5f06240`: workspace typecheck, 44 desktop unit tests, 20 Rust
tests and arm64 iOS compilation passed. The isolated PostgreSQL server suite passed 10/10.
Post-merge browser acceptance passed 14/14 account cases and 8/8 iPad cases in Chromium
and WebKit. Two browser databases also passed encrypted PNG/PDF transfer, initial catalog
adoption, offline edits and reconnect, history restore and repeated sync without duplicate
history or conflict copies. Native identity and relocated iOS assets passed 4/4 checks.

Independent Sonnet 5.5 review found account-switch and failed-approval rollback issues;
both were fixed and covered by the final browser cases.

The installed Mac and iPad connected to the same account on 2026-10-29. Bidirectional fixture
edits and history restore passed. Initial library comparison found 53 active Mac pages but
49 on iPad despite both showing Up to date. The server sorted sequence numbers as text;
fix `9756705` orders them numerically. The PostgreSQL suite passed 12/12 and independent
Sonnet 5.5 review passed.

With the user’s approval, four missed baseline events moved from cloud sequences 6–9 to
62–65. Their IDs and encrypted payloads stayed unchanged, and the event count remained 61.
Normal sync then recovered all four pages. Read-only comparison confirmed matching IDs,
content and revisions for all 53 active pages, all 61 history IDs and all 52 baselines.
Ten attachment hashes matched with no missing files, and both SQLite integrity checks passed.
All four recovered titles were visible on the physical iPad; both apps showed Up to date.

With Wi-Fi fully off in Settings, a cold iPad launch retained the October 23 daily record
and the fixture body’s Mac marker. The PNG rendered, and the downloaded PDF opened
`LL-IPAD-PDF-2026-10-29` in Quick Look. This final pass tested offline reading; it made no
new offline edit. Earlier physical offline-edit persistence and online bidirectional edits
and history restore are separate passes, not a new offline edit syncing back to the Mac.
Wi-Fi rejoined the original network, and the iPad was left on the Pages list.

Across 14 types and 27 properties, the only catalog difference was the Page display preference:
`view.kind` was `table` on Mac and `list` on iPad. The remaining definitions matched.
