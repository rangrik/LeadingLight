import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { application } from './app.mjs';
import { database } from './database.mjs';

const origin = 'https://notes.test', options = { skip: !process.env.TEST_DATABASE_URL };
const hash = (text) => createHash('sha256').update(text).digest('hex');
const auth = { ready: true, providers: [], user: async (request) => request.headers.has('test-user') ? { id: request.headers.get('test-user'), name: 'Test account' } : null };
const appFor = (sql) => application({ env: { APP_ORIGIN: origin, CLOUD_ACCESS: 'public' }, sql, auth });
const call = (app, path, body, headers = {}, method = body ? 'POST' : 'GET') => app(new Request(`${origin}/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));

async function fixture(run) {
  const sql = database(process.env.TEST_DATABASE_URL), owner = `native-${randomUUID()}`, other = `native-${randomUUID()}`, ids = [];
  await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const app = appFor(sql);
  const browser = (path, body, user = owner, source = origin) => call(app, path, body, { origin: source, ...(user ? { 'test-user': user } : {}) });
  const native = (path, body, token, headers = {}) => call(app, path, body, { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers });
  const start = async () => {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const publicKey = await webcrypto.subtle.exportKey('jwk', keys.publicKey), verifier = randomBytes(32).toString('base64url');
    const response = await native('native/start', { publicKey, challenge: hash(verifier), deviceName: 'Test iPad' });
    assert.equal(response.status, 201);
    const pending = await response.json(); ids.push(pending.id);
    return { ...pending, verifier, keys };
  };
  const approve = async (pending, user = owner, token) => {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const key = await webcrypto.subtle.deriveKey({ name: 'ECDH', public: pending.keys.publicKey }, keys.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = randomBytes(12), recovery = randomBytes(32).toString('base64');
    const data = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(`leadinglight-native:${pending.id}:${user}`) }, key, Buffer.from(recovery));
    const keyEnvelope = { publicKey: await webcrypto.subtle.exportKey('jwk', keys.publicKey), iv: iv.toString('base64'), data: Buffer.from(data).toString('base64') };
    assert.equal((await (token ? native('native/approve', { id: pending.id, keyEnvelope }, token) : browser('native/approve', { id: pending.id, keyEnvelope }, user))).status, 200);
    return { keyEnvelope, recovery };
  };
  const claim = async (pending) => {
    const result = await native('native/poll', { id: pending.id, verifier: pending.verifier });
    assert.equal(result.status, 200); return result.json();
  };
  try { await run({ sql, owner, other, app, browser, native, start, approve, claim }); }
  finally {
    await sql`DELETE FROM mobile_connections WHERE owner IN (${owner},${other})`;
    await sql`DELETE FROM native_requests WHERE id IN ${sql(ids.length ? ids : [randomUUID()])}`;
    await sql`DELETE FROM native_sessions WHERE owner IN (${owner},${other})`;
    await sql`DELETE FROM native_code_lookups WHERE owner IN (${owner},${other})`;
    await sql`DELETE FROM sync_events WHERE owner IN (${owner},${other})`;
    await sql.end();
  }
}

// Browser origins and bearer credentials must not cross their authentication boundary.
test('native authentication preserves browser origin checks and route scope', async () => {
  const app = appFor(() => { throw new Error('Unexpected database access'); });
  assert.equal((await call(app, 'native/start', {}, { origin })).status, 403);
  assert.equal((await call(app, 'native/approve', {}, { origin: 'https://evil.test', 'test-user': 'owner' })).status, 403);
  assert.equal((await call(app, 'native/approve', {}, { origin })).status, 401);
  for (const path of ['relay/pairs', 'native/revoke-all', 'auth/signout']) {
    assert.equal((await call(app, path, {}, { authorization: `Bearer ${randomBytes(32).toString('base64url')}` })).status, 403);
  }
  assert.equal((await call(app, 'sync', {}, { authorization: `Bearer ${randomBytes(32).toString('base64url')}`, origin })).status, 403);
  for (const path of ['sync', 'native/approve']) {
    assert.equal((await call(app, path, {}, { origin, 'test-user': 'new-account', 'x-leadinglight-owner': 'previous-account' })).status, 409);
  }
});

// Native account routing must admit connection setup without admitting browser credential reuse.
test('native Mac sessions register and remove only their own mobile connection', options, () => fixture(async ({ sql, owner, other, native, start, approve, claim }) => {
  const pending = await start(); await approve(pending); const session = await claim(pending);
  assert.equal((await native('mobile-relay/channels', {}, session.token, { origin })).status, 403);
  assert.equal((await native('mobile-relay/channels', {}, session.token, { 'x-leadinglight-owner': other })).status, 409);
  const created = await native('mobile-relay/channels', {}, session.token, { 'x-leadinglight-owner': owner });
  assert.equal(created.status, 201); const connection = await created.json();
  const another = await start(); await approve(another, other); const second = await claim(another);
  assert.equal((await native('mobile-relay/remove', { channel: connection.channel }, second.token)).status, 200);
  assert.equal((await sql`SELECT owner FROM mobile_connections WHERE id=${connection.channel}`)[0].owner, owner);
  assert.equal((await native('mobile-relay/remove', { channel: connection.channel }, session.token)).status, 200);
  assert.equal((await sql`SELECT id FROM mobile_connections WHERE id=${connection.channel}`).length, 0);
  assert.equal((await native('native/revoke', {}, session.token)).status, 200);
  assert.equal((await native('mobile-relay/channels', {}, session.token)).status, 401);
}));

// Approval transfers only encrypted key bytes; concurrent polls may issue one session.
test('approved key handoff is encrypted, account-bound and claimed once', options, () => fixture(async ({ sql, owner, other, browser, native, start, approve }) => {
  const pending = await start();
  const metadata = await (await browser(`native/approval?id=${pending.id}`)).json();
  assert.equal(metadata.deviceName, 'Test iPad'); assert.ok(!('challenge' in metadata));
  assert.deepEqual(await (await native('native/poll', { id: pending.id, verifier: pending.verifier })).json(), { status: 'pending' });
  assert.equal((await native('native/poll', { id: pending.id, verifier: randomBytes(32).toString('base64url') })).status, 403);
  const { keyEnvelope, recovery } = await approve(pending);
  assert.equal((await browser('native/approve', { id: pending.id, keyEnvelope }, other)).status, 410);
  const replies = await Promise.all([1, 2].map(() => native('native/poll', { id: pending.id, verifier: pending.verifier })));
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 410]);
  const session = await replies.find((r) => r.status === 200).json();
  assert.equal(session.user.id, owner); assert.match(session.token, /^[\w-]{43}$/);
  const sender = await webcrypto.subtle.importKey('jwk', session.keyEnvelope.publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await webcrypto.subtle.deriveKey({ name: 'ECDH', public: sender }, pending.keys.privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const decrypted = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(session.keyEnvelope.iv, 'base64'), additionalData: Buffer.from(`leadinglight-native:${pending.id}:${owner}`) }, key, Buffer.from(session.keyEnvelope.data, 'base64'));
  assert.equal(Buffer.from(decrypted).toString(), recovery);
  const [stored] = await sql`SELECT * FROM native_requests WHERE id=${pending.id}`;
  const [credential] = await sql`SELECT * FROM native_sessions WHERE owner=${owner}`;
  assert.equal(stored.key_envelope, null); assert.equal(credential.credential_hash, hash(session.token));
  const persisted = JSON.stringify({ stored, credential });
  for (const secret of [pending.verifier, session.token, recovery]) assert.ok(!persisted.includes(secret));
  assert.ok(new Date(session.expiresAt).getTime() > Date.now() + 29 * 86400000);
}));

// A device sign-in approves into its own account only, cannot guess codes, and ends when the browser says so.
test('a syncing device approves by code and the browser signs every device out', options, () => fixture(async ({ owner, browser, native, start, approve, claim }) => {
  const first = await start(); await approve(first); const { token } = await claim(first);
  const second = await start(), code = second.id.slice(0, 8).toUpperCase();
  assert.equal((await (await native(`native/approval?code=${code}`, undefined, token)).json()).id, second.id);
  await approve(second, owner, token);
  const joined = await claim(second);
  assert.equal(joined.user.id, owner);
  const waiting = await start(); await approve(waiting, owner, joined.token);
  for (let tries = 2; tries <= 10; tries++) assert.equal((await native('native/approval?code=00000000', undefined, token)).status, 404);
  assert.equal((await native(`native/approval?code=${code}`, undefined, token)).status, 429);
  assert.equal((await native('native/revoke-all', {}, token)).status, 403);
  assert.equal((await browser('native/revoke-all', {})).status, 200);
  for (const ended of [token, joined.token]) assert.equal((await native('me', undefined, ended)).status, 401);
  assert.equal((await native('native/poll', { id: waiting.id, verifier: waiting.verifier })).status, 403);
}));

// The device list is one account's own; only the browser removes a device, and only a device names itself.
test('devices are listed per account, named by themselves and removed by the browser', options, () => fixture(async ({ sql, owner, other, browser, native, start, approve, claim }) => {
  const a = await start(), b = await start(), c = await start();
  await approve(a); await approve(b); await approve(c, other);
  const mac = await claim(a), pad = await claim(b), theirs = await claim(c);
  assert.equal((await native('devices/name', { name: ' Studio ' }, pad.token)).status, 200);
  assert.equal((await native('devices/name', { name: 'x'.repeat(41) }, pad.token)).status, 400);
  const list = (await (await native('devices', undefined, mac.token)).json()).devices;
  assert.deepEqual(list.map((d) => [d.name, d.kind, d.current]).sort(), [['Studio', 'ipad', false], ['Test iPad', 'ipad', true]]);
  const studio = list.find((d) => d.name === 'Studio').id;
  assert.equal((await native('devices/remove', { id: studio }, mac.token)).status, 403);
  assert.equal((await browser('devices/name', { name: 'Mine' })).status, 403);
  assert.equal((await browser('devices/remove', { id: studio }, other)).status, 404);
  assert.equal((await browser('devices/remove', { id: studio })).status, 200);
  assert.equal((await native('me', undefined, pad.token)).status, 401);
  assert.equal((await (await browser('devices')).json()).devices.length, 1);
  assert.equal((await (await native('devices', undefined, theirs.token)).json()).devices.length, 1);
  // A browser sign-in that knows its provider tells the account's apps which sign-in they use.
  const signedIn = { ...auth, user: async () => ({ id: owner, name: 'Test account', provider: 'google', email: 'a@example.test' }) };
  await application({ env: { APP_ORIGIN: origin, CLOUD_ACCESS: 'public' }, sql, auth: signedIn })(new Request(`${origin}/api/me`));
  const me = await (await native('me', undefined, mac.token)).json();
  assert.deepEqual([me.provider, me.email], ['google', 'a@example.test']);
  assert.equal((await (await native('me', undefined, theirs.token)).json()).provider, undefined);
  await sql`DELETE FROM accounts WHERE owner=${owner}`;
}));

// An expired request, expired session or revoked device must not regain access.
test('expiry, revocation and encrypted sync stay isolated between accounts', options, () => fixture(async ({ sql, owner, other, browser, native, start, approve, claim }) => {
  const expired = await start();
  await sql`UPDATE native_requests SET expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
  assert.equal((await browser(`native/approval?id=${expired.id}`)).status, 410);
  assert.equal((await native('native/poll', { id: expired.id, verifier: expired.verifier })).status, 410);
  const a = await start(), b = await start(); const approved = await approve(a); await approve(b, other);
  assert.equal((await browser('native/approve', { id: expired.id, keyEnvelope: approved.keyEnvelope })).status, 410);
  const first = await claim(a), second = await claim(b);
  const event = { id: randomUUID(), envelope: { v: 1, iv: 'opaque-iv', data: 'encrypted-note' } };
  assert.equal((await native('sync', event, second.token, { 'x-leadinglight-owner': owner })).status, 409);
  assert.equal((await native('sync', event, first.token)).status, 200);
  assert.equal((await (await native('sync', undefined, first.token)).json()).events.length, 1);
  assert.deepEqual((await (await native('sync', undefined, second.token)).json()).events, []);
  assert.equal((await (await native('me', undefined, first.token)).json()).id, owner);
  // Use renews a sign-in that is close to its end; one that ended stays ended.
  await sql`UPDATE native_sessions SET expires_at=now()+interval '1 day' WHERE owner=${owner}`;
  assert.ok(new Date((await (await native('me', undefined, first.token)).json()).expiresAt).getTime() > Date.now() + 29 * 86400000);
  assert.equal((await native('native/revoke', {}, first.token)).status, 200);
  assert.equal((await native('me', undefined, first.token)).status, 401);
  await sql`UPDATE native_sessions SET expires_at=now()-interval '1 second' WHERE owner=${other}`;
  assert.equal((await native('me', undefined, second.token)).status, 401);
  assert.ok((await sql`SELECT expires_at<now() AS ended FROM native_sessions WHERE owner=${other}`)[0].ended);
  assert.equal((await native('config', undefined, second.token)).status, 401);
  assert.equal((await (await native('config')).json()).ready, true);
}));

test('number matching gives one signed-in device one project and revoking it closes its relay', options, () => fixture(async ({ sql, owner, other, native, start, approve, claim }) => {
  const device=async user=>{
    const pending=await start();await approve(pending,user);
    const {token}=await claim(pending);
    const key=await webcrypto.subtle.exportKey('jwk',pending.keys.publicKey);
    const call=(path,body)=>native('device-links/'+path,body,token);
    const presence=await call('presence',{key,sync:true,projects:['project-A']});
    assert.equal(presence.status,200);
    return {id:(await presence.json()).session,call,token};
  };
  const host=await device(owner),phone=await device(owner),outsider=await device(other);
  await sql`UPDATE native_sessions SET sync_requires_link=true WHERE id=${phone.id}`;
  const sync=()=>native('sync?after=0',undefined,phone.token);
  assert.equal((await sync()).status,403);
  assert.equal((await phone.call('start',{target:outsider.id,project:null})).status,409);
  assert.equal((await phone.call('start',{target:host.id,project:'unlinked'})).status,409);
  const {id}=await (await phone.call('start',{target:host.id,project:'project-A'})).json();
  const envelope={iv:'A'.repeat(16),data:'A'.repeat(24)};
  assert.equal((await outsider.call('deny',{id})).status,404);
  assert.equal((await phone.call('approve',{id,envelope})).status,409);
  const {channel,clientToken}=await (await host.call('channel',{id})).json();
  assert.ok(channel);
  const access=()=>native('mobile-relay/native/notification-status',{channel,device:'9a23b54d-8281-4f44-80e5-489f3169aa07'},clientToken);
  assert.equal((await access()).status,403);
  assert.equal((await host.call('approve',{id,envelope})).status,200);
  assert.equal((await sync()).status,200);
  assert.equal((await access()).status,200);
  assert.equal((await host.call('approve',{id,envelope})).status,409);
  const mine=(await (await phone.call('list',{})).json()).links.find(l=>l.id===id);
  assert.deepEqual(mine.envelope,envelope);
  assert.equal((await phone.call('remove',{id})).status,200);
  assert.equal((await sync()).status,403);
  assert.equal((await access()).status,403);
  for(const end of ['cancel','deny','expire']){
    const {id}=await (await phone.call('start',{target:host.id,project:null})).json();
    assert.equal((await host.call('channel',{id})).status,409);
    if(end==='expire')await sql`UPDATE device_links SET expires_at=now()-interval '1 minute' WHERE id=${id}`;
    else assert.equal((await (end==='deny'?host:phone).call(end,{id})).status,200);
    assert.equal((await host.call('approve',{id,envelope})).status,409);
  }
}));
