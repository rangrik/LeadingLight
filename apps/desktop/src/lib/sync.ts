import { dropPage } from "./panes";
import { cloudApi, cloudState, setCloud } from './cloud';
import { objects, onHistory } from './objects';
import { flushAll } from './saving';
import { loadSpace } from './space';
import { dirtyLive, restoreLive } from './live';
import { type HistoryEntry, samePage } from './history-types';
import type { Catalog } from './catalog';

const keyName = (owner: string) => `leadinglight.sync-key:${owner}`;
const cursorName = (owner: string) => `leadinglight.sync-cursor:${owner}`;
const b64 = (data: Uint8Array) => { let text = ''; for (let i = 0; i < data.length; i += 32768) text += String.fromCharCode(...data.subarray(i, i + 32768)); return btoa(text); };
const bytes = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const syncKey = () => cloudState().user ? localStorage.getItem(keyName(cloudState().user!.id)) ?? '' : '';
export const syncEnabled = () => Boolean(syncKey()) && localStorage.getItem(`leadinglight.sync-paused:${cloudState().user?.id}`) !== 'true';
export async function enableSync(recovery?: string) {
  const user = cloudState().user;
  if (!user) throw new Error('Sign in first.');
  const bound = localStorage.getItem('leadinglight.sync-owner');
  if (bound && bound !== user.id) throw new Error('This browser’s notes are linked to another account. Use a separate browser profile for a different account.');
  const previous = localStorage.getItem(keyName(user.id));
  const key = recovery?.trim() || previous || b64(crypto.getRandomValues(new Uint8Array(32)));
  if (bytes(key).length !== 32) throw new Error('Enter the complete recovery key from your other device.');
  if (key !== previous) {
    const { events } = await cloudApi<{ events: { id: string; envelope: Envelope }[] }>('sync?after=0');
    if (events.length) {
      const first = events[0], envelope = await readEnvelope(first.envelope);
      try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: new TextEncoder().encode(`${user.id}:${first.id}`) }, await cryptKey(key), bytes(envelope.data)); }
      catch { throw new Error('This recovery key does not match the synced notes. Your existing key has been kept.'); }
    } else if (previous) throw new Error('There is no cloud copy to verify this new key against. Resume with the existing key.');
    if (previous) localStorage.setItem(`${keyName(user.id)}:previous`, previous);
  }
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
async function cryptKey(raw: string) { return crypto.subtle.importKey('raw', bytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function encrypt(key: CryptoKey, id: string, owner: string, payload: unknown): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = await new Response(new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${owner}:${id}`) }, key, packed);
  return { v: 1, iv: b64(iv), data: b64(new Uint8Array(data)), compression: 'gzip' };
}
let busy = false;
let pending: HistoryEntry[] | undefined;
const incoming: HistoryEntry[] = [];
onHistory((entry) => incoming.push(entry));
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
      await cloudApi('sync', { id: part, envelope: { v: 1, kind: 'part', iv: '', data: envelope.data.slice(start, start + 2_000_000) } });
    }
    envelope = { ...envelope, data: '', kind: 'manifest', parts };
  }
  await cloudApi('sync', { id, envelope });
  await sent(owner, id, true);
}
async function readEnvelope(envelope: Envelope) {
  if (envelope.kind !== 'manifest') return envelope;
  let data = '';
  for (const id of envelope.parts ?? []) data += (await cloudApi<Envelope>(`sync-part?id=${encodeURIComponent(id)}`)).data;
  return { ...envelope, data };
}
export async function syncNow() {
  const owner = cloudState().user?.id, raw = syncKey();
  if (busy || !owner || !raw || !syncEnabled() || !navigator.onLine) return;
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
      await objects.commit(baseline);
      history.push({ ...baseline, changes: baseline.changes.map((c) => ({ ...c, before: null })) });
    }
    let cursor = localStorage.getItem(cursorName(owner)) || '0';
    let remoteCount = 0;
    for (;;) {
      const { events } = await cloudApi<{ events: { seq: string; id: string; envelope: Envelope }[] }>(`sync?after=${cursor}`);
      if (!events.length) break;
      for (const event of events) {
        if (cloudState().user?.id !== owner) return;
        const envelope = await readEnvelope(event.envelope);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: new TextEncoder().encode(`${owner}:${event.id}`) }, key, bytes(envelope.data));
        const decoded = envelope.compression === 'gzip' ? await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(plain);
        const payload = JSON.parse(decoded) as { entry: HistoryEntry; catalog: Catalog };
        if (payload.entry.id !== event.id || !Array.isArray(payload.entry.changes)) throw new Error('This sync event is invalid.');
        if (!ids.has(event.id) && !await sent(owner, event.id)) {
          for (const prop of payload.catalog.props) if (!catalog.props.some((p) => p.id === prop.id)) await objects.putProp(prop);
          for (const type of payload.catalog.types) if (!catalog.types.some((t) => t.id === type.id)) await objects.putType(type);
          const equal = await Promise.all(payload.entry.changes.map(async (c) => samePage(await objects.get((c.after ?? c.before)!.id), c.after)));
          if (!equal.every(Boolean)) {
            try {
              await flushAll();
              if (payload.entry.changes.some((c) => c.before && dirtyLive(c.before.id))) throw new Error('This page has newer changes.');
              await objects.commit(payload.entry);
              for (const c of payload.entry.changes) {
                if (c.after) {
                  if (dirtyLive(c.after.id)) {
                    const { id: _id, revision: _revision, ...copy } = c.after;
                    await objects.create({ ...copy, title: `${copy.title || 'Untitled'} (conflicting copy)` }, { action: `conflict:${event.id}`, label: "Kept concurrent edits", author: payload.entry.author, preserveOrigin: true });
                  } else restoreLive(c.after);
                }
                else if (c.before && !dirtyLive(c.before.id)) dropPage(c.before.id, null);
              }
            } catch (error) {
              if (!String(error).includes('newer changes')) throw error;
              const id = `conflict:${event.id}`;
              const conflict: HistoryEntry = { ...payload.entry, id, action: id, label: 'Kept conflicting edits', changes: payload.entry.changes.filter((c) => c.after).map((c, i) => ({ before: null, after: { ...c.after!, id: `${id}:${i}`, revision: id, title: `${c.after!.title || 'Untitled'} (conflicting copy)` } })) };
              if (conflict.changes.length) await objects.commit(conflict);
            }
          }
          remoteCount++;
        }
        await sent(owner, event.id, true);
        ids.add(event.id); cursor = event.seq; localStorage.setItem(cursorName(owner), cursor);
      }

    }
    const errors: string[] = [];
    const remaining: HistoryEntry[] = [];
    for (const entry of history.sort((a, b) => a.at - b.at)) {
      if (cloudState().user?.id !== owner) return;
      if (await sent(owner, entry.id)) continue;
      try {
      if (/asset:\/\/|asset\.localhost|https?:\/\/tauri\.localhost/.test(JSON.stringify(entry))) throw new Error('A Mac-only attachment needs a portable copy before this page can sync. Other notes remain on this device.');
      await sendEnvelope(owner, entry.id, await encrypt(key, entry.id, owner, { entry, catalog }));
      } catch (error) { remaining.push(entry); errors.push(`${(entry.changes[0]?.after ?? entry.changes[0]?.before)?.title || 'A page'}: ${String(error)}`); }
    }
    pending = remaining;
    if (remoteCount) await loadSpace();
    setCloud({ sync: errors.length ? 'Some pages need attention' : 'Up to date', error: errors.slice(0, 3).join('\n') });
  } catch (error) {
    setCloud({ sync: 'Needs attention', error: error instanceof DOMException && error.name === 'OperationError' ? 'The recovery key does not match this account’s synced notes. Enter the key from your other device.' : String(error) });
  } finally { busy = false; }
}
