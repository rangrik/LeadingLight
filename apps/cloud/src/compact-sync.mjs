import { pathToFileURL } from 'node:url';
import { database } from './database.mjs';
import { lockOwner, partBytes, readPart } from './sync-storage.mjs';

// One account and four parts per transaction keep normal sync writes moving.
export async function convertParts(sql, owner, mode = 'inspect') {
  if (!owner || !['inspect', 'compact', 'restore'].includes(mode)) throw new Error('Expected a workspace ID and inspect, compact, or restore.');
  const restore = mode === 'restore';
  let after = '0', parts = 0, encodingBytes = 0;
  for (;;) {
    const count = await sql.begin(async (tx) => {
      if (mode !== 'inspect') await lockOwner(tx, owner);
      const rows = await tx`SELECT seq::text AS cursor,id,envelope,part_bytes FROM sync_events
        WHERE owner=${owner} AND seq>${after} AND envelope->>'kind'='part'
        AND (part_bytes IS NOT NULL)=${restore}
        ORDER BY seq LIMIT 4`;
      for (const row of rows) {
        after = row.cursor;
        const envelope = readPart(row), bytes = row.part_bytes ?? partBytes(envelope);
        if (!bytes) continue;
        parts++;
        encodingBytes += envelope.data.length - bytes.length;
        if (mode === 'inspect') continue;
        await tx`UPDATE sync_events SET envelope=${tx.json(restore ? envelope : { ...envelope, data: '' })},
          part_bytes=${restore ? null : bytes} WHERE owner=${owner} AND id=${row.id}`;
      }
      return rows.length;
    });
    if (!count) break;
  }
  return { parts, encodingBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, owner] = process.argv.slice(2);
  if (!process.env.DATABASE_URL || !owner || !mode) throw new Error('Set DATABASE_URL and pass inspect, compact, or restore followed by the workspace ID.');
  const sql = database(process.env.DATABASE_URL);
  try { console.log(await convertParts(sql, owner, mode)); } finally { await sql.end(); }
}
