import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database } from './database.mjs';
import { application } from './app.mjs';

const origin = 'https://notes.test';
const auth = { ready: true, providers: [], user: async (req) => req.headers.has('test-user') ? { id: req.headers.get('test-user') } : null };
const request = (app, path, user, body, method = body ? 'POST' : 'GET', source = origin) => app(new Request(origin + path, { method, headers: { origin: source, ...(user ? { 'test-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined }));

// Seam: stale browsers and server keys must never start paid provider work.
test('browser agent routes refuse work without saving context or calling a provider', async (t) => {
  let queries = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider call'); });
  const app = application({ env: { APP_ORIGIN: origin, CLOUD_ACCESS: 'public', OPENAI_API_KEY: 'fixture', ANTHROPIC_API_KEY: 'fixture' }, sql: () => { queries++; throw new Error('Unexpected database write'); }, auth });
  assert.deepEqual((await (await request(app, '/api/config')).json()).agents, []);
  assert.deepEqual(await (await request(app, '/api/jobs', 'owner')).json(), { jobs: [] });
  const result = await request(app, '/api/jobs', 'owner', { id: randomUUID(), provider: 'gpt', text: 'Private note', prompt: 'Summarize' });
  assert.equal(result.status, 410);
  assert.match((await result.json()).error, /installed Mac app/);
  for (const path of ['/api/worker', '/api/queue-worker']) assert.equal((await request(app, path)).status, 410);
  assert.equal((await request(app, '/api/jobs', null, { text: 'Private note' })).status, 401);
  assert.equal(queries, 0);
  assert.equal(fetch.mock.callCount(), 0);
});

// Seam: encrypted events survive reconnects but never cross account boundaries.
test('encrypted sync stays durable, idempotent and isolated', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = database(process.env.TEST_DATABASE_URL);
  const prefix = randomUUID(), a = `${prefix}:a`, b = `${prefix}:b`;
  const env = { APP_ORIGIN: origin, CLOUD_ACCESS: 'public' };
  const app = application({ env, sql, auth });
  const encrypted = { id: randomUUID(), envelope: { v: 1, iv: 'opaque-iv', data: 'opaque-ciphertext' } };
  try {
    await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    assert.equal((await request(app, '/api/sync', null, encrypted)).status, 401);
    assert.equal((await request(app, '/api/sync', a, encrypted, 'POST', 'https://evil.test')).status, 403);
    const privateApp = application({ env: { ...env, CLOUD_ACCESS: 'private', CLOUD_ALLOWED_USERS: a }, sql, auth });
    assert.equal((await request(privateApp, '/api/sync', b, encrypted)).status, 403);
    assert.equal((await request(privateApp, '/api/sync', a, encrypted)).status, 200);
    assert.equal((await request(app, '/api/sync', a, encrypted)).status, 200);
    assert.equal((await (await request(app, '/api/sync', b)).json()).events.length, 0);
    const reconnected = application({ env, sql, auth });
    const events = (await (await request(reconnected, '/api/sync', a)).json()).events;
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].envelope, encrypted.envelope);
    assert.deepEqual((await (await request(reconnected, `/api/sync?after=${events[0].seq}`, a)).json()).events, []);
    assert.equal((await request(app, '/api/sync', a, { ...encrypted, envelope: { ...encrypted.envelope, kind: 'manifest', parts: Array(201).fill('part') } })).status, 400);
    const part = { id: randomUUID(), envelope: { ...encrypted.envelope, kind: 'part' } };
    assert.equal((await request(app, '/api/sync', a, part)).status, 200);
    assert.equal((await request(app, `/api/sync-part?id=${part.id}`, b)).status, 404);
    assert.deepEqual(await (await request(app, `/api/sync-part?id=${part.id}`, a)).json(), part.envelope);
    assert.equal((await (await request(app, '/api/sync', a)).json()).events.length, 1);
  } finally { await sql`DELETE FROM sync_events WHERE owner IN (${a},${b})`; await sql.end(); }
});
