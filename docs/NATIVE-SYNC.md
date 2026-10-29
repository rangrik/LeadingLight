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
and WebKit. Device delivery must additionally verify the real Mac library, an image/PDF,
an offline iPad edit and its return to the Mac. Record those results here after installation;
passing fixture tests alone does not establish that the owner's devices are connected.
