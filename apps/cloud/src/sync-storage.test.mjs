import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database } from './database.mjs';
import { convertParts } from './compact-sync.mjs';
import { readPart, saveSyncEvent } from './sync-storage.mjs';

// At the quota, retries and conversion must keep every existing part and its cursor.
test('lossless packing frees space for pending edits and rolls back cleanly', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = database(process.env.TEST_DATABASE_URL), owner = 'qa-storage-' + randomUUID();
  const other = 'qa-storage-' + randomUUID(), part = { v: 1, kind: 'part', iv: '', data: randomBytes(32_000).toString('base64') };
  const text = { v: 1, iv: 'abcdefghijklmnop', data: randomBytes(300).toString('base64') };
  const get = (id, who = owner) => sql`SELECT seq::text AS cursor,envelope,part_bytes FROM sync_events WHERE owner=${who} AND id=${id}`;
  try {
    await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    for (const who of [owner, other]) await sql`INSERT INTO sync_events(owner,id,envelope) VALUES(${who},'part',${sql.json(part)})`;
    const [before] = await get('part'), max = 36_000;
    assert.equal(await saveSyncEvent(sql, owner, { id: 'page', envelope: text }, max), false);
    assert.equal(await saveSyncEvent(sql, owner, { id: 'part', envelope: part }, max), true);
    const estimate = await convertParts(sql, owner, 'inspect');
    assert.equal(estimate.parts, 1);
    assert.equal((await get('part'))[0].part_bytes, null);
    assert.deepEqual(await convertParts(sql, owner, 'compact'), estimate);
    const [packed] = await get('part');
    assert.equal(packed.cursor, before.cursor);
    assert.deepEqual(readPart(packed), part);
    assert.equal((await get('part', other))[0].part_bytes, null);
    for (const id of ['collection', 'page']) assert.equal(await saveSyncEvent(sql, owner, { id, envelope: text }, max), true);
    const big = { id: 'too-large', envelope: { ...part, data: randomBytes(5000).toString('base64') } };
    assert.equal(await saveSyncEvent(sql, owner, big, max), false);
    assert.deepEqual([...(await get(big.id))], []);
    assert.equal((await convertParts(sql, owner, 'compact')).parts, 0);
    assert.equal((await convertParts(sql, owner, 'restore')).parts, 1);
    assert.deepEqual((await get('part'))[0], before);
  } finally {
    await sql`DELETE FROM sync_events WHERE owner IN (${owner},${other})`;
    await sql.end();
  }
});
