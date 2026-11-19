import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const hash = (text) => createHash('sha256').update(text).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
export class NativeError extends Error { constructor(status, message) { super(message); this.status = status; } }
const require = (condition, status, message) => { if (!condition) throw new NativeError(status, message); };
const matches = (left, right) => typeof right === 'string' && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));

function publicKey(key) {
  require(key?.kty === 'EC' && key.crv === 'P-256' && !('d' in key) && /^[\w-]{43}$/.test(key.x) && /^[\w-]{43}$/.test(key.y), 400, 'Invalid device key.');
  const clean = { kty: 'EC', crv: 'P-256', x: key.x, y: key.y };
  try { createPublicKey({ key: clean, format: 'jwk' }); } catch { throw new NativeError(400, 'Invalid device key.'); }
  return clean;
}

function envelope(value) {
  require(value && typeof value === 'object' && /^[A-Za-z0-9+/]{16}$/.test(value.iv) && typeof value.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value.data) && value.data.length >= 24 && value.data.length <= 2048 && value.data.length % 4 === 0, 400, 'Invalid encrypted recovery key.');
  return { publicKey: publicKey(value.publicKey), iv: value.iv, data: value.data };
}

export function nativeRoute(request) {
  const path = new URL(request.url).pathname;
  return request.method === 'GET' && ['/api/config', '/api/me', '/api/sync', '/api/sync-part', '/api/calendar/accounts', '/api/gmail/accounts', '/api/gmail/progress', '/api/native/approval', '/api/devices'].includes(path)
    || request.method === 'POST' && ['/api/device-links/presence','/api/device-links/list','/api/device-links/start','/api/device-links/cancel','/api/device-links/deny','/api/device-links/channel','/api/device-links/approve','/api/device-links/remove','/api/publications/status', '/api/publications/publish', '/api/publications/unpublish', '/api/sync', '/api/native/revoke', '/api/native/approve', '/api/devices/name', '/api/mobile-relay/channels', '/api/mobile-relay/remove', ...['progress', 'connect', 'disconnect', 'messages', 'message', 'thread', 'counts', 'modify', 'send'].map((action) => `/api/gmail/${action}`), ...['connect', 'disconnect', 'calendars', 'events', 'create', 'update', 'delete'].map((action) => `/api/calendar/${action}`)].includes(path);
}

export async function authenticateNative(request, sql) {
  require(!request.headers.has('origin') && nativeRoute(request), 403, 'This native session cannot use this route.');
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') || '')?.[1];
  require(token, 401, 'Reconnect this device to your account.');
  const [session] = await sql`SELECT id,owner,account_name,sync_requires_link,expires_at,(expires_at<now()+interval '29 days' OR last_seen IS NULL OR last_seen<now()-interval '5 minutes') AS renew FROM native_sessions WHERE credential_hash=${hash(token)} AND revoked_at IS NULL AND expires_at>now()`;
  require(session, 401, 'This connection expired or was revoked. Reconnect this device.');
  // A device in use stays signed in, and the device list says when it was last online. One write in five minutes at most.
  if (session.renew) [{ expires_at: session.expires_at }] = await sql`UPDATE native_sessions SET last_seen=now(),expires_at=now()+interval '30 days' WHERE id=${session.id} RETURNING expires_at`;
  return { user: { id: session.owner, name: session.account_name }, sessionId: session.id, syncRequiresLink:session.sync_requires_link, expiresAt: session.expires_at };
}

export async function nativePublicRequest({ request, sql, readBody, origin }) {
  require(request.method === 'POST' && !request.headers.has('origin') && !request.headers.has('authorization'), 403, 'Use the installed app to start this connection.');
  const body = await readBody(request, 4096), path = new URL(request.url).pathname;
  if (path === '/api/native/start') {
    require(typeof body.challenge === 'string' && /^[a-f0-9]{64}$/.test(body.challenge), 400, 'Invalid connection challenge.');
    require(typeof body.deviceName === 'string' && body.deviceName.trim().length > 0 && body.deviceName.length <= 80 && !/[\u0000-\u001f]/.test(body.deviceName), 400, 'Enter a device name.');
    const key = publicKey(body.publicKey), id = randomUUID();
    const result = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('native-start',0))`;
      await tx`DELETE FROM native_requests WHERE expires_at<now()`;
      const [{ count }] = await tx`SELECT count(*)::int AS count FROM native_requests WHERE claimed_at IS NULL`;
      require(count < 1000, 429, 'Too many pending connections. Try again later.');
      const [row] = await tx`INSERT INTO native_requests(id,challenge,device_name,public_key,signin_only) VALUES(${id},${body.challenge},${body.deviceName.trim()},${tx.json(key)},${body.signinOnly===true}) RETURNING expires_at`;
      return row;
    });
    return json({ id, expiresAt: result.expires_at, approvalUrl: `${origin}/?connect=${id}` }, 201);
  }
  require(path === '/api/native/poll' && uuid(body.id) && typeof body.verifier === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.verifier), 400, 'Invalid connection.');
  return sql.begin(async (tx) => {
    const [pending] = await tx`SELECT *,expires_at>now() AS active FROM native_requests WHERE id=${body.id} FOR UPDATE`;
    require(pending && matches(hash(body.verifier), pending.challenge), 403, 'Invalid connection.');
    require(pending.active && !pending.claimed_at, 410, 'This connection expired or was already claimed. Start again.');
    if (!pending.owner) return json({ status: 'pending' });
    const token = randomBytes(32).toString('base64url'), sessionId = randomUUID();
    const [session] = await tx`INSERT INTO native_sessions(id,owner,account_name,device_name,credential_hash,sync_requires_link) VALUES(${sessionId},${pending.owner},${pending.account_name},${pending.device_name},${hash(token)},${pending.signin_only===true} AND EXISTS(SELECT 1 FROM sync_events WHERE owner=${pending.owner})) RETURNING expires_at`;
    await tx`UPDATE native_requests SET claimed_at=now(),key_envelope=NULL WHERE id=${body.id}`;
    return json({ status: 'approved', token, user: { id: pending.owner, name: pending.account_name }, expiresAt: session.expires_at, keyEnvelope: pending.key_envelope, signinOnly: pending.signin_only });
  });
}

// A code is short enough to guess, so each account gets ten tries in ten minutes.
async function byCode(sql, owner, code) {
  require(/^[\da-f]{8}$/i.test(code), 400, 'Enter the 8-character code from your new device.');
  require(await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`native-code:${owner}`},0))`;
    await tx`DELETE FROM native_code_lookups WHERE at<now()-interval '10 minutes'`;
    const [{ count }] = await tx`SELECT count(*)::int AS count FROM native_code_lookups WHERE owner=${owner}`;
    if (count < 10) await tx`INSERT INTO native_code_lookups(owner) VALUES(${owner})`;
    return count < 10;
  }), 429, 'Too many codes tried. Wait ten minutes, then try again.');
  const rows = await sql`SELECT id FROM native_requests WHERE id BETWEEN ${`${code}-0000-0000-0000-000000000000`} AND ${`${code}-ffff-ffff-ffff-ffffffffffff`} AND expires_at>now() AND owner IS NULL AND claimed_at IS NULL LIMIT 2`;
  require(rows.length, 404, 'No device is waiting with that code. Check the code on your new device.');
  require(rows.length === 1, 409, 'Two devices show this code. Start again on your new device.');
  return rows[0].id;
}

export async function nativeAccountRequest({ request, sql, user, session, allowed, readBody }) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/native/revoke-all') {
    return sql.begin(async (tx) => {
      // Wait out claims and approvals in flight, so none lands between the two writes.
      await tx`LOCK TABLE native_requests IN EXCLUSIVE MODE`;
      await tx`UPDATE native_sessions SET revoked_at=now() WHERE owner=${user.id} AND revoked_at IS NULL`;
      await tx`DELETE FROM native_requests WHERE owner=${user.id}`;
      return json({ ok: true });
    });
  }
  require(allowed, 403, 'Cloud access has not been enabled for this account yet.');
  if (request.method === 'GET' && url.pathname === '/api/native/approval') {
    const code = url.searchParams.get('code'), id = code === null ? url.searchParams.get('id') : await byCode(sql, user.id, code);
    require(uuid(id), 400, 'Invalid connection.');
    const [pending] = await sql`SELECT id,device_name,public_key,expires_at,signin_only FROM native_requests WHERE id=${id} AND expires_at>now() AND owner IS NULL AND claimed_at IS NULL`;
    require(pending, 410, 'This connection expired or was already approved. Start again on your new device.');
    return json({ id: pending.id, deviceName: pending.device_name, publicKey: pending.public_key, expiresAt: pending.expires_at, signinOnly:pending.signin_only });
  }
  require(request.method === 'POST' && url.pathname === '/api/native/approve', 404, 'Not found.');
  const body = await readBody(request, 4096);
  require(uuid(body.id), 400, 'Invalid connection.');
  if(body.signinOnly===true){
    require(!session,403,'Sign in using the browser on the new device.');
    const result=await sql`UPDATE native_requests SET owner=${user.id},account_name=${String(user.name||'Your account').slice(0,80)} WHERE id=${body.id} AND signin_only AND expires_at>now() AND owner IS NULL AND claimed_at IS NULL RETURNING id`;
    require(result.length,410,'This sign-in expired or was already used.');
    return json({ok:true});
  }
  const key = envelope(body.keyEnvelope), device = session ?? null;
  // A device sign-in ended while this ran must not leave an approval behind.
  const rows = await sql`UPDATE native_requests SET owner=${user.id},account_name=${String(user.name || 'Your account').slice(0,80)},key_envelope=${sql.json(key)} WHERE id=${body.id} AND NOT signin_only AND expires_at>now() AND owner IS NULL AND claimed_at IS NULL AND (${device}::uuid IS NULL OR EXISTS(SELECT 1 FROM native_sessions WHERE id=${device} AND revoked_at IS NULL)) RETURNING id`;
  require(rows.length === 1, 410, 'This connection expired or was already approved. Start again on your new device.');
  return json({ ok: true });
}

// The installed apps signed in to an account. Browsers hold no row here, so they are not listed.
export async function devicesRequest({ request, sql, user, session, readBody }) {
  const path = new URL(request.url).pathname;
  // Kept apart from the name, so a renamed iPad is still drawn as an iPad.
  const kind = sql`coalesce(kind, CASE WHEN device_name ~* 'iphone' THEN 'iphone' WHEN device_name ~* 'ipad' THEN 'ipad' ELSE 'mac' END)`;
  if (request.method === 'GET' && path === '/api/devices') {
    const rows = await sql`SELECT id,device_name,${kind} AS kind,created_at,last_seen FROM native_sessions WHERE owner=${user.id} AND revoked_at IS NULL AND expires_at>now() ORDER BY coalesce(last_seen,created_at) DESC LIMIT 50`;
    return json({ devices: rows.map((d) => ({ id: d.id, name: d.device_name, kind: d.kind, createdAt: d.created_at, lastSeen: d.last_seen, current: d.id === session })) });
  }
  require(request.method === 'POST', 404, 'Not found.');
  const body = await readBody(request, 1024);
  if (path === '/api/devices/name') {
    require(session, 403, 'Rename a device in its own app.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    require(name && name.length <= 40 && !/[\u0000-\u001f]/.test(name), 400, 'Enter a name of up to 40 characters.');
    await sql`UPDATE native_sessions SET kind=${kind},device_name=${name} WHERE id=${session} AND owner=${user.id}`;
    return json({ ok: true });
  }
  require(path === '/api/devices/remove', 404, 'Not found.');
  // As with signing every device out (decision 48), a device sign-in cannot end another's.
  require(!session, 403, 'Remove a device at leadinglight.app.');
  require(uuid(body.id), 400, 'Invalid device.');
  const rows = await sql`UPDATE native_sessions SET revoked_at=now() WHERE id=${body.id} AND owner=${user.id} AND revoked_at IS NULL RETURNING id`;
  require(rows.length === 1, 404, 'That device is no longer on this account.');
  return json({ ok: true });
}

export async function revokeNative(sql, session) {
  await sql`UPDATE native_sessions SET revoked_at=now() WHERE id=${session.sessionId} AND owner=${session.user.id}`;
  return json({ ok: true });
}
