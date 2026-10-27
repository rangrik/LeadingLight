import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export function checkVersions(read, tag) {
  const json = (path) => JSON.parse(read(path));
  const version = json('apps/desktop/package.json').version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(json('apps/desktop/src-tauri/tauri.conf.json').version, version, 'Tauri version differs');
  assert.equal(json('.release-please-manifest.json')['.'], version, 'Release manifest differs');
  const cargo = read('apps/desktop/src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1];
  const lock = read('Cargo.lock').match(/name = "leadinglight-desktop"\r?\nversion = "([^"]+)"/)?.[1];
  assert.equal(cargo, version, 'Cargo version differs');
  assert.equal(lock, version, 'Cargo lock version differs');
  if (tag) assert.equal(tag, `v${version}`, 'Release tag differs');
  return version;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(checkVersions((path) => readFileSync(path, 'utf8'), process.argv[2]));
}
