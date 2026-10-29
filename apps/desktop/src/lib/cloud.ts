import { useSyncExternalStore } from 'react';
import { isNative } from './platform';

type Config = { allowed?: boolean; ready: boolean; providers: { id: string; name: string }[] };
type State = { initialized: boolean; verifying: boolean; config: Config; user: { id: string; name: string } | null; error: string; sync: string };
let state: State = { initialized: false, verifying: false, config: { ready: false, providers: [] }, user: null, error: '', sync: 'Off' };
const listeners = new Set<() => void>();
export const cloudState = () => state;
export const setCloud = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
export const onCloud = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useCloud = () => useSyncExternalStore(onCloud, cloudState);
export class CloudError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function cloudApi<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET', expectedOwner?: string): Promise<T> {
  if (await isNative) {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ status: number; body: T & { error?: string } }>('cloud_request', { path, body: body ?? null, method, expectedOwner: expectedOwner ?? null });
    if (result.status < 200 || result.status >= 300) throw new CloudError(result.body.error || 'Cloud is unavailable.', result.status);
    return result.body;
  }
  const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {};
  if (expectedOwner) headers['X-LeadingLight-Owner'] = expectedOwner;
  const response = await fetch(`/api/${path}`, { method, signal: AbortSignal.timeout(20_000), credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error(navigator.onLine ? 'Cloud could not be reached. Your local notes are safe.' : 'You’re offline. Your local notes still work; cloud will reconnect when the network returns.'); });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Cloud has not been connected for this app. Local notes still work.');
  const result = await response.json();
  if (!response.ok) throw new CloudError(result.error || 'Cloud is unavailable.', response.status);
  return result;
}
export async function refreshCloud() {
  try {
    const config = await cloudApi<Config>('config');
    const user = config.ready ? await cloudApi<State['user']>('me').catch((error) => {
      if (error instanceof CloudError && error.status === 401) return null;
      throw error;
    }) : null;
    setCloud({ initialized: true, config, user, error: '' });
  } catch (e) { setCloud({ initialized: true, error: e instanceof Error ? e.message : String(e) }); }
}
export async function signIn(provider: string) {
  if (await isNative) return (await import('./native-account')).connectNativeAccount();
  const { csrfToken } = await cloudApi<{ csrfToken: string }>('auth/csrf');
  const form = document.createElement('form'); form.method = 'POST'; form.action = `/api/auth/signin/${provider}`;
  for (const [name, value] of Object.entries({ csrfToken, callbackUrl: location.href })) {
    const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
  }
  document.body.append(form); form.submit();
}
export async function signOut() {
  if (await isNative) {
    await cloudApi('native/revoke', {});
    (await import('./native-account')).nativeConnection.set({ pending: false, message: '' });
    setCloud({ user: null, sync: 'Off', error: '' });
    return;
  }
  const { csrfToken } = await cloudApi<{ csrfToken: string }>('auth/csrf');
  const response = await fetch('/api/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' }, body: new URLSearchParams({ csrfToken, callbackUrl: location.origin }) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.url || new URL(result.url, location.origin).searchParams.has('error')) throw new Error('Sign-out failed. You are still signed in. Try again.');
  setCloud({ user: null, sync: 'Off' });
}
let started = false;
export function startCloud() {
  if (started) return; started = true;
  const tick = async () => {
    if (state.verifying) return;
    await refreshCloud();
    if (state.user) {
      try { const { syncNow } = await import('./sync'); await syncNow(); } catch (error) { setCloud({ error: String(error) }); }
    }
  };
  void tick(); window.setInterval(() => { if (navigator.onLine) void tick(); }, 15_000);
  window.addEventListener('online', () => void tick());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) void tick(); });
}
