---
title: Privacy policy
description: How LeadingLight accesses, uses, stores and shares account, note and Google Calendar data.
---

# LeadingLight privacy policy

Effective November 4, 2026. LeadingLight is developed and operated by Pranav Kanade.
Contact [k.pranav.apk@gmail.com](mailto:k.pranav.apk@gmail.com) for support, privacy questions,
or requests to delete cloud data. This policy covers the LeadingLight apps and their cloud service.

## Notes and accounts

Notes, attachments, history and preferences are stored on your device. Local editing does not
require an account. If you sign in with Google or GitHub, the provider may supply an account
identifier, name, email address and profile image. We use the identifier to separate workspaces
and display your name in the app. A secure session cookie keeps you signed in and may contain
the provider's basic profile details. Different sign-in providers create separate workspaces.

Optional sync encrypts notes on your device before uploading them. Our service stores the
encrypted data; the recovery key stays on your approved devices. Browser-to-Mac agent pairing
also uses encrypted messages. It requires your approval on the Mac.

## Google Calendar access and use

Connecting a calendar is optional and separate from signing into LeadingLight. You choose
each Google account and approve Google's consent screen. We request:

- **List subscribed calendars** (`calendar.calendarlist.readonly`) to show your personal,
  work and shared calendars, their names, timezones and access permissions.
- **View and edit events** (`calendar.events`) to display your plans, find available time,
  and create, update or delete events when you use those features. Event data may include
  titles, times, descriptions, locations, guests, recurrence and reminders.
- **Identity** (`openid` and `email`) to keep the connection associated with the right account.

These permissions apply to the calendars the Google account can access. Hiding a calendar in
LeadingLight changes its visibility in the app; it does not narrow Google's permission grant.
Read-only calendars cannot be edited. Google Workspace administrators may restrict connections.
When you save or delete an event with guests, Google may send them the event update.

Calendar requests pass through our service to Google. Our service stores the connected account
identifier and email, plus access and refresh tokens encrypted at rest with AES-256-GCM.
Connections are bound to your LeadingLight workspace. The calendar API does not store a copy
of your event bodies in its database; it fetches them on demand. Event data is held in app memory
while in use. Calendar data passing through the service is **not end-to-end encrypted**.

## Optional calendar help from agents

When you ask a note agent to plan with your calendar, the agent can read calendar details and
use the calendar tools on your behalf. Relevant prompts and tool results are sent through your
own Claude Code or Codex account to **Anthropic or OpenAI**, the provider you choose. This
processing supports your requested response or calendar action. Writes follow the app's agent
approval setting; Plan mode does not write. Background project agents do not receive calendar
tools. Calendar tokens are not sent to model providers.

Agent conversations and calendar details you save in notes can remain in your local notes and
history, and in encrypted sync if you enable it. Model providers process prompts and responses
under their own terms, privacy policies and your account's data controls. Review those controls
before using calendar data with an agent. You can manage calendars directly without using AI.

LeadingLight does not use Google user data to develop, improve or train generalized AI or
machine-learning models. We use it only to provide the user-facing features described here.

## Sharing and service providers

We do not sell Google user data or use it for advertising. We do not share it with data brokers
or use it to decide creditworthiness. Vercel hosts the web app and API; Neon provides the
service database. They process data needed to operate the service. Google processes calendar
requests. Anthropic or OpenAI receives relevant calendar content only through the optional
agent workflow described above. Hosting providers may process IP addresses and request
metadata for delivery, security and operations.

LeadingLight has no advertising or analytics trackers of its own. Covers, embeds, saved web
pages and the built-in browser contact the sites you choose. Unsplash cover searches pass
through our image service. See [Your data and privacy](/guide/privacy) for these features.

LeadingLight's use and transfer of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including its Limited Use requirements. We do not permit people to read Google user data
except with your explicit permission for specific data, for necessary security investigations,
to comply with applicable law, or for aggregated and anonymized internal operations allowed
by that policy. We may disclose data when required by law or to address fraud and security threats.

## Retention, disconnecting and deletion

Calendar credentials remain in our live database until you disconnect the account or request
their deletion. Choose **Calendar → Calendars → Disconnect** to delete our stored connection
and credentials. This leaves your events in Google Calendar unchanged. You can also revoke
LeadingLight in [your Google Account connections](https://myaccount.google.com/connections).
Revoking access at Google stops future access; disconnect in LeadingLight to remove its stored
connection as well. Expired OAuth setup records are removed when new connections start.

Signing out clears calendar data from the open app. It does not delete notes, their history,
saved agent conversations or encrypted sync data. You can delete local notes in the app;
to remove all local data, follow the platform's app-data removal process. Email the contact
above to request deletion of cloud connection records, encrypted notes or account-associated
data. We may need to verify that you control the account before acting. Provider backups and
operational logs follow their retention schedules; deleted live records may remain there
until those copies expire. We do not claim immediate erasure from backups.

## Security and changes

We use HTTPS in transit, encrypted calendar credentials at rest, workspace ownership checks,
and explicit approval for paired Macs. No service can guarantee perfect security. Keep your
devices and provider accounts secure, and keep your sync recovery key private.

We will update this page when data practices change and change the effective date above.
Material changes to calendar permissions require a new Google consent grant. Contact
[k.pranav.apk@gmail.com](mailto:k.pranav.apk@gmail.com) with questions about this policy.
