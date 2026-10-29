import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairingKey, seal, unseal } from './remote-crypto.ts';

// Seam: encrypted agent content must not be replayed on another connection or turn.
test('pairing keys stay private and ciphertext binds its route', async () => {
  const { id, key, inviteHash, code } = await pairingKey();
  assert.match(code, /^llpair1:[\da-f-]{36}:[\w-]{43}$/);
  assert.match(inviteHash, /^[\da-f]{64}$/);
  await assert.rejects(crypto.subtle.exportKey('raw', key));
  const route = { pair: id, controller: crypto.randomUUID(), turn: crypto.randomUUID(), direction: 'browser' as const, id: crypto.randomUUID(), kind: 'start' };
  const message = { prompt: 'Private note words' };
  const encrypted = await seal(key, route, message);
  assert.equal(JSON.stringify(encrypted).includes(message.prompt), false);
  assert.deepEqual(await unseal(key, route, encrypted), message);
  for (const field of ['pair', 'controller', 'turn', 'id', 'kind'] as const) await assert.rejects(unseal(key, { ...route, [field]: 'another' }, encrypted));
  await assert.rejects(unseal(key, { ...route, direction: 'mac' }, encrypted));
  await assert.rejects(unseal((await pairingKey()).key, route, encrypted));
});
