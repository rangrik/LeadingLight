import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { application } from './app.mjs';
import { mobileRelayRequest } from './mobile-relay.mjs';
import { database } from './database.mjs';

const origin = 'https://notes.test';
const encrypted = () => ({ v: 2, iv: randomBytes(12).toString('base64'), data: randomBytes(64).toString('base64') });

// Relay credentials separate roles and accounts; opaque retries cannot replace delivered content.
test('mobile relay isolates accounts, roles and immutable encrypted requests', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = database(process.env.TEST_DATABASE_URL), owner = `mobile-${randomUUID()}`;
  await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const app = application({ env: { APP_ORIGIN: origin, CLOUD_ALLOWED_USERS: owner }, sql, auth: { user: async (r) => r.headers.has('test-user') ? { id: r.headers.get('test-user') } : null } });
  const register = (user = owner) => app(new Request(origin + '/api/mobile-relay/channels', { method: 'POST', headers: { origin, ...(user ? { 'test-user': user } : {}) }, body: '{}' }));
  const call = (action, body, token, headers = {}) => mobileRelayRequest({ sql, pollWait: 0, readBody: (r) => r.json(), request: new Request(origin + '/api/mobile-relay/native/' + action, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) }) });
  try {
    assert.equal((await register(null)).status, 401);
    assert.equal((await register('another-account')).status, 403);
    const response = await register(); assert.equal(response.status, 201);
    const c = await response.json(), body = { channel: c.channel, id: randomUUID(), envelope: encrypted(), prompt: 'Never store this plaintext' };
    const stored = JSON.stringify(await sql`SELECT * FROM mobile_connections WHERE id=${c.channel}`);
    assert.ok(!stored.includes(c.hostToken)); assert.ok(!stored.includes(c.clientToken));
    assert.equal((await call('send', body, c.clientToken)).status, 409);
    assert.equal((await call('poll', body, c.clientToken)).status, 403);
    assert.equal((await call('send', body, c.hostToken)).status, 403);
    assert.equal((await call('poll', body, c.hostToken, { origin })).status, 403);
    assert.equal((await call('poll', body, c.hostToken)).status, 200);
    assert.equal((await call('send', body, c.clientToken)).status, 200);
    assert.equal((await call('send', body, c.clientToken)).status, 200);
    assert.equal((await call('send', { ...body, envelope: encrypted() }, c.clientToken)).status, 409);
    assert.ok(!JSON.stringify(await sql`SELECT * FROM mobile_messages WHERE channel=${c.channel}`).includes(body.prompt));
    const polled = await (await call('poll', body, c.hostToken)).json();
    assert.equal(polled.messages.length, 1); assert.deepEqual(polled.messages[0].envelope, body.envelope);
    assert.deepEqual(await (await call('reply', body, c.clientToken)).json(), { pending: true });
    const reply = { ...body, envelope: encrypted() };
    assert.equal((await call('result', reply, c.clientToken)).status, 403);
    assert.equal((await call('result', reply, c.hostToken)).status, 200);
    assert.equal((await call('result', reply, c.hostToken)).status, 200);
    assert.equal((await call('result', { ...reply, envelope: encrypted() }, c.hostToken)).status, 409);
    assert.deepEqual(await (await call('reply', body, c.clientToken)).json(), { envelope: reply.envelope });
    assert.equal((await (await call('poll', body, c.hostToken)).json()).messages.length, 0);
    const another = await (await register()).json();
    assert.equal((await call('reply', body, another.clientToken)).status, 403);
    assert.equal((await call('ack', body, c.hostToken)).status, 403);
    assert.equal((await call('ack', body, c.clientToken)).status, 200);
    assert.equal((await call('send', body, c.clientToken)).status, 200);
    await sql`UPDATE mobile_messages SET expires_at=now()-interval '1 second' WHERE channel=${c.channel}`;
    assert.equal((await call('reply', body, c.clientToken)).status, 410);
    assert.equal((await call('send', { ...body, id: randomUUID(), envelope: { ...encrypted(), data: randomBytes(1_100_000).toString('base64') } }, c.clientToken)).status, 413);
    assert.equal((await call('revoke', body, c.clientToken)).status, 403);
    assert.equal((await call('revoke', body, c.hostToken)).status, 200);
    assert.equal((await call('send', body, c.clientToken)).status, 403);
    const big = { ...encrypted(), data: randomBytes(2_000_000).toString('base64') }, pending = [];
    await call('poll', { channel: another.channel }, another.hostToken);
    for (let n = 0; n < 5; n++) {
      const item = { channel: another.channel, id: randomUUID(), envelope: encrypted() }; pending.push(item);
      assert.equal((await call('send', item, another.clientToken)).status, 200);
      assert.equal((await call('result', { ...item, envelope: big }, another.hostToken)).status, n < 4 ? 200 : 429);
    }
    assert.equal((await call('ack', pending[0], another.clientToken)).status, 200);
    assert.equal((await call('result', { ...pending[4], envelope: big }, another.hostToken)).status, 200);
  } finally { await sql`DELETE FROM mobile_connections WHERE owner=${owner}`; await sql.end(); }
});
