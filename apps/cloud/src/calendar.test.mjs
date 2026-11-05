import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { calendarRequest, calendarCallback, seal, unseal, eventBody } from './calendar.mjs';
import { application } from './app.mjs';
import { nativeRoute } from './native.mjs';
import { database } from './database.mjs';

const env = { APP_ORIGIN: 'https://notes.test', CLOUD_ACCESS: 'public', GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test', CALENDAR_TOKEN_KEY: randomBytes(32).toString('base64') };
const details = { summary: 'Focus', start: { dateTime: '2026-11-04T09:00:00-08:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-11-04T09:25:00-08:00', timeZone: 'America/Los_Angeles' } };
const response = (data, status = 200) => Response.json(data, { status });

// Seam: saved grants and write payloads must not cross owners or bypass version checks.
test('grant encryption binds owner; date and recurrence validation reject unsafe writes', () => {
  const ciphertext = seal(env, 'owner:google', { refresh_token: 'private' });
  assert.equal(unseal(env, 'owner:google', ciphertext).refresh_token, 'private');
  assert.throws(() => unseal(env, 'other:google', ciphertext));
  assert.throws(() => unseal({ ...env, CALENDAR_TOKEN_KEY: randomBytes(32).toString('base64') }, 'owner:google', ciphertext));
  assert.deepEqual(eventBody(details, true), details);
  assert.deepEqual(eventBody({ summary: 'Title only' }, false), { summary: 'Title only' });
  for (const bad of [
    { ...details, end: details.start },
    { ...details, start: { dateTime: '2026-11-04T09:00:00' } },
    { ...details, start: { date: '2026-02-30' }, end: { date: '2026-03-03' } },
    { ...details, recurrence: ['RRULE:FREQ=DAILY'] },
    { ...details, attendees: [{ email: 'invalid' }] },
    { ...details, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: -1 }] } },
  ]) assert.throws(() => eventBody(bad, true));
  assert.throws(() => eventBody({ recurrence: ['RRULE:FREQ=WEEKLY;COUNT=12'] }, false));
  assert.deepEqual(eventBody({ summary: 'Holiday', start: { date: '2026-11-03' }, end: { date: '2026-11-04' } }, true).start, { date: '2026-11-03' });
});

test('calendar routes enforce login, owner, origin, rollout and native route limits', async () => {
  let touched = false;
  const app = application({ env, sql: () => { touched = true; throw Error(); }, auth: { ready: true, providers: [], user: async (r) => r.headers.has('test-user') ? { id: r.headers.get('test-user') } : null } });
  const req = (headers = {}, method = 'POST') => new Request(`${env.APP_ORIGIN}/api/calendar/create`, { method, headers, ...(method === 'POST' && { body: '{}' }) });
  assert.equal((await app(req({ origin: env.APP_ORIGIN }))).status, 401);
  assert.equal((await app(req({ origin: 'https://evil.test', 'test-user': 'alice' }))).status, 403);
  assert.equal((await app(req({ origin: env.APP_ORIGIN, 'test-user': 'alice', 'x-leadinglight-owner': 'bob' }))).status, 409);
  assert.equal(touched, false);
  assert.equal(nativeRoute(req({}, 'GET')), false);
  assert.equal(nativeRoute(req()), true);
  assert.equal(nativeRoute(new Request(`${env.APP_ORIGIN}/api/calendar/callback`)), false);
});

// Seam: actual PostgreSQL ownership, one-use OAuth state and Google conditional writes.
test('OAuth, multiple accounts, refresh, paging, permissions and idempotent writes', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = database(process.env.TEST_DATABASE_URL), owner = randomUUID(), other = randomUUID();
  const calls = []; let account = 'personal', readonly = false, conflict = false, expired = false, duplicate = false, eventId, created;
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/token')) return response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events' });
    if (String(url).includes('/userinfo')) return response({ sub: account, email: `${account}@test.example` });
    if (expired) return response({}, 401);
    if (String(url).includes('/calendarList?')) return response({ items: [{ id: 'primary', summary: 'Personal', accessRole: 'owner' }], ...(!String(url).includes('pageToken') && { nextPageToken: 'second' }) });
    if (String(url).includes('/calendarList/')) return response({ accessRole: readonly ? 'reader' : 'owner' });
    if (options.method === 'POST') { eventId = JSON.parse(options.body).id; if (!duplicate) created = JSON.parse(options.body); return response({ id: eventId }, duplicate ? 409 : 200); }
    if (options.method === 'PATCH' || options.method === 'DELETE') { assert.equal(options.headers['If-Match'], '"v1"'); return conflict ? response({}, 412) : options.method === 'DELETE' ? new Response(null, { status: 204 }) : response({ id: 'event', ...JSON.parse(options.body) }); }
    return response({ ...created, id: eventId || 'event', etag: '"v1"' });
  };
  const run = (action, body, user = owner) => calendarRequest({ request: new Request(`${env.APP_ORIGIN}/api/calendar/${action}`, { method: body ? 'POST' : 'GET', ...(body && { body: JSON.stringify(body) }) }), env, sql, user: { id: user }, readBody: (r) => r.json(), fetcher });
  const connect = async () => {
    const { url } = await (await run('connect', {})).json();
    const authorization = new URL(url);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    return new Request(`${env.APP_ORIGIN}/api/calendar/callback?state=${authorization.searchParams.get('state')}&code=code`);
  };
  const callback = (request, user = owner) => calendarCallback({ request, env, sql, user: { id: user }, fetcher });
  try {
    await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    let request = await connect();
    await assert.rejects(callback(request, other), /another workspace/);
    assert.equal((await callback(request)).status, 303);
    await assert.rejects(callback(request), /expired/);
    await callback(await connect());
    account = 'work'; await callback(await connect());
    assert.equal((await (await run('accounts')).json()).accounts.length, 2);
    assert.equal((await (await run('accounts', undefined, other)).json()).accounts.length, 0);
    const cancel = new URL((await connect()).url); cancel.searchParams.set('error', 'access_denied');
    assert.match((await callback(new Request(cancel))).headers.get('location'), /cancelled/);
    const rows = await sql`SELECT tokens FROM calendar_accounts WHERE owner=${owner}`;
    assert.equal(rows.some((r) => r.tokens.includes('refresh')), false);
    const target = { account: 'personal', calendar: 'primary' };
    await assert.rejects(run('create', { ...target, details, requestId: 'first' }, other), /Connect this Google account/);
    const page = await (await run('calendars', { account: 'personal' })).json(); assert.equal(page.calendars.length, 2);
    readonly = true; await assert.rejects(run('create', { ...target, details, requestId: 'first' }), /read-only/); readonly = false;
    const first = await (await run('create', { ...target, details, requestId: 'first' })).json();
    duplicate = true; const second = await (await run('create', { ...target, details, requestId: 'first' })).json();
    assert.equal(first.event.id, second.event.id); assert.equal(second.alreadyCreated, true);
    await assert.rejects(run('create', { ...target, details: { ...details, summary: 'Different intent' }, requestId: 'first' }), /different details/);
    await assert.rejects(run('update', { ...target, event: 'event', etag: '*', details: { summary: 'Change' } }), /exact etag/);
    conflict = true; await assert.rejects(run('update', { ...target, event: 'event', etag: '"v1"', details: { summary: 'Change' } }), /changed in Google/);
    conflict = false; assert.equal((await (await run('delete', { ...target, event: 'event', etag: '"v1"' })).json()).deleted, true);
    await sql`UPDATE calendar_accounts SET tokens=${seal(env, `${owner}:personal`, { access_token: 'expired', refresh_token: 'refresh', expires: 0 })} WHERE owner=${owner} AND account='personal'`;
    await run('calendars', { account: 'personal' });
    assert.ok(calls.some((c) => c.options.body instanceof URLSearchParams && c.options.body.get('grant_type') === 'refresh_token'));
    expired = true; await assert.rejects(run('calendars', { account: 'personal' }), /Reconnect/); expired = false;
    await run('disconnect', { account: 'personal' });
    assert.equal((await (await run('accounts')).json()).accounts.length, 1);
  } finally { await sql`DELETE FROM calendar_accounts WHERE owner=${owner}`; await sql`DELETE FROM calendar_oauth WHERE owner=${owner}`; await sql.end(); }
});
