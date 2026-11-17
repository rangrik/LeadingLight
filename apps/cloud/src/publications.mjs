import { randomBytes } from 'node:crypto';

export const publicationHeaders = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200) => Response.json(body, { status, headers: publicationHeaders });
const text = (value, max) => typeof value === 'string' && value.length <= max;

export async function publishedRequest({ request, sql }) {
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Read only.' }, 405);
  const token = new URL(request.url).pathname.slice('/api/published/'.length);
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return json({ error: 'This page is unavailable.' }, 404);
  const [page] = await sql`SELECT snapshot,updated_at FROM publications WHERE token=${token}`;
  if (!page) return json({ error: 'This page is unavailable.' }, 404);
  return request.method === 'HEAD' ? new Response(null, { headers: publicationHeaders }) : json({ ...page.snapshot, publishedAt: page.updated_at });
}

// Bound nested document data before the reader builds a ProseMirror document from it.
function document(value, depth = 0, budget = { left: 40000 }) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 64 || --budget.left < 0 || !text(value.type, 64)) return false;
  if (value.text !== undefined && !text(value.text, 3_500_000)) return false;
  if (value.attrs !== undefined && (!value.attrs || typeof value.attrs !== 'object' || Array.isArray(value.attrs))) return false;
  if (value.marks !== undefined && (!Array.isArray(value.marks) || value.marks.length > 32 || !value.marks.every((mark) => document(mark, depth + 1, budget)))) return false;
  return value.content === undefined || Array.isArray(value.content) && value.content.every((node) => document(node, depth + 1, budget));
}

export async function publicationRequest({ request, sql, user, origin, readBody }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const action = new URL(request.url).pathname.slice('/api/publications/'.length);
  if (!['status', 'publish', 'unpublish'].includes(action)) return json({ error: 'Not found.' }, 404);
  const body = await readBody(request, 3_500_000);
  if (action === 'status' && body.page === undefined) {
    const rows = await sql`SELECT page,token,snapshot->>'title' AS title,updated_at FROM publications WHERE owner=${user.id} ORDER BY updated_at DESC LIMIT 100`;
    return json({ publications: rows.map((row) => ({ page: row.page, title: row.title, url: `${origin}/p/${row.token}`, updatedAt: row.updated_at })) });
  }
  if (!text(body.page, 200) || !body.page) return json({ error: 'Invalid page.' }, 400);
  if (action === 'unpublish') {
    await sql`DELETE FROM publications WHERE owner=${user.id} AND page=${body.page}`;
    return json({ publication: null });
  }
  if (action === 'status') {
    const [row] = await sql`SELECT token,updated_at FROM publications WHERE owner=${user.id} AND page=${body.page}`;
    return json({ publication: row ? { url: `${origin}/p/${row.token}`, updatedAt: row.updated_at } : null });
  }
  const s = body.snapshot, budget = { left: 40000 };
  if (!s || s.version !== 1 || !text(s.title, 10000) || !text(s.description, 20000) || s.content?.type !== 'doc' || !document(s.content, 0, budget)
    || !Array.isArray(s.notes) || s.notes.length > 2000 || !s.notes.every((n) => text(n.id, 200) && n.body?.type === 'doc' && document(n.body, 0, budget))) {
    return json({ error: 'This page could not be published. Its content is invalid.' }, 400);
  }
  const snapshot = { version: 1, style: s.style === 'playful' ? 'playful' : 'plain', title: s.title, description: s.description, content: s.content, notes: s.notes.map(({ id, body }) => ({ id, body })) };
  const row = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`publish:${user.id}`},0))`;
    const [{ count, bytes }] = await tx`SELECT count(*)::int AS count,coalesce(sum(pg_column_size(snapshot)),0)::bigint AS bytes FROM publications WHERE owner=${user.id} AND page!=${body.page}`;
    if (count >= 100 || Number(bytes) + Buffer.byteLength(JSON.stringify(snapshot)) > 100_000_000) return null;
    const [saved] = await tx`INSERT INTO publications(owner,page,token,snapshot) VALUES(${user.id},${body.page},${randomBytes(24).toString('base64url')},${tx.json(snapshot)})
      ON CONFLICT(owner,page) DO UPDATE SET snapshot=EXCLUDED.snapshot,updated_at=now() RETURNING token,updated_at`;
    return saved;
  });
  return row ? json({ publication: { url: `${origin}/p/${row.token}`, updatedAt: row.updated_at } }) : json({ error: 'Published page storage is full. Unpublish a page before trying again.' }, 413);
}
