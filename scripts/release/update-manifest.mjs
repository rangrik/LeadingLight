// Writes the updater's manifest, after proving the update verifies with the key the app carries.
// A wrong signing secret would otherwise ship an update that every installed app refuses.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [tag, archive, signatureFile] = process.argv.slice(2);
// Tauri wraps minisign's two-line files in base64; the second line holds algorithm, key id and bytes.
const payload = (wrapped) => Buffer.from(Buffer.from(wrapped, 'base64').toString().split('\n')[1] ?? '', 'base64');
const signature = readFileSync(signatureFile, 'utf8').trim();
const pub = payload(JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json')).plugins.updater.pubkey);
const sig = payload(signature);
const data = readFileSync(archive);
// "ED" signs the file's BLAKE2b hash; the older "Ed" signs the file itself.
const message = sig.subarray(0, 2).toString() === 'ED' ? createHash('blake2b512').update(data).digest() : data;
const signed =
  pub.length === 42 &&
  sig.length === 74 &&
  pub.subarray(2, 10).equals(sig.subarray(2, 10)) &&
  verify(null, message, createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub.subarray(10)]), format: 'der', type: 'spki' }), sig.subarray(10));
if (!signed) {
  console.error('The update is not signed by the key in tauri.conf.json (plugins.updater.pubkey).');
  process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY ?? 'rangrik/LeadingLight';
const url = `https://github.com/${repo}/releases/download/${tag}/${basename(archive)}`;
console.log(JSON.stringify({ version: tag.slice(1), platforms: { 'darwin-aarch64': { signature, url } } }, null, 2));
