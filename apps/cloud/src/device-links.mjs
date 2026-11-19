import { createHash, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { NativeError } from './native.mjs';

const require = (ok, status, text) => {
  if (!ok) throw new NativeError(status, text);
};
const json = (data) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
const uuid = (s) => typeof s === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(s);
const projectId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
const fresh = (at) => Date.now() - new Date(at).getTime() < 60_000;
const publicKey = (k) => {
  require(k?.kty === 'EC' &&
    k.crv === 'P-256' &&
    !('d' in k) &&
    /^[\w-]{43}$/.test(k.x) &&
    /^[\w-]{43}$/.test(k.y), 400, 'Invalid device key.');
  const key = { kty: 'EC', crv: 'P-256', x: k.x, y: k.y };
  try {
    createPublicKey({ key, format: 'jwk' });
  } catch {
    throw new NativeError(400, 'Invalid device key.');
  }
  return key;
};
const active = (row) => row.state === 'pending' && Date.parse(row.expires_at) > Date.now();
const state = (row) => (row.state === 'pending' && !active(row) ? 'expired' : row.state);
const view = (r, me) => ({
  id: r.id,
  requester: r.requester,
  target: r.target,
  requesterName: r.requester_name,
  targetName: r.target_name,
  project: r.project,
  notes: r.share_notes,
  requesterKey: r.requester_key,
  targetKey: r.target_key,
  expiresAt: r.expires_at,
  state: state(r),
  ...(me === r.requester && r.state === 'approved' ? { envelope: r.envelope } : {}),
});

export async function deviceLinks({ request, sql, user, session, allowed, readBody }) {
  require(allowed && session, 403, 'Use a signed-in LeadingLight app on this device.');
  require(request.method === 'POST', 405, 'Use POST.');
  const op = new URL(request.url).pathname.split('/').at(-1),
    body = await readBody(request, 24000);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${user.id},74))`;
    const [self] =
      await tx`SELECT device_name,sync_requires_link FROM native_sessions WHERE id=${session} AND owner=${user.id} AND revoked_at IS NULL AND expires_at>now()`;
    require(self, 401, 'This device was signed out.');
    if (op === 'presence') {
      const pk = publicKey(body.key),
        projects = body.projects;
      require(Array.isArray(projects) &&
        projects.length <= 200 &&
        projects.every(projectId) &&
        typeof body.sync === 'boolean', 400, 'Invalid device availability.');
      let canSync = body.sync;
      if (canSync && self.sync_requires_link) {
        const [grant] =
          await tx`SELECT 1 FROM device_links l JOIN native_sessions t ON t.id=l.target WHERE l.requester=${session} AND l.share_notes AND l.state='approved' AND t.revoked_at IS NULL AND t.expires_at>now() LIMIT 1`;
        canSync = !!grant;
      }
      const rows =
        await tx`INSERT INTO device_presence(session_id,public_key,can_sync,projects) VALUES(${session},${tx.json(pk)},${canSync},${tx.json(projects)}) ON CONFLICT(session_id) DO UPDATE SET seen=now(),can_sync=excluded.can_sync,projects=excluded.projects WHERE device_presence.public_key=excluded.public_key RETURNING session_id`;
      require(rows.length, 409, 'This installation lost its device key. Sign out and sign in again.');
    }
    if (op === 'presence' || op === 'list') {
      const devices =
        await tx`SELECT s.id,s.device_name,p.can_sync,p.projects,p.seen FROM native_sessions s LEFT JOIN device_presence p ON p.session_id=s.id WHERE s.owner=${user.id} AND s.revoked_at IS NULL AND s.expires_at>now() ORDER BY s.device_name LIMIT 100`;
      const links =
        await tx`SELECT l.*,a.device_name AS requester_name,b.device_name AS target_name FROM device_links l JOIN native_sessions a ON a.id=l.requester JOIN native_sessions b ON b.id=l.target WHERE l.owner=${user.id} AND (l.requester=${session} OR l.target=${session}) AND a.revoked_at IS NULL AND b.revoked_at IS NULL AND a.expires_at>now() AND b.expires_at>now() AND (l.state='approved' OR l.created_at>now()-interval '5 minutes') ORDER BY l.created_at`;
      return json({
        session,
        devices: devices
          .filter((d) => d.id !== session)
          .map((d) => ({
            id: d.id,
            name: d.device_name,
            online: !!d.seen && fresh(d.seen),
            sync: d.can_sync || false,
            projects: d.projects || [],
          })),
        links: links.map((r) => view(r, session)),
      });
    }
    if (op === 'start') {
      await tx`DELETE FROM device_links WHERE owner=${user.id} AND state<>'approved' AND created_at<now()-interval '10 minutes'`;
      require(uuid(body.target) &&
        body.target !== session &&
        (body.project === null || projectId(body.project)), 400, 'Select another device.');
      const rows =
        await tx`SELECT s.id,p.* FROM native_sessions s JOIN device_presence p ON s.id=p.session_id WHERE s.owner=${user.id} AND s.revoked_at IS NULL AND s.expires_at>now() AND s.id IN (${session},${body.target})`;
      const from = rows.find((d) => d.id === session),
        to = rows.find((d) => d.id === body.target);
      require(from &&
        to &&
        fresh(to.seen) &&
        (to.can_sync || body.project), 409, 'Open LeadingLight on a device that already has your notes.');
      require(!body.project || to.projects.includes(body.project), 409, 'This Mac does not have the project folder.');
      const [{ count }] =
        await tx`SELECT count(*)::int AS count FROM device_links WHERE owner=${user.id} AND (target=${body.target} OR requester=${session}) AND created_at>now()-interval '10 minutes'`;
      require(count < 12, 429, 'Too many requests. Try again in ten minutes.');
      await tx`UPDATE device_links SET state='cancelled' WHERE requester=${session} AND state='pending'`;
      const [link] =
        await tx`INSERT INTO device_links(id,owner,requester,target,project,share_notes,requester_key,target_key) VALUES(${randomUUID()},${user.id},${session},${to.id},${body.project},${to.can_sync},${tx.json(from.public_key)},${tx.json(to.public_key)}) RETURNING id`;
      return json(link);
    }
    require(uuid(body.id), 400, 'Invalid connection request.');
    const [l] =
      await tx`SELECT * FROM device_links WHERE id=${body.id} AND owner=${user.id} AND (requester=${session} OR target=${session}) FOR UPDATE`;
    require(l, 404, 'Connection not found.');
    if (op === 'remove' || op === 'cancel' || op === 'deny') {
      require(op === 'remove'
        ? l.state === 'approved'
        : active(l) && (op === 'cancel' ? l.requester : l.target) === session, 409, 'This request has ended.');
      await tx`UPDATE device_links SET state=${op === 'remove' ? 'removed' : op === 'deny' ? 'denied' : 'cancelled'},envelope=NULL WHERE id=${l.id}`;
      if (l.channel) await tx`DELETE FROM mobile_connections WHERE id=${l.channel}`;
      return json({ ok: true });
    }
    require(active(l) && l.target === session, 409, 'This request has ended.');
    if (op === 'channel') {
      require(l.project && !l.channel, 409, 'Start a new project connection.');
      const channel = randomUUID(),
        hostToken = randomBytes(32).toString('base64url'),
        clientToken = randomBytes(32).toString('base64url');
      const hash = (s) => createHash('sha256').update(s).digest('hex');
      await tx`INSERT INTO mobile_connections(id,owner,host_hash,client_hash,device_link) VALUES(${channel},${user.id},${hash(hostToken)},${hash(clientToken)},${l.id})`;
      await tx`UPDATE device_links SET channel=${channel} WHERE id=${l.id}`;
      return json({ channel, hostToken, clientToken });
    }
    require(op === 'approve', 404, 'Unknown connection action.');
    const e = body.envelope;
    require(e &&
      /^[A-Za-z0-9+/]{16}$/.test(e.iv) &&
      typeof e.data === 'string' &&
      e.data.length >= 24 &&
      e.data.length <= 8192 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(e.data) &&
      (!l.project || l.channel), 400, 'Invalid device approval.');
    await tx`UPDATE device_links SET state='approved',envelope=${tx.json({ iv: e.iv, data: e.data })} WHERE id=${l.id}`;
    return json({ ok: true });
  });
}
