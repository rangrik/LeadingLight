import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { NativeError } from './native.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const need = (ok, status, message) => { if (!ok) throw new NativeError(status, message); };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const scopes = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'];
const base = 'https://www.googleapis.com/calendar/v3';
const string = (s, max = 1024) => typeof s === 'string' && s.length > 0 && s.length <= max;
export const calendarReady = (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && /^[A-Za-z0-9+/]{43}=$/.test(env.CALENDAR_TOKEN_KEY || ''));

// Binding ciphertext to its owner prevents moving a saved grant between workspaces.
export function seal(env, owner, value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(env.CALENDAR_TOKEN_KEY, 'base64'), iv);
  cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function unseal(env, owner, value) {
  const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', Buffer.from(env.CALENDAR_TOKEN_KEY, 'base64'), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(owner)); cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
}
async function google(url, options = {}, fetcher = fetch) {
  let response;
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new NativeError(503, 'Google could not be reached. Refresh before retrying; your last change may have reached Google.'); }
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = { 401: 'Google access expired. Reconnect this account.', 403: 'Google refused access. Check calendar permissions or your work account policy.', 404: 'This calendar or event is no longer available. Refresh your plan.', 409: 'This event already exists. Refresh your plan.', 412: 'This event changed in Google. Refresh and reopen it before saving.', 429: 'Google is busy. Wait a moment, then refresh.' };
    throw new NativeError(response.status === 400 ? 400 : response.status, data.error === 'invalid_grant' ? 'Google access expired. Reconnect this account.' : messages[response.status] || 'Google could not save this request. Check its dates and permissions, then retry.');
  }
  return data;
}
const callbackUrl = (env) => `${new URL(env.APP_ORIGIN).origin}/api/calendar/callback`;
const tokenRequest = (env, params, fetcher) => google('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }) }, fetcher);

async function grant({ env, sql, user, account, fetcher }) {
  need(string(account), 400, 'Choose a Google account.');
  const [row] = await sql`SELECT tokens FROM calendar_accounts WHERE owner=${user.id} AND account=${account}`;
  need(row, 404, 'Connect this Google account first.');
  let tokens = unseal(env, `${user.id}:${account}`, row.tokens);
  if (tokens.expires < Date.now() + 60_000) {
    const refreshed = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, fetcher);
    tokens = { ...tokens, ...refreshed, expires: Date.now() + refreshed.expires_in * 1000 };
    await sql`UPDATE calendar_accounts SET tokens=${seal(env, `${user.id}:${account}`, tokens)} WHERE owner=${user.id} AND account=${account}`;
  }
  return (path, options = {}) => google(`${base}${path}`, { ...options, headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', ...options.headers } }, fetcher);
}
async function pages(api, path, params = {}) {
  const items = []; let token;
  for (let n = 0; n < 100; n++) {
    const result = await api(`${path}?${new URLSearchParams({ ...params, maxResults: '250', ...(token && { pageToken: token }) })}`);
    items.push(...(result.items || [])); token = result.nextPageToken;
    if (!token) return items;
  }
  throw new NativeError(413, 'Too many results. Choose a shorter date range.');
}
const dateOnly = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const instant = (x) => typeof x === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
export function eventBody(value, creating) {
  need(value && typeof value === 'object' && !Array.isArray(value), 400, 'Supply event details.');
  const out = {};
  for (const name of ['summary', 'description', 'location']) if (value[name] !== undefined) {
    need(typeof value[name] === 'string' && value[name].length <= (name === 'description' ? 16000 : 1000), 400, `Invalid ${name}.`);
    out[name] = value[name].trim();
  }
  if (creating || value.summary !== undefined) need(out.summary?.length, 400, 'Give the event a title.');
  if (creating || value.start || value.end) {
    const { start, end } = value;
    need(start && end, 400, 'Provide both start and end.');
    const allDay = dateOnly(start.date) && dateOnly(end.date) && !start.dateTime && !end.dateTime;
    need(allDay || !start.date && !end.date && instant(start.dateTime) && instant(end.dateTime), 400, 'Use dates for all-day events or times with UTC offsets.');
    need(Date.parse(allDay ? end.date : end.dateTime) > Date.parse(allDay ? start.date : start.dateTime), 400, 'The end must be after the start. All-day ends are exclusive.');
    for (const name of ['start', 'end']) {
      const t = value[name];
      if (t.timeZone) { try { new Intl.DateTimeFormat('en', { timeZone: t.timeZone }); } catch { throw new NativeError(400, 'Use a valid IANA timezone.'); } }
      out[name] = allDay ? { date: t.date } : { dateTime: t.dateTime, ...(t.timeZone && { timeZone: t.timeZone }) };
    }
  }
  if (value.recurrence !== undefined) {
    need(creating && Array.isArray(value.recurrence) && value.recurrence.length <= 1 && value.recurrence.every((r) => /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY);COUNT=([1-9]\d?|[1-3]\d\d|400)$/.test(r)), 400, 'New series support daily, weekly or monthly repeats, up to 400 occurrences. Edit existing occurrences individually.');
    need(!value.recurrence.length || out.start?.date || out.start?.timeZone, 400, 'Recurring timed events need a timezone.');
    out.recurrence = value.recurrence;
  }
  if (value.attendees !== undefined) {
    need(Array.isArray(value.attendees) && value.attendees.length <= 100 && value.attendees.every((a) => string(a?.email, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)), 400, 'Enter valid guest email addresses.');
    out.attendees = value.attendees.map((a) => ({ email: a.email }));
  }
  if (value.reminders !== undefined) {
    need(typeof value.reminders?.useDefault === 'boolean' && (!value.reminders.overrides || Array.isArray(value.reminders.overrides) && value.reminders.overrides.length <= 5 && value.reminders.overrides.every((r) => ['popup', 'email'].includes(r?.method) && Number.isInteger(r.minutes) && r.minutes >= 0 && r.minutes <= 40320)), 400, 'Invalid reminders.');
    out.reminders = { useDefault: value.reminders.useDefault, ...(!value.reminders.useDefault && { overrides: (value.reminders.overrides || []).map(({ method, minutes }) => ({ method, minutes })) }) };
  }
  return out;
}

export async function calendarRequest({ request, env, sql, user, readBody, fetcher = fetch }) {
  need(calendarReady(env), 503, 'Google Calendar is not configured on this installation yet.');
  const path = new URL(request.url).pathname;
  if (path === '/api/calendar/accounts' && request.method === 'GET') {
    const accounts = await sql`SELECT account,email FROM calendar_accounts WHERE owner=${user.id} ORDER BY email`;
    return json({ accounts });
  }
  need(request.method === 'POST', 405, 'Use POST for calendar actions.');
  const body = await readBody(request, 32_000);
  if (path === '/api/calendar/connect') {
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    await sql`DELETE FROM calendar_oauth WHERE expires_at<now()`;
    await sql`INSERT INTO calendar_oauth(state,owner,verifier) VALUES(${hash(state)},${user.id},${seal(env, user.id, verifier)})`;
    const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callbackUrl(env), response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent select_account', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }
  if (path === '/api/calendar/disconnect') {
    need(string(body.account), 400, 'Choose an account.');
    await sql`DELETE FROM calendar_accounts WHERE owner=${user.id} AND account=${body.account}`;
    return json({ ok: true });
  }
  const api = await grant({ env, sql, user, account: body.account, fetcher });
  if (path === '/api/calendar/calendars') return json({ calendars: await pages(api, '/users/me/calendarList', { minAccessRole: 'reader' }) });
  need(string(body.calendar), 400, 'Choose a calendar.');
  const root = `/calendars/${encodeURIComponent(body.calendar)}`;
  if (path === '/api/calendar/events') {
    need(instant(body.start) && instant(body.end) && Date.parse(body.end) > Date.parse(body.start) && Date.parse(body.end) - Date.parse(body.start) <= 93 * 86400000, 400, 'Choose a date range of up to 93 days, with UTC offsets.');
    return json({ events: await pages(api, `${root}/events`, { timeMin: body.start, timeMax: body.end, singleEvents: 'true', orderBy: 'startTime' }) });
  }
  need(['/api/calendar/create', '/api/calendar/update', '/api/calendar/delete'].includes(path), 404, 'Unknown calendar action.');
  const cal = await api(`/users/me/calendarList/${encodeURIComponent(body.calendar)}`);
  need(['owner', 'writer'].includes(cal.accessRole), 403, 'This calendar is read-only. Choose one you can edit.');
  const creating = path.endsWith('/create'), deleting = path.endsWith('/delete');
  if (!creating) {
    need(string(body.event, 1024) && string(body.etag, 256) && /^"[^"\r\n]+"$/.test(body.etag), 400, 'Read the event first and supply its event ID and exact etag.');
    const current = await api(`${root}/events/${encodeURIComponent(body.event)}`);
    need(!current.recurrence?.length, 400, 'Edit a single occurrence from the date-range event list, not the whole series.');
    need(!current.eventType || current.eventType === 'default', 400, 'Edit this special Google event in Google Calendar.');
  }
  let event = creating || !deleting ? eventBody(body.details, creating) : undefined;
  if (creating) {
    need(string(body.requestId, 200), 400, 'Supply a stable requestId so retries cannot create duplicates.');
    event.extendedProperties = { private: { leadinglightPayload: hash(JSON.stringify(event)) } };
    event.id = hash(`${user.id}:${body.account}:${body.calendar}:${body.requestId}`);
  }
  const eventPath = `${root}/events${creating ? '' : `/${encodeURIComponent(body.event)}`}`;
  try {
    const saved = await api(`${eventPath}?sendUpdates=all`, { method: creating ? 'POST' : deleting ? 'DELETE' : 'PATCH', ...(!creating && { headers: { 'If-Match': body.etag } }), ...(event && { body: JSON.stringify(event) }) });
    return json(deleting ? { deleted: true } : { event: saved });
  } catch (error) {
    if (creating && error.status === 409) {
      const existing = await api(`${root}/events/${event.id}`);
      need(existing.extendedProperties?.private?.leadinglightPayload === event.extendedProperties.private.leadinglightPayload, 409, 'An earlier attempt already created this event with different details. Refresh your calendar, open that event and apply your changes there.');
      return json({ event: existing, alreadyCreated: true });
    }
    throw error;
  }
}

export async function calendarCallback({ request, env, sql, user, fetcher = fetch }) {
  need(calendarReady(env), 503, 'Google Calendar is not configured.');
  need(request.method === 'GET', 405, 'Use the Google callback link.');
  const params = new URL(request.url).searchParams, state = params.get('state');
  need(string(state, 100), 400, 'Invalid Google connection. Start again from Calendar.');
  const [pending] = await sql`DELETE FROM calendar_oauth WHERE state=${hash(state)} AND owner=${user.id} AND expires_at>now() RETURNING verifier`;
  need(pending, 400, 'This Google connection expired or belongs to another workspace. Start again from Calendar.');
  if (params.has('error')) return Response.redirect(`${env.APP_ORIGIN}/?calendar=cancelled`, 303);
  need(string(params.get('code'), 4096), 400, 'Google did not return an authorization code.');
  const tokens = await tokenRequest(env, { code: params.get('code'), grant_type: 'authorization_code', redirect_uri: callbackUrl(env), code_verifier: unseal(env, user.id, pending.verifier) }, fetcher);
  const granted = (tokens.scope || '').split(' ');
  need(scopes.slice(2).every((s) => granted.includes(s)), 403, 'Allow both calendar permissions when connecting Google.');
  const profile = await google('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } }, fetcher);
  need(string(profile.sub) && string(profile.email), 400, 'Google did not identify this account.');
  const [old] = await sql`SELECT tokens FROM calendar_accounts WHERE owner=${user.id} AND account=${profile.sub}`;
  if (!tokens.refresh_token && old) tokens.refresh_token = unseal(env, `${user.id}:${profile.sub}`, old.tokens).refresh_token;
  need(tokens.refresh_token, 400, 'Google did not grant background access. Reconnect with consent.');
  tokens.expires = Date.now() + tokens.expires_in * 1000;
  await sql`INSERT INTO calendar_accounts(owner,account,email,tokens) VALUES(${user.id},${profile.sub},${profile.email},${seal(env, `${user.id}:${profile.sub}`, tokens)}) ON CONFLICT(owner,account) DO UPDATE SET email=excluded.email,tokens=excluded.tokens`;
  return Response.redirect(`${env.APP_ORIGIN}/?calendar=connected`, 303);
}
