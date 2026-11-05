import { cloudApi, cloudState } from './cloud';
import { isNative } from './platform';

export type CalendarAccount = { account: string; email: string };
export type Calendar = { id: string; summary: string; accessRole: string; timeZone: string; primary?: boolean; account: string; email: string };
export type CalendarTime = { date?: string; dateTime?: string; timeZone?: string };
export type CalendarEvent = { id: string; etag: string; summary?: string; description?: string; location?: string; start: CalendarTime; end: CalendarTime; recurringEventId?: string; htmlLink?: string; hangoutLink?: string; status?: string; eventType?: string; transparency?: string; attendees?: { email: string; responseStatus?: string; self?: boolean }[]; reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] }; calendar: Calendar };
export const calendarKey = (c: Calendar) => JSON.stringify([c.account, c.id]);
export const writable = (c: Calendar) => ['owner', 'writer'].includes(c.accessRole);
export const dayString = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const dayAfter = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return dayString(d); };
export const eventStart = (e: CalendarEvent) => new Date(e.start.dateTime || `${e.start.date}T00:00:00`).getTime();
export const eventEnd = (e: CalendarEvent) => new Date(e.end.dateTime || `${e.end.date}T00:00:00`).getTime();
export const calendarChanged = () => window.dispatchEvent(new Event('leadinglight:calendar'));
export async function calendarApi<T>(action: string, body?: unknown): Promise<T> {
  const owner = cloudState().user?.id;
  if (!owner) throw new Error('Sign in to LeadingLight to connect your calendars.');
  const value = await cloudApi<T>(`calendar/${action}`, body, body ? 'POST' : 'GET', owner);
  if (cloudState().user?.id !== owner) throw new Error('The workspace changed. Reopen Calendar.');
  return value;
}
export async function connectCalendar() {
  const native = await isNative;
  const popup = native ? null : window.open('about:blank', '_blank');
  try {
    const { url } = await calendarApi<{ url: string }>('connect', {});
    if (new URL(url).origin !== 'https://accounts.google.com') throw new Error('Invalid Google connection URL.');
    if (native) await (await import('@tauri-apps/plugin-opener')).openUrl(url);
    else if (popup) { popup.opener = null; popup.location.href = url; }
    else throw new Error('Allow popups to connect Google, then try again.');
  } catch (e) { popup?.close(); throw e; }
}
export async function calendarList() {
  const { accounts } = await calendarApi<{ accounts: CalendarAccount[] }>('accounts');
  const results = await Promise.allSettled(accounts.map(async (a) => {
    const { calendars } = await calendarApi<{ calendars: Omit<Calendar, 'account' | 'email'>[] }>('calendars', { account: a.account });
    return calendars.map((c) => ({ ...c, ...a }));
  }));
  return { accounts, failedAccounts: results.flatMap((r, i) => r.status === 'rejected' ? [accounts[i].account] : []), calendars: results.flatMap((r) => r.status === 'fulfilled' ? r.value : []), errors: results.flatMap((r, i) => r.status === 'rejected' ? [`${accounts[i].email}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : []) };
}
export async function calendarEvents(calendars: Calendar[], start: string, end: string) {
  const results = await Promise.allSettled(calendars.map(async (calendar) => {
    const { events } = await calendarApi<{ events: Omit<CalendarEvent, 'calendar'>[] }>('events', { account: calendar.account, calendar: calendar.id, start, end });
    return events.filter((e) => e.status !== 'cancelled').map((e) => ({ ...e, calendar }));
  }));
  return {
    events: results.flatMap((r) => r.status === 'fulfilled' ? r.value : []).sort((a, b) => eventStart(a) - eventStart(b)),
    failed: results.flatMap((r, i) => r.status === 'rejected' ? [calendarKey(calendars[i])] : []),
    errors: results.flatMap((r, i) => r.status === 'rejected' ? [`${calendars[i].summary}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : []),
  };
}
export async function changeCalendar(action: 'create' | 'update' | 'delete', body: unknown) {
  const result = await calendarApi(action, body);
  calendarChanged(); return result;
}
// Include every selected calendar; hidden or unavailable calendars cannot promise free time.
export function freeTime(events: CalendarEvent[], day: string, minutes = 25, now = Date.now()) {
  const start = new Date(`${day}T09:00:00`).getTime(), end = new Date(`${day}T18:00:00`).getTime();
  let at = Math.max(start, Math.ceil(now / 300000) * 300000);
  for (const e of events.filter((e) => e.transparency !== 'transparent' && !e.attendees?.some((a) => a.self && a.responseStatus === 'declined')).sort((a, b) => eventStart(a) - eventStart(b))) {
    const bufferEnd = eventEnd(e) + 5 * 60000;
    if (bufferEnd <= at) continue;
    if (eventStart(e) - 5 * 60000 >= at + minutes * 60000) break;
    at = Math.max(at, bufferEnd);
  }
  return at + minutes * 60000 <= end ? at : null;
}
