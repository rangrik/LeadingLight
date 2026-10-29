import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { database } from './database.mjs';
import { application } from './app.mjs';

const origin = 'https://notes.test', options = { skip: !process.env.TEST_DATABASE_URL };
const encrypted = { v: 1, iv: 'opaque-iv', data: 'opaque-ciphertext' };
async function fixture(run) {
  const admin = database(process.env.TEST_DATABASE_URL), schema = `pagination_${randomUUID().replaceAll('-', '')}`;
  let sql;
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(process.env.TEST_DATABASE_URL, { max: 1, prepare: false, onnotice: () => {}, connection: { search_path: schema } });
    await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    const owner = randomUUID();
    const app = application({ sql, env: { APP_ORIGIN: origin, CLOUD_ACCESS: 'public' }, auth: { ready: true, providers: [], user: async () => ({ id: owner }) } });
    const get = async (path) => {
      const response = await app(new Request(origin + '/api/' + path, { headers: { origin } }));
      assert.equal(response.status, 200); return response.json();
    };
    await run({ sql, owner, get });
  } finally {
    if (sql) await sql.end();
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
    await admin.end();
  }
}

async function pages(get, path, limit) {
  let after = '0'; const seen = [];
  for (let page = 0; page < 5; page++) {
    const { events } = await get(`${path}${path.includes('?') ? '&' : '?'}after=${after}`);
    assert.ok(events.length <= limit);
    if (!events.length) return seen;
    for (const event of events) {
      assert.ok(BigInt(event.seq) > BigInt(after), 'Sequence must increase numerically, not lexicographically');
      after = event.seq; seen.push(event.id);
    }
  }
  assert.fail('Pagination did not reach the end.');
}

// Text cursor serialization must not change numeric ordering across the page boundary.
test('sync pagination delivers every event across sequences 9, 10, 99 and 100', options, () => fixture(async ({ sql, owner, get }) => {
  const ids = Array.from({ length: 121 }, () => randomUUID());
  for (const id of ids) await sql`INSERT INTO sync_events(owner,id,envelope) VALUES(${owner},${id},${sql.json(encrypted)})`;
  assert.deepEqual(await pages(get, 'sync', 50), ids);
}));

// A relay acknowledgement must never erase lower-numbered events omitted by text sorting.
test('relay pagination delivers every reply before acknowledging it', options, () => fixture(async ({ sql, owner, get }) => {
  const pair = randomUUID(), controller = randomUUID(), turn = randomUUID();
  await sql`INSERT INTO relay_pairs(id,owner,account_name,browser_name,invite_hash,state,controller,browser_seen,last_seen) VALUES(${pair},${owner},'Fixture','Fixture','fixture','active',${controller},now(),now())`;
  await sql`INSERT INTO relay_runs(pair_id,id,controller,state) VALUES(${pair},${turn},${controller},'done')`;
  const ids = Array.from({ length: 121 }, () => randomUUID());
  for (const id of ids) await sql`INSERT INTO relay_events(pair_id,id,controller,turn,kind,envelope,fingerprint) VALUES(${pair},${id},${controller},${turn},'event',${sql.json(encrypted)},${'0'.repeat(64)})`;
  assert.deepEqual(await pages(get, `relay/pairs/${pair}/events?controller=${controller}`, 100), ids);
  assert.equal(Number((await sql`SELECT count(*) FROM relay_events WHERE envelope IS NOT NULL`)[0].count), 0);
}));
