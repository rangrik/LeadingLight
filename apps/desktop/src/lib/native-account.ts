import { cloudApi, refreshCloud, setCloud } from './cloud';
import { platformReady } from './platform';
import { createStore } from './state';

type KeyEnvelope = { publicKey: JsonWebKey; iv: string; data: string };
export type NativeApproval = { id: string; deviceName: string; publicKey: JsonWebKey; expiresAt: string };
export const nativeConnection = createStore<{ pending: boolean; message: string }>({ pending: false, message: '' });
export const connectionCode = (id: string) => id.replaceAll('-', '').slice(0, 8).toUpperCase();
export function snapshotSyncSettings(owner: string) {
  const names = ['leadinglight.sync-owner', `leadinglight.sync-key:${owner}`, `leadinglight.sync-key:${owner}:previous`, `leadinglight.sync-paused:${owner}`];
  const previous = names.map((name) => [name, localStorage.getItem(name)] as const);
  return () => { for (const [name, value] of previous) value === null ? localStorage.removeItem(name) : localStorage.setItem(name, value); };
}
const encoded = (value: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(value)));
const decoded = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const aad = (id: string, owner: string) => new TextEncoder().encode(`leadinglight-native:${id}:${owner}`);
async function sharedKey(privateKey: CryptoKey, publicKey: JsonWebKey, usage: KeyUsage) {
  const peer = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function approveNativeAccount(approval: NativeApproval, owner: string, recoveryKey: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const key = await sharedKey(pair.privateKey, approval.publicKey, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(approval.id, owner) }, key, new TextEncoder().encode(recoveryKey));
  const keyEnvelope: KeyEnvelope = { publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey), iv: encoded(iv), data: encoded(data) };
  await cloudApi('native/approve', { id: approval.id, keyEnvelope }, 'POST', owner);
}

export async function connectNativeAccount() {
  if (nativeConnection.get().pending) return;
  setCloud({ verifying: true });
  nativeConnection.set({ pending: true, message: 'Approve this device in your browser, then return here.' });
  try {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const deviceName = await platformReady === 'ios' ? 'LeadingLight on iPad' : 'LeadingLight on Mac';
    const start = await cloudApi<{ id: string; expiresAt: string; approvalUrl: string }>('native/start', { deviceName, publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) });
    const approvalUrl = new URL(start.approvalUrl);
    if (approvalUrl.origin !== 'https://leadinglight-web.vercel.app' || approvalUrl.searchParams.get('connect') !== start.id) throw new Error('The sign-in link was invalid. Please try again.');
    nativeConnection.set({ pending: true, message: `Match code ${connectionCode(start.id)} in your browser, approve this device, then return here.` });
    await (await import('@tauri-apps/plugin-opener')).openUrl(approvalUrl.href);
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (document.visibilityState === 'hidden' || !navigator.onLine) continue;
      const result = await cloudApi<{ status: 'pending' | 'approved'; user?: { id: string; name: string }; keyEnvelope?: KeyEnvelope }>('native/poll', { id: start.id });
      if (result.status !== 'approved' || !result.user || !result.keyEnvelope) continue;
      const { enableSync, syncNow } = await import('./sync');
      const rollback = snapshotSyncSettings(result.user.id);
      try {
        const envelope = result.keyEnvelope;
        const key = await sharedKey(pair.privateKey, envelope.publicKey, 'decrypt');
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decoded(envelope.iv), additionalData: aad(start.id, result.user.id) }, key, decoded(envelope.data));
        setCloud({ user: result.user, error: '' });
        await enableSync(new TextDecoder().decode(plain));
        await cloudApi('native/confirm', {});
      } catch (error) {
        rollback();
        await cloudApi('native/abort', {}).catch(() => undefined);
        setCloud({ user: null, sync: 'Off' });
        await refreshCloud();
        throw error;
      }
      setCloud({ verifying: false });
      await refreshCloud();
      await syncNow();
      nativeConnection.set({ pending: false, message: 'Connected. Your notes are syncing with this account.' });
      return;
    }
    throw new Error('The sign-in request expired. Try connecting again.');
  } catch (error) {
    await cloudApi('native/abort', {}).catch(() => undefined);
    nativeConnection.set({ pending: false, message: '' });
    throw error;
  } finally {
    setCloud({ verifying: false });
    nativeConnection.set({ ...nativeConnection.get(), pending: false });
  }
}
