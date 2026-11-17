import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Seam: failed or mismatched cloud deploys must stop before an app can be published.
test('deploys the pinned source, checks it afterward, and propagates every failure', async () => {
  const dir = await mkdtemp(`${tmpdir()}/leadinglight-deploy-test-`), sha = 'a'.repeat(40);
  try {
    for (const [name, body] of Object.entries({
      git: 'printf "%s" "$CHECKOUT_SHA"',
      pnpm: 'printf "%s\\n" "deploy $*" >> "$CALLS"; exit "${DEPLOY_EXIT:-0}"',
      node: 'printf "%s\\n" "check $*" >> "$CALLS"; exit "${CHECK_EXIT:-0}"',
    })) await writeFile(`${dir}/${name}`, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: `${dir}/calls`, CHECKOUT_SHA: sha, RELEASE_SHA: sha, VERCEL_TOKEN: 'fixture', VERCEL_ORG_ID: 'team_fixture', VERCEL_PROJECT_ID: 'prj_fixture' };
    const run = async (overrides = {}) => {
      await writeFile(env.CALLS, '');
      try { await promisify(execFile)('bash', [fileURLToPath(new URL('./deploy-cloud.sh', import.meta.url)), '/release source'], { env: { ...env, ...overrides } }); return 0; }
      catch (error) { return error.code; }
    };
    assert.equal(await run(), 0);
    const calls = (await readFile(env.CALLS, 'utf8')).trim().split('\n');
    assert.match(calls[0], /vercel@65\.7\.0 deploy --cwd \/release source --prod --yes/);
    assert.ok(calls[0].endsWith(`--meta leadinglightReleaseSha=${sha}`));
    assert.match(calls[1], /^check .*check-cloud\.mjs$/);
    assert.equal(calls.length, 2);
    assert.equal(await run({ DEPLOY_EXIT: '7' }), 7);
    assert.doesNotMatch(await readFile(env.CALLS, 'utf8'), /check /);
    assert.equal(await run({ CHECK_EXIT: '9' }), 9);
    for (const missing of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'RELEASE_SHA']) {
      assert.notEqual(await run({ [missing]: '' }), 0);
      assert.equal(await readFile(env.CALLS, 'utf8'), '');
    }
    assert.equal(await run({ CHECKOUT_SHA: 'b'.repeat(40) }), 1);
    assert.equal(await readFile(env.CALLS, 'utf8'), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
