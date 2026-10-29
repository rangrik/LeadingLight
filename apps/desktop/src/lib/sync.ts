import { dropPage } from "./panes";
import { cloudApi, cloudState, setCloud } from './cloud';
import { objects, onHistory } from './objects';
import { flushAll } from './saving';
import { loadSpace } from './space';
import { dirtyLive, restoreLive } from './live';
import { type HistoryEntry } from './history-types';
import type { Catalog } from './catalog';
import { materializeSyncAsset, readSyncAsset } from './assets';
import { packAssets, unpackAssets, type AssetBundle } from './sync-assets';
import { alignSyncChange, ownsSyncLibrary, portableHistoryEntry } from './sync-policy';
import { initialCatalogChanges } from './sync-catalog';

const keyName = (owner: string) => `leadinglight.sync-key:${owner}`;
const cursorName = (owner: string) => `leadinglight.sync-cursor:${owner}`;
const b64 = (data: Uint8Array) => { let text = ''; for (let i = 0; i < data.length; i += 32768) text += String.fromCharCode(...data.subarray(i, i + 32768)); return btoa(text); };
const bytes = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const syncKey = () => cloudState().user ? localStorage.getItem(keyName(cloudState().user!.id)) ?? '' : '';
export const syncEnabled = () => ownsSyncLibrary(cloudState().user?.id, localStorage.getItem('leadinglight.sync-owner')) && Boolean(syncKey()) && localStorage.getItem(`leadinglight.sync-paused:${cloudState().user?.id}`) !== 'true';
const assertOwner = (owner: string) => {
  if (cloudState().verifying || cloudState().user?.id !== owner || !ownsSyncLibrary(owner, localStorage.getItem('leadinglight.sync-owner'))) throw new Error('The account changed. Sync stopped to protect this local library.');
};
export async function enableSync(recovery?: string) {
  const user = cloudState().user;
  if (!user) throw new Error('Sign in first.');
  const bound = localStorage.getItem('leadinglight.sync-owner');
  if (bound && bound !== user.id) throw new Error('This device’s notes are linked to another account. Sign in to that account to sync this library.');
  const previous = localStorage.getItem(keyName(user.id));
  const key = recovery?.trim() || previous || b64(crypto.getRandomValues(new Uint8Array(32)));
  if (bytes(key).length !== 32) throw new Error('Enter the complete recovery key from your other device.');
  if (key !== previous) {
    const { events } = await cloudApi<{ events: { id: string; envelope: Envelope }[] }>('sync?after=0', undefined, 'GET', user.id);
    if (events.length) {
      const first = events[0], envelope = await readEnvelope(first.envelope, user.id);
      try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: new TextEncoder().encode(`${user.id}:${first.id}`) }, await cryptKey(key), bytes(envelope.data)); }
      catch { throw new Error(previous ? 'This recovery key does not match the synced notes. Your existing key has been kept.' : 'This recovery key does not match the synced notes. Enter the key from a connected device.'); }
    } else if (previous) throw new Error('There is no cloud copy to verify this new key against. Resume with the existing key.');
  }
  if (cloudState().user?.id !== user.id || localStorage.getItem('leadinglight.sync-owner') !== bound) throw new Error('The account changed while connecting. Please try again.');
  if (previous && key !== previous) localStorage.setItem(`${keyName(user.id)}:previous`, previous);
  localStorage.setItem('leadinglight.sync-owner', user.id);
  localStorage.setItem(keyName(user.id), key);
  localStorage.removeItem(`leadinglight.sync-paused:${user.id}`);
  setCloud({ sync: 'Connecting…' });
}
export function disableSync() {
  const user = cloudState().user;
  if (user) localStorage.setItem(`leadinglight.sync-paused:${user.id}`, 'true');
  setCloud({ sync: 'Off' });
}
type Envelope = { v: 1; iv: string; data: string; compression?: 'gzip'; kind?: 'part' | 'manifest'; parts?: string[] };
type SyncPayload = { entry: HistoryEntry; catalog: Catalog; assets?: AssetBundle };
const MAX_PLAIN_BYTES = 128 * 1024 * 1024;
const MAX_CIPHER_TEXT = 192 * 1024 * 1024;
async function cryptKey(raw: string) { return crypto.subtle.importKey('raw', bytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function encrypt(key: CryptoKey, id: string, owner: string, payload: unknown): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const json = new Blob([JSON.stringify(payload)]);
  if (json.size > MAX_PLAIN_BYTES) throw new Error('This sync event exceeds 128 MiB. Split its content across pages.');
  const packed = await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${owner}:${id}`) }, key, packed);
  return { v: 1, iv: b64(iv), data: b64(new Uint8Array(data)), compression: 'gzip' };
}
let busy = false;
let pending: HistoryEntry[] | undefined;
const incoming: HistoryEntry[] = [];
let debounce: ReturnType<typeof setTimeout> | undefined;
onHistory((entry) => {
  incoming.push(entry);
  if (!busy) { clearTimeout(debounce); debounce = setTimeout(() => void syncNow(), 1_000); }
});
const flags = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('leadinglight-sync', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('sent');
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
async function sent(owner: string, id: string, write = false): Promise<boolean> {
  const db = await flags;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sent', write ? 'readwrite' : 'readonly');
    const request = write ? tx.objectStore('sent').put(true, `${owner}:${id}`) : tx.objectStore('sent').get(`${owner}:${id}`);
    tx.oncomplete = () => resolve(write || Boolean(request.result)); tx.onabort = () => reject(tx.error);
  });
}
async function sendEnvelope(owner: string, id: string, envelope: Envelope) {
  if (envelope.data.length > 2_000_000) {
    const parts: string[] = [];
    for (let start = 0; start < envelope.data.length; start += 2_000_000) {
      const part = `${id}:part:${envelope.iv}:${parts.length}`; parts.push(part);
      assertOwner(owner);
      await cloudApi('sync', { id: part, envelope: { v: 1, kind: 'part', iv: '', data: envelope.data.slice(start, start + 2_000_000) } }, 'POST', owner);
    }
    envelope = { ...envelope, data: '', kind: 'manifest', parts };
  }
  assertOwner(owner);
  await cloudApi('sync', { id, envelope }, 'POST', owner);
  assertOwner(owner);
  await sent(owner, id, true);
}
async function readEnvelope(envelope: Envelope, owner: string) {
  if (!envelope || envelope.v !== 1 || typeof envelope.iv !== 'string' || envelope.iv.length !== 16 || bytes(envelope.iv).length !== 12 || (envelope.compression !== undefined && envelope.compression !== 'gzip')) throw new Error('This encrypted sync event is invalid.');
  let data = envelope.data;
  if (envelope.kind === 'manifest') {
    if (!Array.isArray(envelope.parts) || !envelope.parts.length || envelope.parts.length > 200) throw new Error('This sync event has invalid attachment parts.');
    data = '';
    for (const id of envelope.parts) {
      if (typeof id !== 'string' || id.length > 512) throw new Error('This sync part is invalid.');
      const part = await cloudApi<Envelope>(`sync-part?id=${encodeURIComponent(id)}`, undefined, 'GET', owner);
      if (part?.v !== 1 || part.kind !== 'part' || typeof part.data !== 'string' || part.data.length > 4_000_000 || data.length + part.data.length > MAX_CIPHER_TEXT) throw new Error('This sync event is incomplete or too large.');
      data += part.data;
    }
  } else if (envelope.kind !== undefined) throw new Error('This sync event is invalid.');
  if (typeof data !== 'string' || data.length > MAX_CIPHER_TEXT) throw new Error('This sync event is too large.');
  return { ...envelope, data };
}
async function decodePayload(plain: ArrayBuffer, compressed: boolean): Promise<SyncPayload> {
  if (!compressed && plain.byteLength > MAX_PLAIN_BYTES) throw new Error('This sync event is too large.');
  const source = new Blob([plain]).stream();
  const reader = (compressed ? source.pipeThrough(new DecompressionStream('gzip')) : source).getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > MAX_PLAIN_BYTES) throw new Error('This sync event expands beyond 128 MiB.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  const payload = JSON.parse(new TextDecoder().decode(data)) as SyncPayload;
  if (!payload?.entry || !Array.isArray(payload.entry.changes) || !payload.catalog || !Array.isArray(payload.catalog.props) || !Array.isArray(payload.catalog.types) || payload.entry.changes.some((c) => !c || !(c.before || c.after) || typeof (c.after ?? c.before)?.id !== 'string' || (c.before && c.after && c.before.id !== c.after.id))) throw new Error('This sync event is invalid.');
  return payload;
}
export async function syncNow() {
  const owner = cloudState().user?.id, raw = syncKey();
  if (busy || cloudState().verifying || !owner || !raw || !syncEnabled() || !navigator.onLine) return;
  busy = true; setCloud({ sync: 'Syncing…' });
  try {
    await flushAll();
    const key = await cryptKey(raw);
    const catalog = await objects.catalog();
    const first = pending === undefined;
    pending ??= await objects.history();
    pending.push(...incoming.splice(0));
    const history = [...new Map(pending.map((e) => [e.id, e])).values()];
    const ids = new Set(history.map((e) => e.id));
    const tracked = new Set(history.flatMap((e) => e.changes.map((c) => (c.after ?? c.before)!.id)));
    // Existing pages get a baseline before their first tracked edit.
    for (const row of first ? await objects.list() : []) {
      if (tracked.has(row.id)) continue;
      const page = await objects.get(row.id); if (!page) continue;
      const id = `baseline:${crypto.randomUUID()}`;
      const baseline: HistoryEntry = { id, action: id, at: page.createdAt, label: 'Existing page', author: { kind: 'unknown', name: 'Origin unknown' }, changes: [{ before: page, after: { ...page, revision: id } }] };
      assertOwner(owner);
      await objects.commit(baseline);
      history.push(baseline);
    }
    let cursor = localStorage.getItem(cursorName(owner)) || '0';
    let remoteCount = 0;
    for (;;) {
      const { events } = await cloudApi<{ events: { seq: string; id: string; envelope: Envelope }[] }>(`sync?after=${cursor}`, undefined, 'GET', owner);
      if (!events.length) break;
      for (const event of events) {
        assertOwner(owner);
        const envelope = await readEnvelope(event.envelope, owner);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: new TextEncoder().encode(`${owner}:${event.id}`) }, key, bytes(envelope.data));
        const decoded = await decodePayload(plain, envelope.compression === 'gzip');
        if (decoded.entry.id !== event.id) throw new Error('This sync event is invalid.');
        if (!ids.has(event.id) && !await sent(owner, event.id)) {
          const payload = await unpackAssets({ entry: decoded.entry, catalog: decoded.catalog }, decoded.assets, materializeSyncAsset);
          assertOwner(owner);
          await flushAll();
          const aligned = await Promise.all(payload.entry.changes.map(async (change) => {
            const current = await objects.get((change.after ?? change.before)!.id);
            const [local, before, after] = await Promise.all([current, change.before, change.after].map((page) => packAssets(page, readSyncAsset)));
            return alignSyncChange(current, change, { current: local.value, before: before.value, after: after.value });
          }));
          payload.entry = { ...payload.entry, changes: aligned.map((result) => result.change) };
          const catalogChanges = initialCatalogChanges(catalog, payload.catalog);
          for (const prop of catalogChanges.props) {
            assertOwner(owner); await objects.putProp(prop);
            const index = catalog.props.findIndex((p) => p.id === prop.id);
            if (index < 0) catalog.props.push(prop); else catalog.props[index] = prop;
          }
          for (const type of catalogChanges.types) {
            assertOwner(owner); await objects.putType(type);
            const index = catalog.types.findIndex((t) => t.id === type.id);
            if (index < 0) catalog.types.push(type); else catalog.types[index] = type;
          }
          if (!aligned.every((result) => result.unchanged)) {
            try {
              await flushAll();
              if (payload.entry.changes.some((c) => c.before && dirtyLive(c.before.id))) throw new Error('This page has newer changes.');
              assertOwner(owner);
              await objects.commit(payload.entry);
              for (const c of payload.entry.changes) {
                if (c.after) {
                  if (dirtyLive(c.after.id)) {
                    const { id: _id, revision: _revision, ...copy } = c.after;
                    assertOwner(owner);
                    await objects.create({ ...copy, title: `${copy.title || 'Untitled'} (conflicting copy)` }, { action: `conflict:${event.id}`, label: "Kept concurrent edits", author: payload.entry.author, preserveOrigin: true });
                  } else restoreLive(c.after);
                }
                else if (c.before && !dirtyLive(c.before.id)) dropPage(c.before.id, null);
              }
            } catch (error) {
              if (!String(error).includes('newer changes')) throw error;
              const id = `conflict:${event.id}`;
              const conflict: HistoryEntry = { ...payload.entry, id, action: id, label: 'Kept conflicting edits', changes: payload.entry.changes.filter((c) => c.after).map((c, i) => ({ before: null, after: { ...c.after!, id: `${id}:${i}`, revision: id, title: `${c.after!.title || 'Untitled'} (conflicting copy)` } })) };
              if (conflict.changes.length) { assertOwner(owner); await objects.commit(conflict); }
            }
          }
          remoteCount++;
        }
        assertOwner(owner);
        await sent(owner, event.id, true);
        ids.add(event.id); cursor = event.seq; localStorage.setItem(cursorName(owner), cursor);
      }

    }
    const errors: string[] = [];
    const remaining: HistoryEntry[] = [];
    for (const entry of history.sort((a, b) => a.at - b.at)) {
      assertOwner(owner);
      if (await sent(owner, entry.id)) continue;
      try {
        const packed = await packAssets({ entry: portableHistoryEntry(entry), catalog }, readSyncAsset);
        await sendEnvelope(owner, entry.id, await encrypt(key, entry.id, owner, { ...packed.value, assets: packed.assets }));
      } catch (error) { remaining.push(entry); errors.push(`${(entry.changes[0]?.after ?? entry.changes[0]?.before)?.title || 'A page'}: ${String(error)}`); }
    }
    pending = remaining;
    if (remoteCount) await loadSpace();
    setCloud({ sync: errors.length ? 'Some pages need attention' : 'Up to date', error: errors.slice(0, 3).join('\n') });
  } catch (error) {
    setCloud({ sync: 'Needs attention', error: error instanceof DOMException && error.name === 'OperationError' ? 'The recovery key does not match this account’s synced notes. Enter the key from your other device.' : String(error) });
  } finally { busy = false; }
}
