import { useSyncExternalStore } from 'react';
import { isNative } from './platform';

type Config = { allowed?: boolean; ready: boolean; providers: { id: string; name: string }[] };
export type Account = { id: string; name: string; email?: string; provider?: string; remoteWork?: boolean };
// `known` is the account this device's notes use, kept so a signed-out or offline device can still name it.
// `left` means signed out on purpose; `ended` means the service said the sign-in is no longer good.
type State = { initialized: boolean; verifying: boolean; config: Config; user: Account | null; known: (Account & { left?: boolean }) | null; ended: boolean; error: string; sync: string };
const KNOWN = 'leadinglight.account';
const PROVIDERS: Record<string, string> = { google: 'Google', github: 'GitHub', chatgpt: 'ChatGPT' };
// "alex@example.com · Google": two sign-ins can share a name, so the name alone does not say which account.
export const accountLine = (account: Account | null) => account ? [account.email, account.provider && (PROVIDERS[account.provider] ?? account.provider)].filter(Boolean).join(' · ') : '';
const known = (): State['known'] => { try { return JSON.parse(localStorage.getItem(KNOWN) ?? 'null'); } catch { return null; } };
let state: State = { initialized: false, verifying: false, config: { ready: false, providers: [] }, user: null, known: known(), ended: false, error: '', sync: 'Off' };
function remember(account: NonNullable<State['known']>) {
  // Another account signed in here must not replace the one these notes belong to.
  const bound = localStorage.getItem('leadinglight.sync-owner'), text = JSON.stringify(account);
  if ((bound && bound !== account.id) || text === localStorage.getItem(KNOWN)) return;
  localStorage.setItem(KNOWN, text); state = { ...state, known: account };
}
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
let accountRevision = 0;
export async function setRemoteWork(enabled: boolean) {
  const owner = state.user?.id;
  if (!owner) throw new Error('Sign in to change this setting.');
  await cloudApi('account/remote-work', { enabled }, 'POST', owner);
  if (state.user?.id === owner) {
    accountRevision++;
    setCloud({ user: { ...state.user, remoteWork: enabled } });
  }
}
export async function refreshCloud() {
  const revision = accountRevision;
  try {
    const config = await cloudApi<Config>('config');
    let ended = false;
    const user = config.ready ? await cloudApi<State['user']>('me').catch((error) => {
      if (!(error instanceof CloudError && error.status === 401)) throw error;
      ended = Boolean(state.known && !state.known.left);
      return null;
    }) : null;
    if (revision !== accountRevision) return;
    if (user) remember({ id: user.id, name: user.name, email: user.email, provider: user.provider });
    setCloud({ initialized: true, config, user, ended, error: '' });
  } catch (e) { setCloud({ initialized: true, error: e instanceof Error ? e.message : String(e) }); }
}
export async function signIn(provider: string) {
  if (await isNative) return (await import('./native-account')).connectNativeAccount();
  if (location.origin === 'https://leadinglight-web.vercel.app') throw new Error('Use Copy notes to leadinglight.app above your workspace before signing in at the new address. Your original notes stay here.');
  const { csrfToken } = await cloudApi<{ csrfToken: string }>('auth/csrf');
  localStorage.setItem('leadinglight.last-provider', provider);
  const form = document.createElement('form'); form.method = 'POST'; form.action = `/api/auth/signin/${provider}`;
  for (const [name, value] of Object.entries({ csrfToken, callbackUrl: location.href })) {
    const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
  }
  document.body.append(form); form.submit();
}
// A sign-out the person chose is not a problem to warn about later.
const left = () => { if (state.known) { localStorage.removeItem(KNOWN); remember({ ...state.known, left: true }); } };
export async function signOut() {
  if (await isNative) {
    await cloudApi('native/revoke', {});
    (await import('./native-account')).nativeConnection.set({ pending: false, message: '' });
    accountRevision++; left(); setCloud({ user: null, sync: 'Off', error: '' });
    return;
  }
  const { csrfToken } = await cloudApi<{ csrfToken: string }>('auth/csrf');
  const response = await fetch('/api/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' }, body: new URLSearchParams({ csrfToken, callbackUrl: location.origin }) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.url || new URL(result.url, location.origin).searchParams.has('error')) throw new Error('Sign-out failed. You are still signed in. Try again.');
  accountRevision++; left(); setCloud({ user: null, sync: 'Off' });
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
  // No request can say the network went away, so the sidebar row is told here.
  window.addEventListener('offline', () => setCloud({}));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) void tick(); });
}
