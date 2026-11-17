import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database } from './database.mjs';
import { application } from './app.mjs';
import { nativeRoute } from './native.mjs';

const origin = 'https://notes.test';
const auth = { ready: true, providers: [], user: async (req) => req.headers.has('test-user') ? { id: req.headers.get('test-user') } : null };
const snapshot = { version: 1, title: 'Shared page', description: '', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'note', attrs: { id: 'n1' } }] }] }] }, notes: [{ id: 'n1', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A sidenote' }] }] } }] };

// Seam: a public read token must never grant a write or reveal the owner's other pages.
test('public snapshots, ownership, stable updates and revocation', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = database(process.env.TEST_DATABASE_URL), owner = randomUUID(), other = randomUUID(), sessionId = randomUUID();
  const app = application({ env: { APP_ORIGIN: origin, CLOUD_ACCESS: 'public' }, sql, auth });
  const call = (path, user, body, method = body ? 'POST' : 'GET', source = origin) => app(new Request(origin + path, { method, headers: { origin: source, ...(user ? { 'test-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const manage = (action, user = owner, data = {}) => call(`/api/publications/${action}`, user, { page: 'page-a', ...data });
  try {
    await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    assert.equal((await manage('publish', null, { snapshot })).status, 401);
    assert.equal((await call('/api/publications/publish', owner, { page: 'page-a', snapshot }, 'POST', 'https://evil.test')).status, 403);
    const privateApp = application({ env: { APP_ORIGIN: origin }, sql, auth });
    assert.equal((await privateApp(new Request(origin + '/api/publications/publish', { method: 'POST', headers: { origin, 'test-user': owner }, body: JSON.stringify({ page: 'page-a', snapshot }) }))).status, 403);
    const published = await (await manage('publish', owner, { snapshot })).json();
    const url = published.publication.url, token = url.split('/').pop(), publicPath = `/api/published/${token}`;
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    const read = await call(publicPath);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal((await read.json()).notes[0].body.content[0].content[0].text, 'A sidenote');
    assert.equal((await call(publicPath, null, { snapshot }, 'POST')).status, 405);
    assert.equal((await call('/api/published/')).status, 404);
    assert.equal((await call('/api/published/page-a')).status, 404);
    assert.equal((await call(publicPath, null, undefined, 'HEAD')).status, 200);
    assert.equal((await (await manage('status', other)).json()).publication, null);
    await manage('unpublish', other);
    assert.equal((await call(publicPath)).status, 200);
    const updated = await (await manage('publish', owner, { snapshot: { ...snapshot, title: 'Updated' } })).json();
    assert.equal(updated.publication.url, url);
    assert.equal((await (await call(publicPath)).json()).title, 'Updated');
    const otherUrl = (await (await manage('publish', other, { snapshot })).json()).publication.url;
    assert.notEqual(otherUrl, url);
    const list = await (await call('/api/publications/status', owner, {})).json();
    assert.deepEqual(list.publications.map((item) => item.url), [url]);
    assert.equal((await call('/api/publications/status', null, {})).status, 401);
    const credential = randomBytes(32).toString('base64url'), hash = createHash('sha256').update(credential).digest('hex');
    await sql`INSERT INTO native_sessions(id,owner,account_name,device_name,credential_hash,expires_at) VALUES(${sessionId},${owner},'Test account','Test device',${hash},now()+interval '30 days')`;
    const native = await app(new Request(origin + '/api/publications/status', { method: 'POST', headers: { authorization: `Bearer ${credential}` }, body: JSON.stringify({ page: 'page-a' }) }));
    assert.equal(native.status, 200);
    assert.equal((await native.json()).publication.url, url);
    assert.equal((await manage('publish', owner, { snapshot: { ...snapshot, notes: 'invalid' } })).status, 400);
    assert.equal((await manage('publish', owner, { snapshot: { ...snapshot, description: 'x'.repeat(3_600_000) } })).status, 400);
    assert.equal((await (await call(publicPath)).json()).title, 'Updated');
    const restricted = (action, body) => privateApp(new Request(`${origin}/api/publications/${action}`, { method: 'POST', headers: { origin, 'test-user': owner }, body: JSON.stringify(body) }));
    assert.equal((await (await restricted('status', {})).json()).publications[0].url, url);
    assert.equal((await restricted('unpublish', { page: 'page-a' })).status, 200);
    const gone = await call(publicPath);
    assert.equal(gone.status, 404); assert.equal(gone.headers.get('cache-control'), 'no-store');
    const newUrl = (await (await manage('publish', owner, { snapshot })).json()).publication.url;
    assert.notEqual(newUrl, url);
    assert.equal((await call(publicPath)).status, 404);
  } finally { await sql`DELETE FROM native_sessions WHERE id=${sessionId}`; await sql`DELETE FROM publications WHERE owner IN (${owner},${other})`; await sql.end(); }
});

// Seam: installed apps use only explicit publication routes, and crawlers see noindex without JS.
test('native route scope and crawler metadata', async () => {
  for (const action of ['status', 'publish', 'unpublish']) assert.ok(nativeRoute(new Request(`${origin}/api/publications/${action}`, { method: 'POST' })));
  assert.equal(nativeRoute(new Request(`${origin}/api/publications/publish`)), false);
  assert.equal(nativeRoute(new Request(`${origin}/api/published/anything`, { method: 'POST' })), false);
  const html = await readFile(new URL('../../desktop/published.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive"/);
});
