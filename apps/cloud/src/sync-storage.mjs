const limit = 500_000_000;
const full = new Error('Sync storage is full');

// Older clients need the exact text they sent, including padding.
export function partBytes(envelope) {
  if (envelope.kind !== 'part' || typeof envelope.data !== 'string' || !envelope.data) return null;
  const bytes = Buffer.from(envelope.data, 'base64');
  return bytes.toString('base64') === envelope.data ? bytes : null;
}

export const readPart = ({ envelope, part_bytes }) => part_bytes
  ? { ...envelope, data: part_bytes.toString('base64') }
  : envelope;

export const lockOwner = (tx, owner) => tx`SELECT pg_advisory_xact_lock(hashtextextended(${owner},0))`;

export async function saveSyncEvent(sql, owner, { id, envelope }, maxBytes = limit) {
  const bytes = partBytes(envelope);
  try {
    return await sql.begin(async (tx) => {
      await lockOwner(tx, owner);
      const [existing] = await tx`SELECT 1 FROM sync_events WHERE owner=${owner} AND id=${id}`;
      if (existing) return true;
      const [usage] = await tx`SELECT coalesce(sum(pg_column_size(envelope)::bigint + coalesce(pg_column_size(part_bytes),0)),0) AS bytes
        FROM sync_events WHERE owner=${owner}`;
      const available = maxBytes - Number(usage.bytes);
      if (available <= 0) return false;
      await tx`INSERT INTO sync_events(owner,id,envelope,part_bytes)
        VALUES(${owner},${id},${tx.json(bytes ? { ...envelope, data: '' } : envelope)},${bytes})`;
      const [stored] = await tx`SELECT pg_column_size(envelope) + coalesce(pg_column_size(part_bytes),0) AS bytes
        FROM sync_events WHERE owner=${owner} AND id=${id}`;
      if (stored.bytes > available) throw full;
      return true;
    });
  } catch (error) {
    if (error !== full) throw error;
    return false;
  }
}
