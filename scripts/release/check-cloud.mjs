import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function checkCloud(origin, send = fetch) {
  const request = (path, options) => send(new URL(path, origin), {
    redirect: 'manual', signal: AbortSignal.timeout(15_000), ...options,
  });
  // A fresh invalid credential reaches the route gate without using an account or writing data.
  const authorization = `Bearer ${randomBytes(32).toString('base64url')}`;
  for (const action of ['status', 'publish', 'unpublish']) {
    const response = await request(`/api/publications/${action}`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 401, `Native publications/${action} must reach authentication`);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const token = randomBytes(24).toString('base64url');
  const missing = await request(`/api/published/${token}`);
  assert.equal(missing.status, 404, 'The public reader API must find no page for a random link');
  assert.equal((await missing.json()).error, 'This page is unavailable.');
  const reader = await request(`/p/${token}`);
  assert.equal(reader.status, 200, 'The shared-page reader must be deployed');
  const html = await reader.text();
  assert.match(html, /<title>Shared page · LeadingLight<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive"/);
  for (const response of [missing, reader]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkCloud(process.argv[2] || 'https://leadinglight.app');
    console.log('Deployed cloud supports native publishing and the unlisted reader.');
  } catch (error) {
    console.error(`Cloud release check failed: ${error.message}\nDeploy the matching cloud service, then retry. See docs/RELEASING.md.`);
    process.exitCode = 1;
  }
}
