import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mobileRelayRequest } from './mobile-relay.mjs';
import { database } from './database.mjs';

// APNs is only a hint: role separation, private targets and per-device receipts survive retries.
test('agent notifications keep targets opaque and deduplicate each device', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = database(process.env.TEST_DATABASE_URL), owner = `push-${randomUUID()}`, sent = [];
  await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const env = { APNS_KEY_ID: 'test', APNS_TEAM_ID: 'test', APNS_PRIVATE_KEY: 'test', APNS_ENVIRONMENT: 'both' };
  let invalid = false, unavailable = false;
  const call = (path, body = {}, token, settings = env) => mobileRelayRequest({ sql, env: settings, user: { id: owner }, allowed: true, pollWait: 0, readBody: (r) => r.json(), pushSender: async (_, device, payload) => { if (unavailable) throw new Error('offline'); sent.push({ device, payload }); return { ok: !invalid, invalid }; }, request: new Request(`https://notes.test/api/mobile-relay/${path}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }) });
  try {
    const c = await (await call('channels')).json();
    const device = { channel: c.channel, device: randomUUID(), token: randomBytes(32).toString('hex'), environment: 'production' };
    const event = { channel: c.channel, id: randomUUID(), envelope: { v: 2, iv: randomBytes(12).toString('base64'), data: randomBytes(80).toString('base64') }, project: 'private-project', command: 'secret-command' };
    assert.equal((await call('native/register-notifications', device, c.hostToken)).status, 403);
    assert.equal((await call('native/register-notifications', device, c.clientToken, {})).status, 503);
    assert.equal((await call('native/register-notifications', { ...device, environment: 'debug' }, c.clientToken)).status, 400);
    assert.equal((await call('native/register-notifications', { ...device, environment: 'sandbox' }, c.clientToken, { ...env, APNS_ENVIRONMENT: 'production' })).status, 503);
    assert.equal((await call('native/register-notifications', device, c.clientToken)).status, 200);
    assert.equal((await call('native/notify', event, c.clientToken)).status, 403);
    assert.deepEqual(await (await call('native/notify', event, c.hostToken)).json(), { delivered: 1, pending: false });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload.ll, { channel: c.channel, id: event.id, envelope: event.envelope });
    assert.equal(sent[0].device.environment, 'production');
    assert.equal(JSON.stringify(sent[0].payload).includes(event.command), false);
    assert.equal(JSON.stringify(await sql`SELECT * FROM mobile_push_events WHERE channel=${c.channel}`).includes(event.project), false);
    await call('native/notify', event, c.hostToken); assert.equal(sent.length, 1);
    assert.deepEqual(await (await call('native/notification-status', device, c.clientToken)).json(), { ready: true, registered: true });
    await call('native/register-notifications', device, c.clientToken);
    await call('native/notify', event, c.hostToken); assert.equal(sent.length, 1);
    const another = { ...device, device: randomUUID(), token: randomBytes(32).toString('hex'), environment: 'sandbox' };
    await call('native/register-notifications', another, c.clientToken);
    assert.deepEqual(await (await call('native/notify', { ...event, envelope: { ...event.envelope, iv: randomBytes(12).toString('base64') } }, c.hostToken)).json(), { delivered: 2, pending: false });
    assert.equal(sent.length, 2); assert.deepEqual(sent[1].payload.ll.envelope, event.envelope);
    await call('native/register-notifications', { ...device, token: randomBytes(32).toString('hex') }, c.clientToken);
    await call('native/notify', event, c.hostToken); assert.equal(sent.length, 3);
    await call('native/unregister-notifications', another, c.clientToken);
    assert.deepEqual(await (await call('native/notification-status', another, c.clientToken)).json(), { ready: true, registered: false });
    unavailable = true;
    const retry = { ...event, id: randomUUID() };
    assert.deepEqual(await (await call('native/notify', retry, c.hostToken)).json(), { delivered: 0, pending: true });
    unavailable = false;
    await sql`UPDATE mobile_push_deliveries SET claimed_at=now()-interval '31 seconds' WHERE channel=${c.channel}`;
    await Promise.all([call('native/notify', retry, c.hostToken), call('native/notify', retry, c.hostToken)]);
    assert.equal(sent.length, 4);
    invalid = true; await call('native/notify', { ...event, id: randomUUID() }, c.hostToken);
    assert.deepEqual(await (await call('native/notification-status', device, c.clientToken)).json(), { ready: true, registered: false });
    await call('native/revoke', { channel: c.channel }, c.hostToken);
    assert.equal((await call('native/register-notifications', device, c.clientToken)).status, 403);
    assert.equal((await call('native/notify', event, c.hostToken)).status, 403);
    assert.equal((await sql`SELECT * FROM mobile_push_events WHERE channel=${c.channel}`).length, 0);
  } finally { await sql`DELETE FROM mobile_connections WHERE owner=${owner}`; await sql.end(); }
});
