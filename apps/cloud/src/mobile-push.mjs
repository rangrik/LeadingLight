import { createPrivateKey, sign } from 'node:crypto';
import { connect } from 'node:http2';

const topic = 'com.leadinglight.app';
let cached;
export const pushReady = (env, environment) => Boolean(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY && (!environment || env.APNS_ENVIRONMENT === 'both' || environment === (env.APNS_ENVIRONMENT || 'production')));

function authorization(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cached?.key === env.APNS_PRIVATE_KEY && cached.kid === env.APNS_KEY_ID && cached.team === env.APNS_TEAM_ID && now - cached.time < 2400 && now >= cached.time) return cached.jwt;
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${b64({ alg: 'ES256', kid: env.APNS_KEY_ID })}.${b64({ iss: env.APNS_TEAM_ID, iat: now })}`;
  const key = createPrivateKey(env.APNS_PRIVATE_KEY.replace(/\\n/g, '\n'));
  const signature = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  cached = { key: env.APNS_PRIVATE_KEY, kid: env.APNS_KEY_ID, team: env.APNS_TEAM_ID, time: now, jwt: `${data}.${signature}` };
  return cached.jwt;
}

export function pushPayload(channel, id, envelope) {
  return { aps: { alert: { title: 'LeadingLight', body: 'An agent on your Mac needs your response.' }, sound: 'default' }, ll: { channel, id, envelope } };
}

export async function sendPush(env, device, payload, id) {
  if (!pushReady(env, device.environment)) throw new Error('Push environment is not configured.');
  const jwt = authorization(env), body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 4096) throw new Error('Notification is too large.');
  return new Promise((resolve, reject) => {
    const client = connect(device.environment === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');
    let done = false;
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); client.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('Push service timed out.')), 8000);
    client.on('error', () => finish(new Error('Push service unavailable.')));
    const request = client.request({ ':method': 'POST', ':path': `/3/device/${device.token}`, authorization: `bearer ${jwt}`, 'apns-topic': topic, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 300), 'apns-collapse-id': id, 'apns-id': id });
    let status = 0, response = '';
    request.on('response', (headers) => { status = Number(headers[':status']); });
    request.on('data', (chunk) => { response += chunk.toString(); if (response.length > 8192) finish(new Error('Invalid push service response.')); });
    request.on('error', () => finish(new Error('Push delivery interrupted.')));
    request.on('end', () => {
      let reason; try { reason = JSON.parse(response).reason; } catch { /* APNs success has no body. */ }
      finish(null, { ok: status === 200, invalid: status === 410 || status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(reason) });
    });
    request.end(body);
  });
}

export async function mobilePushRequest({ sql, body, path, authorize, validateEnvelope, require, uuid, env, sender = sendPush }) {
  const json = (value) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
  const connection = await sql.begin(authorize);
  const channel = connection.id;
  if (path !== 'native/notify') {
    require(uuid(body.device), 400, 'Invalid notification device.');
    if (path === 'native/notification-status') {
      const [row] = await sql`SELECT id FROM mobile_push_devices WHERE channel=${channel} AND id=${body.device}`;
      return json({ ready: pushReady(env), registered: Boolean(row) });
    }
    if (path === 'native/unregister-notifications') {
      await sql`DELETE FROM mobile_push_devices WHERE channel=${channel} AND id=${body.device}`;
      return json({ registered: false });
    }
    require(pushReady(env), 503, 'Background notifications are not configured yet. Requests remain available in the app.');
    require(typeof body.token === 'string' && /^[a-f0-9]{32,512}$/.test(body.token) && body.token.length % 2 === 0, 400, 'Invalid notification token.');
    require(['sandbox', 'production'].includes(body.environment), 400, 'Invalid notification environment.');
    require(pushReady(env, body.environment), 503, 'Notifications are not configured for this signed app. Requests remain available in the app.');
    await sql.begin(async (tx) => {
      await authorize(tx);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${body.token},3))`;
      await tx`DELETE FROM mobile_push_devices WHERE token=${body.token} AND environment=${body.environment} AND (channel<>${channel} OR id<>${body.device})`;
      await tx`DELETE FROM mobile_push_devices WHERE channel=${channel} AND id=${body.device} AND (token<>${body.token} OR environment<>${body.environment})`;
      const [{ count }] = await tx`SELECT count(*)::int AS count FROM mobile_push_devices WHERE channel=${channel} AND id<>${body.device}`;
      require(count < 10, 429, 'Too many notification devices for this Mac.');
      await tx`INSERT INTO mobile_push_devices(channel,id,token,environment) VALUES(${channel},${body.device},${body.token},${body.environment}) ON CONFLICT(channel,id) DO UPDATE SET token=excluded.token,environment=excluded.environment,updated_at=now()`;
    });
    return json({ registered: true });
  }
  require(uuid(body.id), 400, 'Invalid notification identity.');
  const envelope = validateEnvelope(body.envelope, 2800);
  require(pushReady(env), 503, 'Background notifications are not configured yet.');
  const deliveries = await sql.begin(async (tx) => {
    await authorize(tx);
    await tx`DELETE FROM mobile_push_events WHERE channel=${channel} AND created_at<now()-interval '7 days'`;
    const [event] = await tx`SELECT id FROM mobile_push_events WHERE channel=${channel} AND id=${body.id}`;
    if (!event) {
      const [{ count }] = await tx`SELECT count(*)::int AS count FROM mobile_push_events WHERE channel=${channel} AND created_at>now()-interval '1 hour'`;
      require(count < 120, 429, 'Too many agent notifications. Requests remain available in the app.');
      await tx`INSERT INTO mobile_push_events(channel,id,envelope) VALUES(${channel},${body.id},${tx.json(envelope)})`;
    }
    await tx`INSERT INTO mobile_push_deliveries(channel,event,device) SELECT ${channel},${body.id},id FROM mobile_push_devices WHERE channel=${channel} ON CONFLICT DO NOTHING`;
    return tx`UPDATE mobile_push_deliveries d SET claimed_at=now() FROM mobile_push_devices p,mobile_push_events e WHERE d.channel=${channel} AND d.event=${body.id} AND p.channel=d.channel AND p.id=d.device AND e.channel=d.channel AND e.id=d.event AND d.sent_at IS NULL AND (d.claimed_at IS NULL OR d.claimed_at<now()-interval '30 seconds') RETURNING d.device,p.token,p.environment,e.envelope`;
  });
  await Promise.all(deliveries.map(async (device) => {
    let result;
    try { result = await sender(env, device, pushPayload(channel, body.id, device.envelope), body.id); } catch { return; }
    if (result.ok) await sql`UPDATE mobile_push_deliveries d SET sent_at=now() FROM mobile_push_devices p WHERE d.channel=${channel} AND d.event=${body.id} AND d.device=${device.device} AND p.channel=d.channel AND p.id=d.device AND p.token=${device.token} AND p.environment=${device.environment}`;
    if (result.invalid) await sql`DELETE FROM mobile_push_devices WHERE channel=${channel} AND id=${device.device} AND token=${device.token} AND environment=${device.environment}`;
  }));
  const [{ delivered, pending }] = await sql`SELECT count(*) FILTER(WHERE sent_at IS NOT NULL)::int AS delivered,count(*) FILTER(WHERE sent_at IS NULL)::int AS pending FROM mobile_push_deliveries WHERE channel=${channel} AND event=${body.id}`;
  return json({ delivered, pending: pending > 0 });
}
