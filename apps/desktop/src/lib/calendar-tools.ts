import { calendarApi, calendarList, changeCalendar } from './calendar';

const text = (description: string) => ({ type: 'string', description });
const schema = (properties: Record<string, object>, required: string[] = []) => ({ type: 'object', properties, required });
const target = { account: text('Google account ID from calendar_list'), calendar: text('Calendar ID from calendar_list') };
const existing = { ...target, event: text('Occurrence ID from calendar_events'), etag: text('Exact quoted etag from calendar_events; never invent or use a wildcard') };
export const CALENDAR_TOOLS = [
  { name: 'calendar_list', description: 'List connected personal and work calendars and their write permissions. Calendar data is private to this LeadingLight account.', inputSchema: schema({}), annotations: { readOnlyHint: true } },
  { name: 'calendar_events', description: 'Read events in one calendar for a range up to 93 days. Read every relevant calendar before claiming time is free. Results include event IDs and etags. Times require UTC offsets; all-day end dates are exclusive.', inputSchema: schema({ ...target, start: text('RFC3339 start with offset'), end: text('RFC3339 end with offset') }, ['account', 'calendar', 'start', 'end']), annotations: { readOnlyHint: true } },
  { name: 'calendar_create', description: 'Create an event in Google Calendar. Sends invitations to any supplied guests. Only do this when the person wants scheduling. Reuse requestId when retrying. details is JSON with summary, start/end ({dateTime,timeZone} or {date}), optional description, location, attendees [{email}], reminders and recurrence [RRULE:FREQ=WEEKLY;COUNT=12]. Leave breathing room; do not fill every gap.', inputSchema: schema({ ...target, requestId: text('Unique stable ID for this intended event'), details: text('JSON event details') }, ['account', 'calendar', 'requestId', 'details']) },
  { name: 'calendar_update', description: 'Edit one event or occurrence in Google Calendar, with its exact current etag. details is JSON with only fields to change. Supply both start and end when changing time. Omitted fields are preserved. Guest changes replace the guest list and notify guests. Conflicts require a fresh read; never silently overwrite.', inputSchema: schema({ ...existing, details: text('JSON event patch') }, ['account', 'calendar', 'event', 'etag', 'details']) },
  { name: 'calendar_delete', description: 'Delete one event or occurrence in Google Calendar and notify its guests. Only when the person asks to remove it; supply its exact current etag.', inputSchema: schema(existing, ['account', 'calendar', 'event', 'etag']), annotations: { destructiveHint: true } },
];
export async function runCalendarTool(name: string, args: Record<string, string | undefined>) {
  if (name === 'calendar_list') return calendarList();
  if (name === 'calendar_events') return calendarApi('events', args);
  if (!['calendar_create', 'calendar_update', 'calendar_delete'].includes(name)) throw new Error('Unknown calendar tool.');
  const body = { ...args, ...(args.details && { details: JSON.parse(args.details) }) };
  return changeCalendar(name.slice(9) as 'create' | 'update' | 'delete', body);
}
