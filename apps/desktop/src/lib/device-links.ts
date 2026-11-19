import { cloudApi, cloudState } from './cloud';
import { createStore } from './state';
import { deviceKey, matchKeys, type Match, type Wrapped } from './device-match';
import { platform, isNative } from './platform';
import { enableSync, syncKey, syncNow, keySavedName } from './sync';
import { folders, loadFolders } from './project-runtime/folders';
import { ask } from './project-runtime/transport';
import { connectMobileAgents, disconnectMobileAgents, mobileAgents } from './mobile-agents';
import { pageOf } from './space';

type Peer = { id: string; name: string; online: boolean; sync: boolean; projects: string[] };
export type Link = Match & {
  state: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired' | 'removed';
  requesterName: string;
  targetName: string;
  expiresAt: string;
  envelope?: Wrapped;
};
type Status = { session: string; devices: Peer[]; links: Link[] };
const empty: Status = { session: '', devices: [], links: [] };
export const deviceLinks = createStore({ ...empty, owner: '', error: '' });
export function resetDevices(owner: string) {
  if (deviceLinks.get().owner !== owner) {
    deviceLinks.set({ ...empty, owner, error: '' });
    connectionPicker.set(null);
  }
}
export const connectionPicker = createStore<{ project: string | null } | null>(null);
const api = <T>(op: string, data: unknown, owner: string) => cloudApi<T>('device-links/' + op, data, 'POST', owner);
const requireOwner = (owner: string) => {
  if (cloudState().user?.id !== owner) throw new Error('Your account changed. Reopen the connection.');
};
const bound = () => localStorage.getItem('leadinglight.sync-owner');
const hasKey = (owner: string) => cloudState().user?.id === owner && bound() === owner && !!syncKey();
let polling: Promise<void> | undefined;
const localName = (owner: string, id: string) => 'leadinglight.device-link:' + owner + ':' + id;
type Receipt = { connection?: string; host?: boolean; applied?: boolean };
function receipts(owner: string): [string, Receipt][] {
  const prefix = localName(owner, '');
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(prefix))
    .map((k) => [k.slice(prefix.length), JSON.parse(localStorage.getItem(k)!)]);
}
function save(owner: string, id: string, r: Receipt) {
  localStorage.setItem(localName(owner, id), JSON.stringify(r));
}
async function applyLink(owner: string, session: string, link: Link) {
  if (!link.envelope) throw new Error('The approval is missing. Request a new connection.');
  const keys = await matchKeys(owner, session, link);
  const payload = await keys.open<{ key?: string; code?: string }>(link.envelope);
  requireOwner(owner);
  if (
    link.notes !== !!payload.key ||
    (payload.key !== undefined && typeof payload.key !== 'string') ||
    !!link.project !== !!payload.code
  )
    throw new Error('Invalid device approval.');
  if (payload.key) {
    if (syncKey() !== payload.key || bound() !== owner) await enableSync(payload.key);
    requireOwner(owner);
    localStorage.setItem(keySavedName(owner), 'true');
  }
  let connection: string | undefined;
  if (payload.code) {
    await connectMobileAgents(payload.code);
    requireOwner(owner);
    connection = mobileAgents.get().connection?.id;
    if (!connection) throw new Error('The Mac has not confirmed the connection yet.');
  }
  save(owner, link.id, { applied: true, connection });
  if (link.notes) void syncNow().catch(() => {});
}
export async function selectLink(link: Link) {
  const { owner, session } = deviceLinks.get();
  requireOwner(owner);
  if (link.state !== 'approved' || link.requester !== session) throw new Error('Request this connection again.');
  await applyLink(owner, session, link);
}
export async function pollDevices(force = false) {
  const owner = cloudState().user?.id;
  resetDevices(owner ?? '');
  if (!owner || !cloudState().config.allowed || (!(await isNative) && !import.meta.env.DEV)) {
    if (deviceLinks.get().owner) deviceLinks.set({ ...empty, owner: '', error: '' });
    return;
  }
  if (!force && (document.hidden || !navigator.onLine)) return;
  if (polling) return polling;
  polling = (async () => {
    const pair = await deviceKey(owner),
      mac = platform.get() === 'macos' || (import.meta.env.DEV && platform.get() === 'browser');
    if (mac) await loadFolders().catch(() => {});
    const projects = mac
      ? Array.from(folders.get())
          .filter(([, s]) => !s.missing)
          .map(([id]) => id)
          .slice(0, 200)
      : [];
    const result = await api<Status>(
      'presence',
      { key: await crypto.subtle.exportKey('jwk', pair.publicKey), sync: hasKey(owner), projects },
      owner,
    );
    requireOwner(owner);
    deviceLinks.set({ ...result, owner, error: '' });
    const seen = new Map(receipts(owner));
    for (const link of result.links) {
      if (link.requester === result.session && link.state === 'approved' && !seen.get(link.id)?.applied)
        await applyLink(owner, result.session, link);
    }
    for (const [id, r] of seen) {
      const current = result.links.find((l) => l.id === id);
      if (current?.state === 'approved' || current?.state === 'pending') continue;
      if (r.host) await ask('DELETE', '/v1/mobile/links/' + id);
      if (r.connection && r.connection === mobileAgents.get().connection?.id) await disconnectMobileAgents();
      localStorage.removeItem(localName(owner, id));
    }
  })()
    .catch((e) => {
      if (cloudState().user?.id === owner)
        deviceLinks.set({ ...deviceLinks.get(), owner, error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      polling = undefined;
    });
  return polling;
}
export async function beginLink(target: string, project: string | null) {
  const { owner, session, links } = deviceLinks.get();
  requireOwner(owner);
  const existing = links.find(
    (l) => l.requester === session && l.target === target && l.project === project && l.state === 'approved',
  );
  if (existing) {
    await selectLink(existing);
    connectionPicker.set(null);
    return;
  }
  if (bound() && bound() !== owner) throw new Error('Sign in to the account that owns these notes.');
  await api('start', { target, project }, owner);
  connectionPicker.set(null);
  await pollDevices(true);
}
export async function endLink(id: string, op: 'cancel' | 'deny' | 'remove') {
  const { owner } = deviceLinks.get();
  requireOwner(owner);
  await api(op, { id }, owner);
  await pollDevices(true);
}
export async function approveLink(link: Link, chosen: number) {
  const { owner, session } = deviceLinks.get();
  requireOwner(owner);
  if (link.target !== session || (link.notes && !hasKey(owner)) || Date.parse(link.expiresAt) <= Date.now())
    throw new Error('This request cannot be approved. Ask again.');
  const keys = await matchKeys(owner, session, link);
  if (chosen !== keys.number) {
    await endLink(link.id, 'deny');
    return;
  }
  let code: string | undefined;
  try {
    if (link.project) {
      const f = folders.get().get(link.project);
      if (!f || f.missing || !pageOf(link.project)) throw new Error('Link the project folder on this Mac first.');
      const relay = await api('channel', { id: link.id }, owner);
      const grant = await ask<{ code: string }>('PUT', '/v1/mobile/links/' + link.id, {
        project: f.folder.location,
        folder: f.folder.folderId,
        relay,
      });
      code = grant.code;
      if (!code) throw new Error('The Mac could not open this project.');
      save(owner, link.id, { host: true });
    }
    requireOwner(owner);
    const envelope = await keys.seal({ key: link.notes ? syncKey() : undefined, code });
    await api('approve', { id: link.id, envelope }, owner);
  } catch (e) {
    await api('deny', { id: link.id }, owner).catch(() => {});
    throw e;
  } finally {
    await pollDevices(true);
  }
}
export function activeProjectLink(project: string) {
  const current = deviceLinks.get();
  return current.links.find((l) => l.state === 'approved' && l.requester === current.session && l.project === project);
}
