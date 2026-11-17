import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCloud } from './check-cloud.mjs';

const origin = 'https://notes.test';
const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive' };
function deployed(url) {
  if (url.pathname.startsWith('/api/publications/')) return Response.json({ error: 'Invalid credential.' }, { status: 401 });
  if (url.pathname.startsWith('/api/published/')) return Response.json({ error: 'This page is unavailable.' }, { status: 404, headers });
  return new Response('<title>Shared page · LeadingLight</title><meta name="robots" content="noindex, nofollow, noarchive" />', { headers });
}

// Seam: a successful local build cannot release against an older cloud deployment.
test('checks deployed publishing without real credentials or page content', async () => {
  const calls = [];
  await checkCloud(origin, async (url, options) => { calls.push({ url, ...options }); return deployed(url); });
  assert.deepEqual(calls.slice(0, 3).map((c) => c.url.pathname), ['/api/publications/status', '/api/publications/publish', '/api/publications/unpublish']);
  for (const call of calls.slice(0, 3)) {
    assert.equal(call.method, 'POST'); assert.equal(call.body, '{}');
    assert.match(call.headers.authorization, /^Bearer [\w-]{43}$/);
    assert.equal(call.headers.origin, undefined);
  }
  for (const call of calls) assert.equal(call.redirect, 'manual');
  assert.equal(calls.length, 5);
  assert.equal(calls[3].headers, undefined);
  assert.equal(calls[4].headers, undefined);
});

test('refuses stale native routes, missing schema, missing reader and cached content', async () => {
  for (const [path, response] of [
    ...['status', 'publish', 'unpublish'].map((action) => [`/api/publications/${action}`, Response.json({ error: 'This native session cannot use this route.' }, { status: 403 })]),
    ['/api/published/', Response.json({ error: 'Service unavailable.' }, { status: 500 })],
    ['/p/', new Response('<title>LeadingLight</title>', { headers })],
    ['/p/', new Response('', { status: 307, headers: { location: '/' } })],
    ['/api/published/', Response.json({ error: 'This page is unavailable.' }, { status: 404 })],
  ]) await assert.rejects(checkCloud(origin, async (url) => url.pathname.startsWith(path) ? response : deployed(url)));
  await assert.rejects(checkCloud(origin, async () => { throw new Error('Offline'); }), /Offline/);
});
