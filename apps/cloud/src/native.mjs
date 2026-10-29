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
  return request.method === 'GET' && ['/api/config', '/api/me', '/api/sync', '/api/sync-part'].includes(path)
    || request.method === 'POST' && ['/api/sync', '/api/native/revoke'].includes(path);
}

export async function authenticateNative(request, sql) {
  require(!request.headers.has('origin') && nativeRoute(request), 403, 'This native session cannot use this route.');
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') || '')?.[1];
  require(token, 401, 'Reconnect this device to your account.');
  const [session] = await sql`SELECT id,owner,account_name,expires_at FROM native_sessions WHERE credential_hash=${hash(token)} AND revoked_at IS NULL AND expires_at>now()`;
  require(session, 401, 'This connection expired or was revoked. Reconnect this device.');
  return { user: { id: session.owner, name: session.account_name }, sessionId: session.id, expiresAt: session.expires_at };
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
      const [row] = await tx`INSERT INTO native_requests(id,challenge,device_name,public_key) VALUES(${id},${body.challenge},${body.deviceName.trim()},${tx.json(key)}) RETURNING expires_at`;
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
    const [session] = await tx`INSERT INTO native_sessions(id,owner,account_name,device_name,credential_hash) VALUES(${sessionId},${pending.owner},${pending.account_name},${pending.device_name},${hash(token)}) RETURNING expires_at`;
    await tx`UPDATE native_requests SET claimed_at=now(),key_envelope=NULL WHERE id=${body.id}`;
    return json({ status: 'approved', token, user: { id: pending.owner, name: pending.account_name }, expiresAt: session.expires_at, keyEnvelope: pending.key_envelope });
  });
}

export async function nativeBrowserRequest({ request, sql, user, allowed, readBody }) {
  require(allowed, 403, 'Cloud access has not been enabled for this account yet.');
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/native/approval') {
    const id = url.searchParams.get('id');
    require(uuid(id), 400, 'Invalid connection.');
    const [pending] = await sql`SELECT id,device_name,public_key,expires_at FROM native_requests WHERE id=${id} AND expires_at>now() AND owner IS NULL AND claimed_at IS NULL`;
    require(pending, 410, 'This connection expired or was already approved. Start again in the app.');
    return json({ id: pending.id, deviceName: pending.device_name, publicKey: pending.public_key, expiresAt: pending.expires_at });
  }
  require(request.method === 'POST' && url.pathname === '/api/native/approve', 404, 'Not found.');
  const body = await readBody(request, 4096);
  require(uuid(body.id), 400, 'Invalid connection.');
  const key = envelope(body.keyEnvelope);
  const rows = await sql`UPDATE native_requests SET owner=${user.id},account_name=${String(user.name || 'Your account').slice(0,80)},key_envelope=${sql.json(key)} WHERE id=${body.id} AND expires_at>now() AND owner IS NULL AND claimed_at IS NULL RETURNING id`;
  require(rows.length === 1, 410, 'This connection expired or was already approved. Start again in the app.');
  return json({ ok: true });
}

export async function revokeNative(sql, session) {
  await sql`UPDATE native_sessions SET revoked_at=now() WHERE id=${session.sessionId} AND owner=${session.user.id}`;
  return json({ ok: true });
}
