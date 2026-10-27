import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkVersions } from './check-version.mjs';

// Seam: a release tag must match every embedded version, including Cargo's lockfile.
test('accepts one version and refuses each source of drift', () => {
  const read = (path) => readFileSync(path, 'utf8');
  const version = checkVersions(read);
  assert.equal(checkVersions(read, `v${version}`), version);
  assert.throws(() => checkVersions(read, 'v999.0.0'));
  for (const path of ['apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json',
    '.release-please-manifest.json', 'apps/desktop/src-tauri/Cargo.toml', 'Cargo.lock']) {
    assert.throws(() => checkVersions((p) => p === path ? read(p).replaceAll(version, '999.0.0') : read(p)));
  }
});
