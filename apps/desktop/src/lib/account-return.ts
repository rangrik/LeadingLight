import { cloudState, onCloud } from './cloud';
import { isNative, platformReady } from './platform';
import { createStore } from './state';

export type Integration = 'gmail' | 'calendar';
type Return = { integration: Integration; result: 'connected' | 'cancelled'; app: string; id: string };
export const accountReturns = createStore<Partial<Record<Integration, Return & { owner: string }>>>({});
const saved = (integration: Integration) => `leadinglight.connection:${integration}`;
const appName = /^leadinglight(?:-dev-[a-f0-9]{6})?$/;
const requestId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function clearAccountReturn(integration: Integration, id: string) {
  const current = accountReturns.get();
  if (current[integration]?.id === id) accountReturns.set({ ...current, [integration]: undefined });
}

export function browserReturn(url: URL): Return | null {
  const integration = url.searchParams.get('integration'), result = url.searchParams.get('result');
  const app = url.searchParams.get('app') ?? '', id = url.searchParams.get('id') ?? '';
  return url.pathname === '/connect/complete' && (integration === 'gmail' || integration === 'calendar')
    && (result === 'connected' || result === 'cancelled') && appName.test(app) && requestId.test(id)
    ? { integration, result, app, id } : null;
}
export const appReturnUrl = (r: Return) => `${r.app}://connected/${r.integration}?${new URLSearchParams({ result: r.result, id: r.id })}`;

export async function accountReturnRequest(integration: Integration) {
  if (!(await isNative)) return {};
  const { getIdentifier } = await import('@tauri-apps/api/app');
  const identifier = await getIdentifier(), app = identifier === 'com.leadinglight.app' ? 'leadinglight' : identifier.replace('com.leadinglight.dev.', 'leadinglight-dev-');
  if (!appName.test(app)) throw new Error('This app cannot receive a Google connection.');
  const id = crypto.randomUUID();
  localStorage.setItem(saved(integration), JSON.stringify({ app, id, owner: cloudState().user?.id, until: Date.now() + 10 * 60_000 }));
  return { app, id };
}

// A link can wake the app, but only this workspace's pending request may finish a connection.
export function acceptAccountReturn(value: string): Return | null {
  try {
    const url = new URL(value), app = url.protocol.slice(0, -1), integration = url.pathname.slice(1);
    if (url.hostname !== 'connected' || url.username || url.password || url.port || url.hash || !appName.test(app)) return null;
    if (integration !== 'gmail' && integration !== 'calendar') return null;
    const result = url.searchParams.get('result'), id = url.searchParams.get('id') ?? '';
    if ((result !== 'connected' && result !== 'cancelled') || !requestId.test(id) || [...url.searchParams].length !== 2) return null;
    const pending = JSON.parse(localStorage.getItem(saved(integration)) ?? 'null');
    if (!cloudState().user || !pending || pending.id !== id || pending.app !== app || pending.owner !== cloudState().user?.id || !(pending.until > Date.now())) return null;
    localStorage.removeItem(saved(integration));
    const returned: Return = { integration, result, app, id };
    accountReturns.set({ ...accountReturns.get(), [integration]: { ...returned, owner: pending.owner } });
    return returned;
  } catch { return null; }
}

export function watchAccountReturns(open: (integration: Integration) => void) {
  let stopped = false, queued: string[] = [];
  const cleanups: (() => void)[] = [];
  const receive = (urls: string[] = []) => {
    queued = [...new Set([...queued, ...urls])];
    if (stopped || !cloudState().initialized || !cloudState().user) return;
    const pending = queued;
    queued = [];
    for (const url of pending) { const returned = acceptAccountReturn(url); if (returned) open(returned.integration); }
  };
  const keep = (stop: () => void) => stopped ? stop() : cleanups.push(stop);
  void isNative.then(async (native) => {
    if (!native || stopped) return;
    const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    keep(onCloud(() => receive()));
    keep(await onOpenUrl(receive));
    receive(await getCurrent() ?? []);
    if (await platformReady === 'macos') {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      keep(await getCurrentWindow().onFocusChanged(({ payload }) => {
        if (payload) window.dispatchEvent(new Event('leadinglight:app-focus'));
      }));
    }
  }).catch(console.error);
  return () => { stopped = true; for (const stop of cleanups) stop(); };
}
