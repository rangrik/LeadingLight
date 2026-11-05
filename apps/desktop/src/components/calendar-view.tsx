// COSS field/checkbox composition follows p-field-13; event rows use its Table and Button.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@leadinglight/ui/components/button';
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from '@leadinglight/ui/components/collapsible';
import { Checkbox } from '@leadinglight/ui/components/checkbox';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from '@leadinglight/ui/components/dialog';
import { Field, FieldLabel } from '@leadinglight/ui/components/field';
import { Input } from '@leadinglight/ui/components/input';
import { Textarea } from '@leadinglight/ui/components/textarea';
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from '@leadinglight/ui/components/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@leadinglight/ui/components/table';
import { Tabs, TabsList, TabsTab } from '@leadinglight/ui/components/tabs';
import { Calendar as DatePicker } from '@leadinglight/ui/components/calendar';
import { Popover, PopoverTrigger, PopoverPopup } from '@leadinglight/ui/components/popover';
import { useCloud } from '~/lib/cloud';
import { calendarApi, calendarEvents, calendarKey, calendarList, changeCalendar, connectCalendar, dayAfter, dayString, eventEnd, eventStart, freeTime, writable, type Calendar, type CalendarAccount, type CalendarEvent } from '~/lib/calendar';

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const clock = (value: number) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dateLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const localTime = (ms: number) => { const d = new Date(ms); return `${dayString(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export function CalendarView() {
  const cloud = useCloud();
  // Remount on account changes, so pending responses and drafts cannot cross workspaces.
  return <CalendarWorkspace key={cloud.user?.id || 'signed-out'} owner={cloud.user?.id} />;
}
function CalendarWorkspace({ owner }: { owner?: string }) {
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]), [calendars, setCalendars] = useState<Calendar[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem(`leadinglight.calendar-hidden:${owner}`) || '[]'); return Array.isArray(saved) ? saved.filter((x) => typeof x === 'string') : []; } catch { return []; } });
  const [events, setEvents] = useState<CalendarEvent[]>([]), [day, setDay] = useState(dayString(new Date()));
  const [view, setView] = useState('day'), [settings, setSettings] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [synced, setSynced] = useState(0);
  const [edit, setEdit] = useState<{ event?: CalendarEvent; at?: number } | null>(null);
  const [now, setNow] = useState(Date.now()), generation = useRef(0), alive = useRef(true);
  const shown = calendars.filter((c) => !hidden.includes(calendarKey(c)));
  const count = view === 'day' ? 1 : 7;
  const refresh = useCallback(async () => {
    if (!owner) return;
    const run = ++generation.current; setBusy(true);
    try {
      const list = await calendarList();
      if (!alive.current || run !== generation.current) return;
      setAccounts(list.accounts); setCalendars((previous) => [...list.calendars, ...previous.filter((c) => list.failedAccounts.includes(c.account))]);
      const next = await calendarEvents(list.calendars.filter((c) => !hidden.includes(calendarKey(c))), new Date(`${day}T00:00:00`).toISOString(), new Date(`${dayAfter(day, count)}T00:00:00`).toISOString());
      if (!alive.current || run !== generation.current) return;
      setEvents((previous) => [...next.events, ...previous.filter((e) => !hidden.includes(calendarKey(e.calendar)) && (list.failedAccounts.includes(e.calendar.account) || next.failed.includes(calendarKey(e.calendar))))].sort((a, b) => eventStart(a) - eventStart(b))); setSynced(Date.now()); setError([...list.errors, ...next.errors].join(' '));
    } catch (e) { if (alive.current && run === generation.current) setError(message(e)); }
    finally { if (alive.current && run === generation.current) setBusy(false); }
  }, [owner, day, count, JSON.stringify(hidden)]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => {
    setEvents([]); setSynced(0); void refresh();
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const offline = () => setError('You’re offline. Reconnect and refresh before planning.');
    const interval = window.setInterval(tick, 60000);
    window.addEventListener('offline', offline); window.addEventListener('focus', tick); window.addEventListener('online', tick); window.addEventListener('leadinglight:calendar', tick);
    return () => { window.removeEventListener('offline', offline); clearInterval(interval); window.removeEventListener('focus', tick); window.removeEventListener('online', tick); window.removeEventListener('leadinglight:calendar', tick); generation.current++; };
  }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!owner) return;
    const result = new URL(location.href).searchParams.get('calendar');
    if (!result) return;
    setNotice(result === 'connected' ? 'Google connected. You can return to the app or plan here.' : 'Connection cancelled. Your existing calendars are unchanged.');
    const url = new URL(location.href); url.searchParams.delete('calendar'); history.replaceState(null, '', url);
  }, []);
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(message(e)); } finally { if (alive.current) setBusy(false); } };
  const selectDay = (value: string) => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDay(value); };
  const toggle = (key: string, checked: boolean) => { const next = checked ? hidden.filter((k) => k !== key) : [...hidden, key]; setHidden(next); localStorage.setItem(`leadinglight.calendar-hidden:${owner}`, JSON.stringify(next)); };
  const canWrite = calendars.some(writable), free = shown.some(writable) && !error && synced && !busy ? freeTime(events, day, 25, now) : null;
  const next = events.find((e) => eventEnd(e) > now && e.start.dateTime);
  return <div className="@container/calendar h-full overflow-y-auto" data-testid="calendar-view">
    <div className="mx-auto max-w-5xl space-y-6 p-4 @xl/calendar:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">Calendar</h1><p className="mt-1 text-sm text-muted-foreground">A little structure. Room for the rest of life.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setSettings(true)}>Calendars</Button><Button disabled={!canWrite || busy} onClick={() => setEdit({})}><Plus className="size-4" />New event</Button></div>
      </header>
      {!owner ? <div className="space-y-3 rounded-lg border p-6"><CalendarDays className="size-6 text-muted-foreground" /><h2 className="font-medium">Personal and work, in one place</h2><p className="max-w-lg text-sm text-muted-foreground">Connect your workspace, then add as many Google accounts as you need. See your day, make space for focus, and ask your note agent to help schedule.</p><Button onClick={() => window.dispatchEvent(new Event('leadinglight:cloud-account'))}>Sign in to connect calendars</Button></div> : <>
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {error && !settings && <div role="alert" className="rounded-lg border p-3 text-sm"><p>{error}</p><p className="mt-1 text-muted-foreground">{synced ? 'The events below may be out of date. Refresh before planning.' : 'Calendar data is unavailable. Your notes still work.'}</p><Button variant="ghost" disabled={busy} onClick={() => void refresh()}>Try again</Button></div>}
        {!accounts.length && !busy && !error ? <div className="space-y-3 rounded-lg border p-6"><h2 className="font-medium">Start with one calendar</h2><p className="max-w-lg text-sm text-muted-foreground">Bring in your existing plans. Add work or another account whenever you like. You choose which calendars appear.</p><Button onClick={() => void action(async () => { await connectCalendar(); setNotice('Finish connecting in Google, then return here.'); })}>Connect Google Calendar</Button><p className="text-xs text-muted-foreground">Connections are encrypted on our service. Google events are fetched while you use the app. You can disconnect at any time.</p></div> : <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2"><Button variant="outline" aria-label="Previous day or week" onClick={() => setDay(dayAfter(day, -count))}><ChevronLeft className="size-4" /></Button><Button variant="outline" onClick={() => setDay(dayString(new Date()))}>Today</Button><Button variant="outline" aria-label="Next day or week" onClick={() => setDay(dayAfter(day, count))}><ChevronRight className="size-4" /></Button>
              <Popover><PopoverTrigger render={<Button variant="ghost" className="max-w-full whitespace-normal text-left" />}>{dateLabel(day)}</PopoverTrigger><PopoverPopup><DatePicker mode="single" defaultMonth={new Date(`${day}T12:00:00`)} selected={new Date(`${day}T12:00:00`)} onSelect={(d) => d && selectDay(dayString(d))} /></PopoverPopup></Popover>
            </div>
            <Tabs value={view} onValueChange={(v) => setView(String(v))}><TabsList><TabsTab value="day">Day</TabsTab><TabsTab value="week">Next 7 days</TabsTab></TabsList></Tabs>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{zone} · {shown.length} visible calendars · {busy ? 'Refreshing…' : synced ? `Checked ${clock(synced)}` : 'Not refreshed yet'}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}><RefreshCw className="size-4" />Refresh</Button></div>
          {view === 'day' && day === dayString(new Date()) && synced > 0 && <section className="space-y-3 rounded-lg bg-muted/40 p-4" aria-label="Your next step"><p className="text-xs font-medium text-muted-foreground">{error ? 'CHECK CONNECTION' : next ? eventStart(next) <= now ? 'HAPPENING NOW' : 'UP NEXT' : 'ROOM TO BREATHE'}</p><p className="font-medium">{error ? 'Some calendars could not refresh. Your plan may be incomplete.' : next ? `${next.summary || 'Untitled'} · ${clock(eventStart(next))}` : 'No more timed events today.'}</p><div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!free || !canWrite || busy} onClick={() => setEdit({ at: free || undefined })}>Plan 25 minutes of focus</Button><span className="text-xs text-muted-foreground">{free ? `Available at ${clock(free)} in visible calendars. Keep the rest open.` : 'Choose New event to plan your own time.'}</span></div></section>}
          {Array.from({ length: count }, (_, i) => dayAfter(day, i)).map((date) => {
            const start = new Date(`${date}T00:00:00`).getTime(), end = new Date(`${dayAfter(date, 1)}T00:00:00`).getTime();
            const items = events.filter((e) => eventStart(e) < end && eventEnd(e) > start);
            return <section key={date} className="space-y-2"><h2 className="text-sm font-medium">{dateLabel(date)}</h2>{items.length ? <Table className="table-fixed"><TableHeader><TableRow><TableHead className="w-24">Time</TableHead><TableHead>Plan</TableHead><TableHead className="hidden w-48 @xl/calendar:table-cell">Calendar</TableHead></TableRow></TableHeader><TableBody>{items.map((e) => {
              const overlapping = items.some((other) => other !== e && e.start.dateTime && other.start.dateTime && e.transparency !== 'transparent' && other.transparency !== 'transparent' && eventStart(e) < eventEnd(other) && eventEnd(e) > eventStart(other));
              return <TableRow key={`${calendarKey(e.calendar)}:${e.id}`}><TableCell className="align-top text-xs tabular-nums">{e.start.date ? 'All day' : <>{clock(eventStart(e))}<br /><span className="text-muted-foreground">{clock(eventEnd(e))}</span></>}</TableCell><TableCell className="min-w-0"><Button variant="ghost" className="h-auto min-w-0 max-w-full justify-start whitespace-normal px-0 text-left [overflow-wrap:anywhere]" onClick={() => setEdit({ event: e })}>{e.summary || 'Untitled'}</Button><p className="truncate text-xs text-muted-foreground">{[e.recurringEventId && 'Repeats', overlapping && 'Overlaps another plan', e.location, !writable(e.calendar) && 'Read-only'].filter(Boolean).join(' · ')}</p><p className="truncate text-xs text-muted-foreground @xl/calendar:hidden">{e.calendar.summary}</p></TableCell><TableCell className="hidden @xl/calendar:table-cell"><p className="truncate text-xs">{e.calendar.summary}</p><p className="truncate text-xs text-muted-foreground">{e.calendar.email}</p></TableCell></TableRow>;
            })}</TableBody></Table> : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{busy ? 'Loading your plans…' : !synced || error ? 'Refresh to see your plans.' : !shown.length ? 'Choose calendars to show from Calendars.' : 'Nothing planned. You can leave it that way.'}</p>}</section>;
          })}
          <p className="text-xs text-muted-foreground">Ask an agent beside any note: “Find 25 minutes for this tomorrow.” Calendar changes follow your agent approval settings.</p>
        </>}
      </>}
    </div>
    <Dialog open={settings} onOpenChange={setSettings}><DialogPopup className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Your calendars</DialogTitle><DialogDescription>Show what matters. Hiding a calendar does not change it in Google.</DialogDescription></DialogHeader><div className="space-y-5 px-6 pb-6">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{accounts.map((a) => <section key={a.account} className="space-y-3"><p className="break-all text-sm font-medium">{a.email}</p>{calendars.filter((c) => c.account === a.account).map((c) => <Field key={c.id}><FieldLabel className="text-sm font-normal"><Checkbox checked={!hidden.includes(calendarKey(c))} onCheckedChange={(v) => toggle(calendarKey(c), v)} />{c.summary}{!writable(c) && ' (read-only)'}</FieldLabel></Field>)}<Button variant="ghost" size="sm" disabled={busy} onClick={() => void action(async () => { await calendarApi('disconnect', { account: a.account }); setEvents((old) => old.filter((e) => e.calendar.account !== a.account)); await refresh(); })}>Disconnect {a.email}</Button></section>)}<Button disabled={busy || !owner} onClick={() => void action(async () => { await connectCalendar(); setNotice('Finish connecting in Google, then return here.'); })}>{accounts.length ? 'Add or reconnect Google account' : 'Connect Google Calendar'}</Button><p className="text-xs text-muted-foreground">Disconnect removes our saved access. It does not delete Google events. You can also remove LeadingLight in your Google account’s connected apps.</p></div></DialogPopup></Dialog>
    {edit && <EventEditor calendars={calendars} preferred={shown.find((c) => writable(c) && c.primary) || shown.find(writable)} initial={edit.event} focus={edit.at !== undefined} at={edit.at ?? new Date(`${day}T09:00:00`).getTime()} onClose={() => setEdit(null)} onSaved={(removed) => { setEdit(null); setNotice(removed ? 'Deleted from Google Calendar.' : 'Saved to Google Calendar.'); void refresh(); }} />}
  </div>;
}

function EventEditor({ calendars, preferred, initial, at, focus, onClose, onSaved }: { calendars: Calendar[]; preferred?: Calendar; initial?: CalendarEvent; at: number; focus: boolean; onClose: () => void; onSaved: (removed: boolean) => void }) {
  const [selected, setSelected] = useState(initial ? calendarKey(initial.calendar) : calendarKey(preferred || calendars.find((c) => writable(c) && c.primary) || calendars.find(writable)!));
  const calendar = calendars.find((c) => calendarKey(c) === selected) || initial?.calendar;
  const [title, setTitle] = useState(initial?.summary || (focus ? 'Focus time' : ''));
  const [allDay, setAllDay] = useState(!!initial?.start.date);
  const [start, setStart] = useState(initial?.start.date || localTime(initial ? eventStart(initial) : at));
  const [end, setEnd] = useState(initial?.end.date || localTime(initial ? eventEnd(initial) : at + 25 * 60000));
  const [location, setLocation] = useState(initial?.location || ''), [description, setDescription] = useState(initial?.description || '');
  const [repeat, setRepeat] = useState('none'), [repeats, setRepeats] = useState('12');
  const [guests, setGuests] = useState(initial?.attendees?.map((a) => a.email).join(', ') || '');
  const [reminder, setReminder] = useState('default'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState(false);
  const repeatChoices = { none: 'Does not repeat', DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };
  const reminderChoices = { default: initial ? 'Keep current reminders' : 'Calendar default', none: 'No reminder', '5': '5 minutes before', '10': '10 minutes before', '30': '30 minutes before' };
  const requestId = useRef(crypto.randomUUID());
  const readonly = !calendar || !writable(calendar) || !!initial?.eventType && initial.eventType !== 'default';
  const save = async (remove = false) => {
    if (!calendar || readonly || busy) return;
    setError(''); setBusy(true);
    try {
      const startDate = allDay ? start : new Date(start).toISOString(), endDate = allDay ? end : new Date(end).toISOString();
      if (!remove && (!title.trim() || !(Date.parse(endDate) > Date.parse(startDate)))) throw new Error('Add a title and an end after the start.');
      const originalGuests = initial?.attendees?.map((a) => a.email).join(', ') || '';
      const details = {
        summary: title, description, location,
        start: allDay ? { date: startDate } : { dateTime: startDate, timeZone: zone },
        end: allDay ? { date: endDate } : { dateTime: endDate, timeZone: zone },
        ...(!initial && repeat !== 'none' && { recurrence: [`RRULE:FREQ=${repeat};COUNT=${Number(repeats)}`] }),
        ...(guests !== originalGuests && { attendees: guests.split(',').map((email) => email.trim()).filter(Boolean).map((email) => ({ email })) }),
        ...(reminder !== 'default' && { reminders: { useDefault: false, overrides: reminder === 'none' ? [] : [{ method: 'popup', minutes: Number(reminder) }] } }),
      };
      if (initial && allDay === !!initial.start.date && start === (initial.start.date || localTime(eventStart(initial))) && end === (initial.end.date || localTime(eventEnd(initial)))) {
        details.start = initial.start as typeof details.start; details.end = initial.end as typeof details.end;
      }
      await changeCalendar(remove ? 'delete' : initial ? 'update' : 'create', { account: calendar.account, calendar: calendar.id, ...(initial ? { event: initial.id, etag: initial.etag } : { requestId: requestId.current }), ...(!remove && { details }) });
      onSaved(remove);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogPopup className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{initial ? 'Event details' : 'Make a little room'}</DialogTitle><DialogDescription>{initial?.recurringEventId ? 'Changes apply only to this occurrence.' : 'A plan can be small. You can always change it.'}</DialogDescription></DialogHeader><form className="space-y-4 px-6 pb-6" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {readonly && <p role="status" className="text-sm text-muted-foreground">This event is read-only here.</p>}
    <Field><FieldLabel>Title</FieldLabel><Input autoFocus value={title} required disabled={readonly || busy} onChange={(e) => setTitle(e.target.value)} placeholder="Focus, a walk, dinner with a friend…" /></Field>
    <Field><FieldLabel>Calendar</FieldLabel><Select value={selected} disabled={!!initial || busy} onValueChange={(v) => v && setSelected(v)}><SelectTrigger className="w-full"><SelectValue>{calendar ? `${calendar.summary} · ${calendar.email}` : 'Choose a calendar'}</SelectValue></SelectTrigger><SelectPopup>{calendars.filter(writable).map((c) => <SelectItem key={calendarKey(c)} value={calendarKey(c)}>{c.summary} · {c.email}</SelectItem>)}</SelectPopup></Select></Field>
    <Field><FieldLabel><Checkbox disabled={readonly || busy} checked={allDay} onCheckedChange={(v) => { setAllDay(v); setStart(v ? start.slice(0, 10) : `${start}T09:00`); setEnd(v ? dayAfter(start.slice(0, 10), 1) : `${start}T09:25`); }} />All day</FieldLabel></Field>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field><FieldLabel>Starts</FieldLabel><Input type={allDay ? 'date' : 'datetime-local'} value={start} required disabled={readonly || busy} onChange={(e) => setStart(e.target.value)} /></Field><Field><FieldLabel>{allDay ? 'Ends before' : 'Ends'}</FieldLabel><Input type={allDay ? 'date' : 'datetime-local'} value={end} required disabled={readonly || busy} onChange={(e) => setEnd(e.target.value)} /></Field></div>
    <p className="text-xs text-muted-foreground">{allDay ? 'The end date is the first day after your event.' : `Times in ${zone}. Google shows guests their local time.`}</p>
    <Collapsible defaultOpen={!!(initial?.description || initial?.location || initial?.attendees?.length)}><CollapsibleTrigger render={<Button type="button" variant="ghost" />}>Details, repeat and reminders</CollapsibleTrigger><CollapsiblePanel><div className="space-y-4 py-3">
    {!initial && <div className="flex gap-3"><Field className="flex-1"><FieldLabel>Repeat</FieldLabel><Select items={repeatChoices} value={repeat} disabled={busy} onValueChange={(v) => v && setRepeat(v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectPopup>{Object.entries(repeatChoices).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectPopup></Select></Field>{repeat !== 'none' && <Field className="w-28"><FieldLabel>Occurrences</FieldLabel><Input type="number" min={1} max={400} value={repeats} disabled={busy} onChange={(e) => setRepeats(e.target.value)} /></Field>}</div>}
    <Field><FieldLabel>Location</FieldLabel><Input value={location} disabled={readonly || busy} onChange={(e) => setLocation(e.target.value)} /></Field>
    <Field><FieldLabel>Notes</FieldLabel><Textarea value={description} disabled={readonly || busy} onChange={(e) => setDescription(e.target.value)} /></Field>
    <Field><FieldLabel>Guests</FieldLabel><Input value={guests} disabled={readonly || busy} onChange={(e) => setGuests(e.target.value)} placeholder="Email addresses, separated by commas" /><p className="text-xs text-muted-foreground">Saving changes sends updates to guests.</p></Field>
    <Field><FieldLabel>Reminder</FieldLabel><Select items={reminderChoices} value={reminder} disabled={readonly || busy} onValueChange={(v) => v && setReminder(v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectPopup>{Object.entries(reminderChoices).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectPopup></Select><p className="text-xs text-muted-foreground">Delivered by Google Calendar on your connected devices.</p></Field>
    </div></CollapsiblePanel></Collapsible>
    {deleting && <p role="alert" className="text-sm">Delete {initial?.recurringEventId ? 'this occurrence' : 'this event'} from Google Calendar? Guests will be notified.</p>}
    <div className="flex flex-wrap justify-end gap-2">{initial && !readonly && <Button type="button" variant="destructive" disabled={busy} onClick={() => deleting ? void save(true) : setDeleting(true)}>{deleting ? 'Confirm delete' : 'Delete event'}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={onClose}>{readonly ? 'Close' : 'Cancel'}</Button>{!readonly && <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save to Google'}</Button>}</div>
  </form></DialogPopup></Dialog>;
}
