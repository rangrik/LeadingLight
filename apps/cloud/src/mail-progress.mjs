import { seal, unseal } from './calendar.mjs';
import { NativeError } from './native.mjs';

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const day = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fields = (v, names) => record(v) && Object.keys(v).every((k) => names.includes(k));
const mailKey = (s) => {
  try {
    const key = JSON.parse(s);
    return Array.isArray(key) && key.length === 2 && key.every((id) => typeof id === 'string' && /^[\w-]{1,128}$/.test(id));
  } catch { return false; }
};
const entries = (v, key, value) => record(v) && Object.entries(v).every(([k, x]) => key(k) && value(x));
function valid(s) {
  if (!fields(s, ['start', 'days', 'kept', 'kinds', 'today']) || !integer(s.start) || ![3, 7, 14].includes(s.days)) return false;
  const t = s.today;
  return entries(s.kinds, (k) => k.length <= 320 && k.includes('@'), (v) => ['personal', 'work'].includes(v))
    && entries(s.kept, mailKey, day)
    && fields(t, ['day', 'started', 'ended', 'closed', 'left', 'cleared', 'clearedKeys', 'dues', 'handled', 'set'])
    && day(t.day) && [t.started, t.ended, t.left, t.cleared].every(integer) && typeof t.closed === 'boolean'
    && (t.clearedKeys === undefined || entries(t.clearedKeys, mailKey, (v) => v === true))
    && Array.isArray(t.set) && t.set.every(mailKey) && entries(t.dues, mailKey, day)
    && entries(t.handled, mailKey, (v) => ['later', 'done', 'task', 'replied'].includes(v));
}

export async function mailProgress({ request, sql, owner, readBody, key }) {
  const binding = JSON.stringify(['gmail-progress', owner]);
  const json = (body) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  if (request.method === 'GET') {
    const [row] = await sql`SELECT revision,sealed FROM gmail_progress WHERE owner=${owner}`;
    return json(row ? { revision: row.revision, state: unseal(key, binding, row.sealed) } : { revision: 0, state: null });
  }
  if (request.method !== 'POST') throw new NativeError(405, 'Use GET or POST for mail progress.');
  const body = await readBody(request, 512_000);
  if (!integer(body?.revision) || !valid(body.state)) throw new NativeError(400, 'Invalid mail progress.');
  const sealed = seal(key, binding, body.state);
  const rows = body.revision === 0
    ? await sql`INSERT INTO gmail_progress(owner,revision,sealed) VALUES(${owner},1,${sealed}) ON CONFLICT DO NOTHING RETURNING revision`
    : await sql`UPDATE gmail_progress SET revision=revision+1,sealed=${sealed} WHERE owner=${owner} AND revision=${body.revision} RETURNING revision`;
  if (!rows.length) throw new NativeError(409, 'Mail progress changed.');
  return json({ revision: rows[0].revision });
}
