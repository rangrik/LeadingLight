# Google verification

Status as of November 5, 2026, 22:25 UTC: **branding verified and published; calendar data
access submitted and under review, not approved**. Safari visibly confirmed “Your app's
data access is under review.” The progress panel confirms Trust and Safety received the form.

Google Cloud project `leadinglight` (`767500484378`) is External / In production. The app is
public at https://leadinglight.app. Google's sensitive-scope warning and unverified-user cap
remain. Workspace administrators can restrict work accounts even after Google approval.

## Verified production state

- Deployment: `dpl_Em3JAyCZf8urY9E6mPBfRxCBGAHd`, promoted November 5.
- Canonical app: https://leadinglight.app; homepage: `/help/`; privacy: `/help/privacy-policy.html`.
- `www.leadinglight.app` redirects to the apex with 308, preserving path/query.
- https://leadinglight-web.vercel.app remains available for original browser notes and sessions.
  Its copy flow transfers notes directly between trusted tabs and never removes the originals.
- Live Safari copied **63 notes** to the new domain. Large-library WebKit testing passed with
  117,443,517 bytes and exact data hashes after reload. No credentials or recovery keys copy.
- Live Google sign-in, calendar reconnection and guest-free create/edit/delete passed at the
  new domain. The test event is gone. See [CALENDAR-VALIDATION.md](CALENDAR-VALIDATION.md).
- Public config/homepage/privacy requests pass; anonymous calendar data returns 401 and
  foreign-origin writes return 403. Legacy browser new sign-ins are refused with a copy-first hint.
- `APP_ORIGIN=https://leadinglight.app`; `LEGACY_APP_ORIGINS=https://leadinglight-web.vercel.app`.
  Credentials remain in Vercel and were not rotated or copied into this repository.

## Domain and OAuth configuration

The user rejected shoja.in and selected their Hostinger-managed `leadinglight.app`.
Hostinger retains its existing nameservers. Apex A records are `216.198.79.1` and
`64.29.17.1` (TTL 300); www remains a CNAME to the apex. Vercel verified both hostnames.
The Google TXT ownership proof must remain in DNS. Search Console visibly confirmed
**Ownership verified** for the DNS Domain Property, using the project-owner Google account.

The previous URL-prefix/HTML-file verification was insufficient. Google's
[domain verification instructions](https://support.google.com/cloud/answer/13804266) require
DNS Domain Property ownership. The old HTML proof stays available but is not the basis for
approval. No ownership appeal is now needed: the new branding check passed.

Only Google OAuth client: **LeadingLight Web Production**,
`767500484378-jvpecpktemov6ncdbnhhfsv6qti0udab.apps.googleusercontent.com`.
Saved and re-read after the live tests:

- JavaScript origin: `https://leadinglight.app`.
- Redirects: `https://leadinglight.app/api/auth/callback/google` and
  `https://leadinglight.app/api/calendar/callback`.
- Only authorized domain: `leadinglight.app`; homepage/privacy point to the canonical domain.
- Old Google origin/callbacks were removed after successful new-domain tests.
- GitHub OAuth app 3973995 has the new homepage and callback; its old callback remains for
  rollback. No separate GitHub live sign-in was performed.

Google's Branding page visibly reported **“Your branding has been verified and is being shown
to users.”** A fresh Safari consent flow then displayed the LeadingLight name/logo and the new
privacy-policy URL. Calendar reconnect returned successfully. The submitted form uses the new domain and required no ownership appeal.

## Submitted review

The user approved Calendar API activation and both calendar scopes.
`calendar.calendarlist.readonly` is non-sensitive; `calendar.events` needs review. Identity
scopes are openid/email/profile. No calendar sharing/ACL scope is requested.

The scope justification explains events.list/get/insert/patch/delete, calendar selection,
shared writer calendars, why read-only/owned/app-created scopes are insufficient, and optional
agents using the same user-owned operations under approval settings.

Artifacts are in:
`/Users/pranavkanade/.codex/visualizations/2026/11/03/01a1a354-e32c-79d0-a86a-c01e3ad0ea50/google-calendar-verification`.
`submission-fields.json` contains the exact justification and updated reviewer steps.
The exact steps, justification and video URL were saved and submitted in the refreshed form.
Do not submit the stale forms in other Safari tabs.

`domain-captures/` contains actual Safari evidence from the new domain, including published
branding, consent permissions and create/edit/delete. The 16-scene video is refreshed
from these captures and validated. `leadinglight-oauth-review.mp4` is H.264, 3840×2160,
30 fps, exactly 160 seconds / 4,800 frames, and 8,756,594 bytes. All scene midpoints were
inspected; decoded consent, deletion and final frames are readable and match the captures.
HyperFrames check passed; intentional silence is the only craft warning. The renderer
recovered from a worker timeout with screenshot capture and completed successfully.
The video hash, check report, render log, source and decoded frames are retained together.

The demo uses actual still captures with English labels, not a continuous recording. It does
not claim to demonstrate native agents. After the user explicitly approved YouTube Terms of
Service and Community Guidelines, the validated video was uploaded as **Unlisted**, not made
for children, to the existing channel `UCrHANqpOFH3nlDoTSwpHEcQ`.

- Video: https://www.youtube.com/watch?v=Pqjj8axkWJM
- Title: `LeadingLight Google Calendar OAuth verification`.
- Safari confirmed publication, Unlisted visibility, working playback and 2160p/4K availability.
- Copyright check reported no issues. SHA-256:
  `bd9739523080d0bd80a2581877c0f91b962986913e8d931317baf6fbfdd1e92b`.
- Data access saved the URL and scope justification. The final questionnaire answered No to
  personal-only, internal-only, development-only and WordPress SMTP-only use.
- Submission confirmed at approximately **22:25 UTC, November 5, 2026**. All seven review
  requirements show in progress. Google says first contact is expected within 3–5 days and
  review can take 4–6 weeks; these are estimates, not approval promises.
- Evidence: `domain-captures/scope-review-submitted.png` and `scope-review-progress.png`.

## Follow-up

Monitor [Verification Center](https://console.cloud.google.com/auth/verification?project=leadinglight)
and handle concrete reviewer requirements within existing authorization. After sensitive-scope
approval, test public consent again before claiming warning removal or completed verification.
Do not change audience, publishing status or requested scopes while review is pending.

Heartbeat `finish-google-calendar-verification` runs every 12 hours. It stays quiet when
unchanged and stops after approval plus the post-approval consent check. The user authorized
merging and cleaning up this branch after submission. After closeout, use this record in
`/Users/pranavkanade/work/LeadingLight`; preserve other agents' work and servers and never drive
the native app. Original browser notes remain at the old origin and must not be erased.
