# Calendar

Open **Calendar** in the sidebar to bring personal and work Google calendars into one plan.
Your notes remain local and work without a calendar connection.

## Connect your calendars

Sign into LeadingLight through **Account and sync**, then choose **Connect Google Calendar**.
Google opens in your browser. Choose an account and allow calendar access. Return to the app
and press **Refresh** if the connection has not appeared yet. On the Mac, use the same
LeadingLight workspace in the browser that approved your device.

Open **Calendars → Add or reconnect Google account** to connect another personal or work
account. Connecting an account again refreshes its permission without adding a duplicate.
Some work organizations restrict third-party calendar access; their administrator controls this.

The checkboxes in **Calendars** choose what appears. Hiding a calendar does not delete it or
change its Google settings. **Disconnect** removes LeadingLight's saved access to that account.
It does not delete events or revoke Google's broader app grant; remove that in Google's
connected-app settings if you want to revoke it everywhere.

## A manageable day

The day view shows events in time order and highlights what is happening now or coming next.
**Next 7 days** gives a longer agenda. Use the arrows, date picker or **Today** to navigate.
Times appear in your device timezone, shown above the agenda. All-day events stay on their dates.

**Plan 25 minutes of focus** proposes an opening between 9 am and 6 pm in the visible calendars,
with five-minute buffers around existing events. It opens a draft for you to adjust and save.
Hidden calendars are not checked. This is a small starting point, not a requirement to fill your day.
An all-day busy event blocks a suggestion; a Google event marked free does not.

## Create and change events

Choose **New event**, give it a title and choose a writable calendar. Set its times or mark it
all-day. For all-day events, **Ends before** is the first day *after* the event.
You can add a location, notes, guests and a reminder. New events can repeat daily, weekly or
monthly for a chosen number of occurrences. Reminders are delivered by Google Calendar;
LeadingLight does not run its own background notification service.

Click an event to edit it. An occurrence in a repeating series changes only that occurrence.
Deleting asks you to confirm. Guest invitations and updates are sent by Google when you save.
Shared calendars with read access stay read-only. Google-specific events such as working
location or out-of-office stay read-only here.

If someone changed an event since you opened it, saving stops. Your draft stays visible.
Copy any changes you need, close the form, refresh, and reopen the event before trying again.
A network failure may leave the outcome uncertain: refresh before creating a replacement.
Retrying the same open creation form uses the same event ID to avoid duplicates.

## Ask an agent

Open Ask beside a note and try “Find 25 minutes for this tomorrow,” or “Move my writing block
to Friday afternoon.” Claude and Codex note agents can list calendars, read events and create,
update or delete events directly. Writes use the existing agent approval settings. Plan mode
can read your schedule but cannot change it. The agent should check all relevant calendars
and leave breathing room.

This access belongs to note agents, including paired note agents. Background project agents
remain scoped to project pages and do not inherit private calendar access.

## Connection and privacy

Google authorization is separate from signing into LeadingLight. Refresh tokens are encrypted
on the LeadingLight service, bound to your workspace and Google account. Google event data
passes through that service to your device; unlike encrypted note sync, it is not end-to-end
encrypted. Tokens never go to the browser or agents. The app keeps the displayed events in
memory, clears them on sign-out and refreshes while the calendar view is open.

Calendar editing needs an internet connection. Failed refreshes are marked as potentially
out of date, and no changes are queued secretly while offline.

The installation must have Google Calendar enabled by its operator. During Google's testing
phase, only approved Google test accounts can connect. Public availability requires the
operator's Google consent setup and any required verification.

In a narrow pane, each calendar name sits below its event title so the plan stays readable beside a note.
