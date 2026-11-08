import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mobilePushRequest } from './mobile-push.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const uuid = (s) => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { mobileRelayStatus: status }); };
const require = (ok, status, message) => { if (!ok) fail(status, message); };
const recent = (date, ms) => date && Date.now() - new Date(date).getTime() < ms;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function envelope(value, limit) {
  const base64 = (s) => typeof s === 'string' && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s) && Buffer.from(s, 'base64').toString('base64') === s;
  require(value?.v === 2 && base64(value.iv) && Buffer.from(value.iv, 'base64').length === 12 && base64(value.data) && Buffer.from(value.data, 'base64').length >= 16, 400, 'Invalid encrypted message.');
  const out = { v: 2, iv: value.iv, data: value.data };
  require(Buffer.byteLength(JSON.stringify(out)) <= limit, 413, 'Encrypted message is too large.');
  return out;
}

async function connection(sql, request, channel, role) {
  require(uuid(channel), 400, 'Invalid Mac connection.');
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') || '')?.[1];
  require(token, 403, 'Mac connection authorization failed.');
  const [row] = await sql`SELECT * FROM mobile_connections WHERE id=${channel} FOR UPDATE`;
  const expected = row?.[role === 'host' ? 'host_hash' : 'client_hash'];
  require(expected && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sha(token), 'hex')), 403, 'Mac connection authorization failed.');
  require(recent(row.last_seen || row.created_at, 30 * 86400_000), 410, 'This connection expired. Copy a new code from the Mac.');
  return row;
}

export async function mobileRelayRequest({ request, sql, user, allowed, readBody, pollWait = 20_000, env = {}, pushSender }) {
  try {
    const path = new URL(request.url).pathname.slice('/api/mobile-relay/'.length);
    require(request.method === 'POST', 405, 'Use POST for mobile connections.');
    if (path === 'remove') {
      require(user, 401, 'Sign in on this Mac to remove a connection.');
      const body = await readBody(request, 1024);
      require(uuid(body.channel), 400, 'Invalid connection.');
      await sql`DELETE FROM mobile_connections WHERE id=${body.channel} AND owner=${user.id}`;
      return json({ ok: true });
    }
    if (path === 'channels') {
      require(user, 401, 'Sign in to LeadingLight on this Mac to enable mobile access.');
      require(allowed, 403, 'Cloud access is not enabled for this account.');
      const hostToken = randomBytes(32).toString('base64url'), clientToken = randomBytes(32).toString('base64url'), channel = randomUUID();
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${user.id},2))`;
        await tx`DELETE FROM mobile_connections WHERE owner=${user.id} AND (coalesce(last_seen,created_at)<now()-interval '30 days' OR last_seen IS NULL AND created_at<now()-interval '10 minutes')`;
        const [{ count }] = await tx`SELECT count(*)::int AS count FROM mobile_connections WHERE owner=${user.id}`;
        require(count < 10, 429, 'Remove an old mobile connection before adding another.');
        await tx`INSERT INTO mobile_connections(id,owner,host_hash,client_hash) VALUES(${channel},${user.id},${sha(hostToken)},${sha(clientToken)})`;
      });
      return json({ channel, hostToken, clientToken }, 201);
    }
    require(!request.headers.has('origin'), 403, 'Use the installed LeadingLight app for this connection.');
    const pushRoutes = ['native/notify','native/register-notifications','native/unregister-notifications','native/notification-status'];
    const role = ['native/poll', 'native/result', 'native/revoke','native/notify'].includes(path) ? 'host' : 'client';
    require(['native/poll','native/result','native/revoke','native/send','native/reply','native/ack',...pushRoutes].includes(path), 404, 'Connection route not found.');
    const body = await readBody(request, 3_000_000);
    if (pushRoutes.includes(path)) return await mobilePushRequest({ sql, body, path, authorize: (tx) => connection(tx, request, body.channel, role), validateEnvelope: envelope, require, uuid, env, sender: pushSender });
    if (path === 'native/poll') {
      const until = Date.now() + pollWait;
      do {
        const messages = await sql.begin(async (tx) => {
          const c = await connection(tx, request, body.channel, role);
          await tx`UPDATE mobile_connections SET last_seen=now() WHERE id=${c.id}`;
          await tx`DELETE FROM mobile_messages WHERE (channel,id) IN (SELECT channel,id FROM mobile_messages WHERE expires_at<now() ORDER BY expires_at LIMIT 128)`;
          const rows = await tx`SELECT id,envelope FROM mobile_messages WHERE channel=${c.id} AND response IS NULL ORDER BY created_at LIMIT 8`;
          const out = []; let bytes = 0;
          for (const row of rows) { const size = Buffer.byteLength(JSON.stringify(row)); if (out.length && bytes + size > 2_800_000) break; out.push(row); bytes += size; }
          return out;
        });
        if (messages.length || Date.now() >= until || request.signal.aborted) return json({ messages });
        await sleep(Math.min(1000, until - Date.now()));
      } while (true);
    }
    return await sql.begin(async (tx) => {
      const c = await connection(tx, request, body.channel, role);
      if (path === 'native/revoke') { await tx`DELETE FROM mobile_connections WHERE id=${c.id}`; return json({ ok: true }); }
      require(uuid(body.id), 400, 'Invalid request identity.');
      await tx`DELETE FROM mobile_messages WHERE channel=${c.id} AND expires_at<now()`;
      const [existing] = await tx`SELECT * FROM mobile_messages WHERE channel=${c.id} AND id=${body.id}`;
      if (path === 'native/send') {
        const value = envelope(body.envelope, 1_450_000);
        if (existing) { require(isDeepStrictEqual(existing.envelope, value), 409, 'Request identity was reused.'); return json({ ok: true }); }
        require(recent(c.last_seen, 30_000), 409, 'This Mac is offline. Keep it awake and connected to the internet.');
        const [{ count, bytes }] = await tx`SELECT count(*)::int AS count,coalesce(sum(octet_length(envelope::text)+coalesce(octet_length(response::text),0)),0)::bigint AS bytes FROM mobile_messages WHERE channel=${c.id}`;
        require(count < 128 && Number(bytes) + Buffer.byteLength(JSON.stringify(value)) < 12_000_000, 429, 'This Mac has too many requests waiting. Try again shortly.');
        await tx`INSERT INTO mobile_messages(channel,id,envelope) VALUES(${c.id},${body.id},${tx.json(value)})`;
        return json({ ok: true });
      }
      if (path === 'native/ack') { await tx`DELETE FROM mobile_messages WHERE channel=${c.id} AND id=${body.id} AND response IS NOT NULL`; return json({ ok: true }); }
      require(existing, 410, 'The Mac did not confirm this request in time. Reconnect and check the conversation.');
      if (path === 'native/reply') return json(existing.response ? { envelope: existing.response } : { pending: true });
      const value = envelope(body.envelope, 2_850_000);
      require(!existing.response || isDeepStrictEqual(existing.response, value), 409, 'A reply cannot be replaced.');
      if (existing.response) return json({ ok: true });
      const [{ bytes }] = await tx`SELECT coalesce(sum(octet_length(envelope::text)+coalesce(octet_length(response::text),0)),0)::bigint AS bytes FROM mobile_messages WHERE channel=${c.id}`;
      require(Number(bytes) + Buffer.byteLength(JSON.stringify(value)) < 12_000_000, 429, 'This connection has too many unread replies. Reconnect and try again.');
      await tx`UPDATE mobile_messages SET response=${tx.json(value)} WHERE channel=${c.id} AND id=${body.id}`;
      return json({ ok: true });
    });
  } catch (error) {
    if (error.mobileRelayStatus) return json({ error: error.message }, error.mobileRelayStatus);
    throw error;
  }
}
