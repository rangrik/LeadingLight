import { useSyncExternalStore } from 'react';

type Config = { allowed?: boolean; ready: boolean; providers: { id: string; name: string }[] };
type State = { initialized: boolean; config: Config; user: { id: string; name: string } | null; error: string; sync: string };
let state: State = { initialized: false, config: { ready: false, providers: [] }, user: null, error: '', sync: 'Off' };
const listeners = new Set<() => void>();
export const cloudState = () => state;
export const setCloud = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
export const onCloud = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useCloud = () => useSyncExternalStore(onCloud, cloudState);
export class CloudError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function cloudApi<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, signal: AbortSignal.timeout(20_000), credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error(navigator.onLine ? 'Cloud could not be reached. Your local notes are safe.' : 'You’re offline. Your local notes still work; cloud will reconnect when the network returns.'); });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Cloud has not been connected for this app. Local notes still work.');
  const result = await response.json();
  if (!response.ok) throw new CloudError(result.error || 'Cloud is unavailable.', response.status);
  return result;
}
export async function refreshCloud() {
  try {
    const config = await cloudApi<Config>('config');
    const user = config.ready ? await cloudApi<State['user']>('me').catch(() => null) : null;
    setCloud({ initialized: true, config, user, error: '' });
  } catch (e) { setCloud({ initialized: true, error: e instanceof Error ? e.message : String(e) }); }
}
export async function signIn(provider: string) {
  const { csrfToken } = await cloudApi<{ csrfToken: string }>('auth/csrf');
  const form = document.createElement('form'); form.method = 'POST'; form.action = `/api/auth/signin/${provider}`;
  for (const [name, value] of Object.entries({ csrfToken, callbackUrl: location.origin })) {
    const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
  }
  document.body.append(form); form.submit();
}
export async function signOut() {
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
    await refreshCloud();
    if (state.user) {
      try { const { syncNow } = await import('./sync'); await syncNow(); } catch (error) { setCloud({ error: String(error) }); }
    }
  };
  void tick(); window.setInterval(() => { if (navigator.onLine) void tick(); }, 15_000);
  window.addEventListener('online', () => void tick());
}
