import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { application } from './app.mjs';
import { database } from './database.mjs';

const origin = 'https://notes.test', options = { skip: !process.env.TEST_DATABASE_URL };
const sha = (text) => createHash('sha256').update(text).digest('hex');
function encrypted(text = 'Private page words') {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', randomBytes(32), iv);
  return { v: 1, iv: iv.toString('base64'), data: Buffer.concat([cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString('base64') };
}
async function fixture(run) {
  const sql = database(process.env.TEST_DATABASE_URL), owner = `relay-${randomUUID()}`, stranger = `other-${randomUUID()}`;
  await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const env = { APP_ORIGIN: origin, CLOUD_ALLOWED_USERS: owner };
  const auth = { ready: true, providers: [], user: async (req) => req.headers.has('test-user') ? { id: req.headers.get('test-user'), name: 'Test account' } : null };
  const app = application({ env, sql, auth });
  const browser = (path, body, method = body ? 'POST' : 'GET', user = owner) => app(new Request(origin + '/api/relay/' + path, { method, headers: { origin, ...(user ? { 'test-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const native = (path, body, token, extra = {}) => app(new Request(origin + '/api/relay/device/' + path, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) }));
  const connect = async (approve = true) => {
    const id = randomUUID(), secret = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
    const inviteHash = sha(`LeadingLight pairing v1:${id}:${secret}`), credentialHash = sha(token);
    assert.equal((await browser('pairs', { id, browserName: 'Test browser', inviteHash })).status, 201);
    assert.equal((await native('claim', { pairId: id, inviteHash, credentialHash, macName: 'Test Mac' })).status, 200);
    if (approve) assert.equal((await native('approve', { pairId: id }, token)).status, 200);
    return { id, secret, token, inviteHash, credentialHash };
  };
  try { await run({ sql, owner, stranger, app, browser, native, connect }); }
  finally {
    await sql`DELETE FROM relay_runs WHERE pair_id IN (SELECT id FROM relay_pairs WHERE owner IN (${owner},${stranger}))`;
    await sql`DELETE FROM relay_pairs WHERE owner IN (${owner},${stranger})`; await sql.end();
  }
}

// Seam: only the invited Mac and signed-in owner may approve and use a connection.
test('pair approval is single-use, account-bound, and secret-free in public metadata', options, () => fixture(async ({ sql, owner, stranger, app, browser, native, connect }) => {
  assert.equal((await browser('pairs', { id: randomUUID(), browserName: 'Other', inviteHash: sha('other') }, 'POST', stranger)).status, 403);
  assert.equal((await browser('pairs', undefined, 'GET', null)).status, 401);
  const p = await connect(false), path = `pairs/${p.id}`;
  assert.equal((await browser(path + '/control', { controller: randomUUID() })).status, 410);
  assert.equal((await browser(path + '/control', { controller: randomUUID() }, 'POST', stranger)).status, 403);
  assert.equal((await browser(path + '/events?controller=' + randomUUID(), undefined, 'GET', stranger)).status, 404);
  assert.equal((await native('approve', { pairId: p.id }, p.token, { origin })).status, 403);
  assert.equal((await native('approve', { pairId: p.id }, randomBytes(32).toString('base64url'))).status, 403);
  assert.equal((await native('claim', { pairId: p.id, inviteHash: p.inviteHash, credentialHash: sha('another'), macName: 'Other Mac' })).status, 409);
  assert.equal((await native('approve', { pairId: p.id }, p.token)).status, 200);
  assert.equal((await native('approve', { pairId: p.id }, p.token)).status, 200);
  const metadata = JSON.stringify(await (await browser('pairs')).json());
  assert.ok(metadata.includes('Test Mac')); assert.ok(!metadata.includes(p.inviteHash)); assert.ok(!metadata.includes(p.credentialHash));
  const [stored] = await sql`SELECT * FROM relay_pairs WHERE id=${p.id}`;
  assert.equal(stored.owner, owner); assert.equal(stored.credential_hash, p.credentialHash);
  assert.ok(!JSON.stringify(stored).includes(p.token)); assert.ok(!JSON.stringify(stored).includes(p.secret));
  const rejectedOrigin = await app(new Request(origin + '/api/relay/pairs/' + p.id, { method: 'DELETE', headers: { origin: 'https://other.test', 'test-user': owner } }));
  assert.equal(rejectedOrigin.status, 403);
  const pending = await connect(false);
  await sql`UPDATE relay_pairs SET expires_at=now()-interval '1 second' WHERE id=${pending.id}`;
  assert.equal((await native('approve', { pairId: pending.id }, pending.token)).status, 410);
}));

// Seam: controller takeover and retries must never duplicate or revive execution.
test('relay commands are idempotent and stop after takeover or revocation', options, () => fixture(async ({ sql, browser, native, connect }) => {
  const p = await connect(), controller = randomUUID(), path = `pairs/${p.id}`;
  const claimed = await browser(path + '/control', { controller }); assert.equal(claimed.status, 200);
  assert.equal(typeof (await claimed.json()).after, 'string');
  const status = { id: randomUUID(), envelope: encrypted('CLI status') };
  assert.equal((await native('poll', { pairId: p.id, after: '0', status }, p.token)).status, 200);
  const command = { id: randomUUID(), controller, turn: randomUUID(), kind: 'start', envelope: encrypted(), prompt: 'Never store this' };
  assert.equal((await browser(path + '/messages', command)).status, 200);
  assert.equal((await browser(path + '/messages', command)).status, 200);
  assert.equal((await browser(path + '/messages', { ...command, envelope: encrypted('Different') })).status, 409);
  assert.equal((await browser(path + '/messages', { ...command, id: randomUUID(), turn: randomUUID() })).status, 409);
  const polled = await (await native('poll', { pairId: p.id, after: '0' }, p.token)).json();
  assert.equal(polled.commands.length, 1); assert.equal(polled.commands[0].id, command.id);
  assert.ok(!JSON.stringify(polled).includes('Never store this'));
  assert.equal((await (await native('poll', { pairId: p.id, after: polled.commands[0].seq }, p.token)).json()).commands.length, 0);
  const next = randomUUID();
  assert.equal((await browser(path + '/control', { controller: next })).status, 409);
  assert.equal((await browser(path + '/control', { controller: next, takeover: true })).status, 200);
  assert.equal((await browser(path + '/events?controller=' + controller)).status, 409);
  assert.equal((await browser(path + '/messages', command)).status, 409);
  assert.equal((await sql`SELECT state FROM relay_runs WHERE pair_id=${p.id}`)[0].state, 'interrupted');
  assert.equal((await browser(path, undefined, 'DELETE')).status, 200);
  assert.equal((await native('poll', { pairId: p.id, after: '0' }, p.token)).status, 410);
  assert.equal((await browser(path + '/messages', { ...command, controller: next })).status, 410);
}));

// Seam: a failed event batch must roll back every event and run-state update together.
test('events, run states, expiration and deduplication stay atomic', options, () => fixture(async ({ sql, browser, native, connect }) => {
  const p = await connect(), controller = randomUUID(), path = `pairs/${p.id}`;
  await browser(path + '/control', { controller });
  const start = async () => {
    const command = { id: randomUUID(), controller, turn: randomUUID(), kind: 'start', envelope: encrypted() };
    assert.equal((await browser(path + '/messages', command)).status, 200); return command;
  };
  const expired = await start();
  await sql`UPDATE relay_runs SET expires_at=now()-interval '1 second' WHERE pair_id=${p.id} AND id=${expired.turn}`;
  assert.equal((await (await native('poll', { pairId: p.id, after: '0' }, p.token)).json()).commands.length, 0);
  assert.equal((await sql`SELECT state FROM relay_runs WHERE pair_id=${p.id} AND id=${expired.turn}`)[0].state, 'expired');
  const command = await start(), event = { id: randomUUID(), controller, turn: command.turn, kind: 'event', envelope: encrypted('Private tool result') };
  const badBatch = { pairId: p.id, events: [event], runs: [{ id: command.turn, state: 'running' }, { id: randomUUID(), state: 'done' }] };
  assert.equal((await native('events', badBatch, p.token)).status, 409);
  assert.equal((await sql`SELECT * FROM relay_events WHERE pair_id=${p.id}`).length, 0);
  assert.equal((await sql`SELECT state FROM relay_runs WHERE pair_id=${p.id} AND id=${command.turn}`)[0].state, 'queued');
  const batch = { ...badBatch, runs: [{ id: command.turn, state: 'running' }] };
  assert.equal((await native('events', batch, p.token)).status, 200);
  assert.equal((await native('events', batch, p.token)).status, 200);
  assert.equal((await native('events', { ...batch, events: [{ ...event, envelope: encrypted('Changed') }], runs: [{ id: command.turn, state: 'done' }] }, p.token)).status, 409);
  assert.equal((await sql`SELECT state FROM relay_runs WHERE pair_id=${p.id} AND id=${command.turn}`)[0].state, 'running');
  const fetched = await (await browser(path + `/events?controller=${controller}&after=0`)).json();
  assert.equal(fetched.events.length, 1); assert.deepEqual(fetched.events[0].envelope, event.envelope);
  assert.ok(!JSON.stringify(await sql`SELECT * FROM relay_events WHERE pair_id=${p.id}`).includes('Private tool result'));
  assert.equal((await native('events', { pairId: p.id, events: [], runs: [{ id: command.turn, state: 'done' }] }, p.token)).status, 200);
  assert.equal((await native('events', batch, p.token)).status, 200);
  await sql`UPDATE relay_events SET created_at=now()-interval '25 hours' WHERE pair_id=${p.id}`;
  await native('poll', { pairId: p.id, after: '0' }, p.token);
  assert.equal((await sql`SELECT envelope FROM relay_events WHERE pair_id=${p.id}`)[0].envelope, null);
  assert.equal((await native('events', { pairId: p.id, events: [event] }, p.token)).status, 200);
  assert.equal((await sql`SELECT count(*)::int AS n FROM relay_events WHERE pair_id=${p.id}`)[0].n, 1);
  const next = await start();
  await sql`UPDATE relay_pairs SET browser_seen=now()-interval '61 seconds' WHERE id=${p.id}`;
  assert.equal((await (await native('poll', { pairId: p.id, after: '0' }, p.token)).json()).commands.length, 0);
  assert.equal((await sql`SELECT state FROM relay_runs WHERE pair_id=${p.id} AND id=${next.turn}`)[0].state, 'interrupted');
  assert.equal((await browser(path + `/events?controller=${controller}&after=0`)).status, 409);
  assert.equal((await browser(path + '/control', { controller })).status, 409);
  assert.equal((await browser(path + '/control', { controller: randomUUID() })).status, 200);
}));

// Seam: concurrent claims and starts must honor limits before saving work.
test('concurrent starts, pending quota and cancellation before start are bounded', options, () => fixture(async ({ sql, owner, browser, native, connect }) => {
  for (let i = 0; i < 5; i++) await connect(false);
  assert.equal((await browser('pairs', { id: randomUUID(), browserName: 'Extra', inviteHash: sha('extra') })).status, 429);
  await sql`UPDATE relay_pairs SET expires_at=now()-interval '1 second' WHERE owner=${owner} AND state='review'`;
  const p = await connect(), controller = randomUUID(), path = `pairs/${p.id}`;
  await browser(path + '/control', { controller });
  const commands = [0,1].map(() => ({ id: randomUUID(), controller, turn: randomUUID(), kind: 'start', envelope: encrypted() }));
  const results = await Promise.all(commands.map((command) => browser(path + '/messages', command)));
  assert.deepEqual(results.map((response) => response.status).sort(), [200,409]);
  const turn = commands[results.findIndex((response) => response.status === 200)].turn;
  const cancel = { id: randomUUID(), controller, turn, kind: 'cancel', envelope: encrypted('Cancel') };
  assert.equal((await browser(path + '/messages', cancel)).status, 200);
  const polled = await (await native('poll', { pairId: p.id, after: '0' }, p.token)).json();
  assert.equal(polled.commands.length, 1); assert.equal(polled.commands[0].kind, 'cancel');
  assert.equal((await native('events', { pairId: p.id, events: [], runs: [{ id: turn, state: 'stopped' }] }, p.token)).status, 200);
  await sql`UPDATE relay_pairs SET last_seen=now()-interval '26 seconds' WHERE id=${p.id}`;
  assert.equal((await browser(path + '/messages', { ...commands[0], id: randomUUID(), turn: randomUUID() })).status, 409);
}));

// Seam: acknowledged streams free their payload quota without making old events replayable.
test('event acknowledgements clear ciphertext but preserve retry fingerprints', options, () => fixture(async ({ sql, browser, native, connect }) => {
  const p = await connect(), controller = randomUUID(), path = `pairs/${p.id}`;
  const response = await browser(path + '/control', { controller });
  assert.ok(Math.abs(Date.now() - Date.parse((await response.json()).pair.serverTime)) < 3000);
  const command = { id: randomUUID(), controller, turn: randomUUID(), kind: 'start', envelope: encrypted() };
  await browser(path + '/messages', command);
  const event = { id: randomUUID(), controller, turn: command.turn, kind: 'event', envelope: encrypted('Consumed words') };
  const batch = { pairId: p.id, events: [event], runs: [{ id: command.turn, state: 'running' }] };
  assert.equal((await native('events', batch, p.token)).status, 200);
  const first = await (await browser(path + `/events?controller=${controller}&after=0`)).json();
  assert.equal(first.events.length, 1);
  assert.deepEqual((await sql`SELECT envelope FROM relay_events WHERE pair_id=${p.id}`)[0].envelope, event.envelope);
  assert.equal((await (await browser(path + `/events?controller=${controller}&after=${first.events[0].seq}`)).json()).events.length, 0);
  const [cleared] = await sql`SELECT envelope,fingerprint FROM relay_events WHERE pair_id=${p.id}`;
  assert.equal(cleared.envelope, null); assert.match(cleared.fingerprint, /^[\da-f]{64}$/);
  assert.equal((await native('events', batch, p.token)).status, 200);
  assert.equal((await sql`SELECT count(*)::int AS n FROM relay_events WHERE pair_id=${p.id}`)[0].n, 1);
  assert.equal((await native('events', { ...batch, events: [{ ...event, envelope: encrypted('Changed replay') }] }, p.token)).status, 409);
  assert.equal((await (await browser(path + `/events?controller=${controller}&after=0`)).json()).events.length, 0);
  const unread = { ...event, id: randomUUID(), envelope: encrypted('Old controller words') };
  assert.equal((await native('events', { pairId: p.id, events: [unread] }, p.token)).status, 200);
  const next = randomUUID();
  assert.equal((await browser(path + '/control', { controller: next, takeover: true })).status, 200);
  assert.equal((await sql`SELECT count(*)::int AS n FROM relay_events WHERE pair_id=${p.id} AND envelope IS NOT NULL`)[0].n, 0);
  const late = { ...event, id: randomUUID(), envelope: encrypted('Late old controller words') };
  assert.equal((await native('events', { pairId: p.id, events: [late], runs: [{ id: command.turn, state: 'running' }] }, p.token)).status, 200);
  assert.equal((await sql`SELECT envelope FROM relay_events WHERE pair_id=${p.id} AND id=${late.id}`)[0].envelope, null);
  assert.equal((await native('events', { pairId: p.id, events: [late], runs: [{ id: command.turn, state: 'running' }] }, p.token)).status, 200);
}));
