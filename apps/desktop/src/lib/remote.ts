import { useEffect, useSyncExternalStore } from 'react';
import type { AgentEvent, AgentStatus, AskRequest } from './agent';
import { cloudApi, cloudState, CloudError, onCloud } from './cloud';
import { isNative } from './platform';
import { pairingKey, seal, unseal, type Envelope, type MessageRoute } from './remote-crypto';

export type PairRecord = {
  serverTime?: string; id: string; browserName: string; accountName: string; macName: string | null;
  state: 'pending' | 'review' | 'active' | 'revoked'; expiresAt: string; lastSeen: string | null;
  browserSeen: string | null; controller: string | null; status?: { id: string; envelope: Envelope } | null;
};
export type RemotePair = Omit<PairRecord, 'status'> & {
  localKey: boolean; online: boolean; status?: { claude: AgentStatus; codex: unknown }; error?: string;
};
type RemoteState = { initialized: boolean; pairs: RemotePair[]; selected: string | null; connected: boolean; connecting: boolean; error: string };
type RemoteEvent = { seq: string; id: string; controller: string; turn: string; kind: 'event'; envelope: Envelope };
type Packet = { id: string; controller: string; turn: string; kind: 'start' | 'reply' | 'cancel'; envelope: Envelope };
type Receipt = { type: 'receipt'; messageId: string; ok: boolean; error?: string };
type Ended = { type: 'ended'; how: 'stopped' | 'interrupted'; message?: string };
type Account = { id: string; generation: number };
type Run = { id: string; account: Account; pair: string; controller: string; key: CryptoKey; onEvent: (event: AgentEvent) => void; cancelling?: Promise<void> };
let state: RemoteState = { initialized: false, pairs: [], selected: null, connected: false, connecting: false, error: '' };
const listeners = new Set<() => void>();
const set = (patch: Partial<RemoteState>) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
export const remoteState = () => state;
export function useRemote() {
  useEffect(() => { void startRemote(); }, []);
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, remoteState);
}
export const selectedPair = () => state.pairs.find((pair) => pair.id === state.selected);
export const remoteReady = () => state.connected && !state.connecting && Boolean(owner && cloudState().user?.id === owner && selectedPair()?.online);
export const remoteTarget = () => state.selected ?? 'local';
const runs = new Map<string, Run>(), knownRuns = new Set<string>(), ownedControllers = new Set<string>();
export const isRemoteRun = (id: string) => knownRuns.has(id);
let owner: string | null = null, generation = 0;
let connection: { account: Account; pair: string; controller: string; after: string; key: CryptoKey } | null = null;
const keys = new Map<string, CryptoKey>();
const statuses = new Map<string, { id: string; value: RemotePair['status'] }>();
let db: Promise<IDBDatabase> | undefined;
function keyDatabase() {
  return db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('leadinglight-paired-macs', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { db = undefined; reject(new Error('This browser could not keep the pairing key.')); };
  });
}
async function keyStore(action: 'get' | 'put' | 'delete', pair: string, account: string, value?: CryptoKey): Promise<CryptoKey | undefined> {
  const name = `${account}:${pair}`, database = await keyDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('keys', action === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('keys');
    const request = action === 'get' ? store.get(name) : action === 'delete' ? store.delete(name) : store.put(value, name);
    tx.oncomplete = () => resolve(action === 'get' ? request.result as CryptoKey | undefined : value);
    tx.onabort = tx.onerror = () => reject(new Error('The pairing key could not be saved. Try again in a regular browser window.'));
  });
}
async function keyFor(pair: string, account: Account) {
  checkAccount(account);
  const found = keys.get(pair) ?? await keyStore('get', pair, account.id);
  checkAccount(account);
  if (found) keys.set(pair, found);
  return found;
}
const serverAge = (pair: Pick<PairRecord, 'serverTime'>, date: string) => (pair.serverTime ? Date.parse(pair.serverTime) : Date.now()) - Date.parse(date);
class StartRejected extends Error {}
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const pathFor = (id: string, suffix = '') => `relay/pairs/${encodeURIComponent(id)}${suffix}`;
const route = (pair: string, message: Pick<Packet, 'id' | 'controller' | 'turn' | 'kind'>, direction: MessageRoute['direction']): MessageRoute => ({ pair, ...message, direction });
const pending = new Map<string, { kind: Packet['kind']; pair: string; controller: string; turn: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function interrupted(run: Run, message: string) {
  if (!runs.delete(run.id)) return;
  run.onEvent({ type: 'error', message });
}
function disconnected(message: string) {
  connection = null;
  set({ connected: false, error: message });
  for (const run of [...runs.values()]) interrupted(run, message);
  for (const [id, receipt] of pending) { clearTimeout(receipt.timer); receipt.reject(new Error(message)); pending.delete(id); }
}
function currentAccount(account: Account) { return owner === account.id && generation === account.generation && cloudState().user?.id === account.id; }
export function remoteRunCurrent(id: string) {
  const run = runs.get(id);
  return Boolean(run && currentAccount(run.account) && connection?.pair === run.pair && connection.controller === run.controller);
}
function checkAccount(account: Account) { if (!currentAccount(account)) throw new Error('Your workspace account changed. Try again in the current account.'); }
function updateOwner() {
  const current = cloudState().user?.id ?? null;
  if (current === owner) return;
  generation++; refreshing = undefined;
  disconnected('Your workspace account changed. Remote work is interrupted.');
  owner = current; keys.clear(); statuses.clear(); knownRuns.clear(); ownedControllers.clear();
  set({ initialized: false, pairs: [], selected: current ? localStorage.getItem(`leadinglight.remote-selected:${current}`) : null, connecting: false, error: '' });
}
function accountNow(): Account {
  updateOwner();
  if (!owner) throw new Error('Sign in before connecting a Mac.');
  return { id: owner, generation };
}
async function pairView(pair: PairRecord, account: Account): Promise<RemotePair> {
  const key = await keyFor(pair.id, account);
  let status: RemotePair['status'], error: string | undefined;
  if (key && pair.status) {
    const cached = statuses.get(pair.id);
    try {
      status = cached?.id === pair.status.id ? cached.value : await unseal<NonNullable<RemotePair['status']>>(key, { pair: pair.id, controller: '', turn: '', direction: 'mac', id: pair.status.id, kind: 'status' }, pair.status.envelope);
      if (typeof status?.claude?.installed !== 'boolean' || typeof status?.claude?.logged_in !== 'boolean') throw new Error('Invalid Mac status.');
      checkAccount(account);
      statuses.set(pair.id, { id: pair.status.id, value: status });
    } catch { error = 'The Mac’s encrypted status could not be verified. Remove this connection and pair again.'; }
  }
  checkAccount(account);
  return { ...pair, status, localKey: Boolean(key), online: Boolean(key && !error && pair.state === 'active' && pair.lastSeen && serverAge(pair, pair.lastSeen) < 25_000), error };
}
let refreshing: Promise<void> | undefined;
export function refreshPairs(): Promise<void> {
  updateOwner();
  if (!cloudState().initialized) return Promise.resolve();
  if (!owner) { set({ initialized: true }); return Promise.resolve(); }
  if (refreshing) return refreshing;
  const account = accountNow();
  const work = (async () => {
    const { pairs } = await cloudApi<{ pairs: PairRecord[] }>('relay/pairs');
    checkAccount(account);
    const views = await Promise.all(pairs.map((pair) => pairView(pair, account)));
    checkAccount(account);
    set({ initialized: true, pairs: views });
    const selected = selectedPair();
    if (connection && (!selected || selected.state !== 'active' || !selected.localKey)) disconnected('This Mac connection was removed. Its remote work will stop on the next connection check.');
  })().catch((error) => { if (currentAccount(account)) set({ initialized: true, error: messageOf(error) }); }).finally(() => { if (refreshing === work) refreshing = undefined; });
  refreshing = work;
  return work;
}
export async function createPair(browserName: string) {
  await refreshPairs();
  const account = accountNow(), invitation = await pairingKey();
  checkAccount(account);
  try {
    await keyStore('put', invitation.id, account.id, invitation.key);
    checkAccount(account);
    keys.set(invitation.id, invitation.key);
    const { pair } = await cloudApi<{ pair: PairRecord }>('relay/pairs', { id: invitation.id, browserName: browserName.trim() || 'My browser', inviteHash: invitation.inviteHash });
    checkAccount(account);
    await refreshPairs();
    checkAccount(account);
    return { code: invitation.code, pair };
  } catch (error) { await keyStore('delete', invitation.id, account.id); if (currentAccount(account)) keys.delete(invitation.id); throw error; }
}
export async function selectPair(id: string, options: { takeover?: boolean } = {}) {
  if (runs.size) throw new Error('Stop or finish the current task before changing the connection.');
  const account = accountNow();
  if (state.connecting) throw new Error('Wait for the current connection attempt to finish.');
  set({ connecting: true, error: '' });
  try {
    await refreshPairs();
    checkAccount(account);
    const pair = state.pairs.find((entry) => entry.id === id), key = pair && await keyFor(id, account);
    checkAccount(account);
    if (!pair || !key) throw new Error('Pair this browser with the Mac first.');
    if (!pair.online) throw new Error('This Mac is offline. Open LeadingLight and keep your Mac awake and connected.');
    const controller = crypto.randomUUID();
    const result = await cloudApi<{ pair: PairRecord; after: string }>(pathFor(id, '/control'), { controller, takeover: options.takeover || Boolean(pair.controller && ownedControllers.has(pair.controller)) });
    checkAccount(account);
    ownedControllers.add(controller);
    connection = { account, pair: id, controller, after: String(result.after), key };
    lastPollSuccess = Date.now();
    localStorage.setItem(`leadinglight.remote-selected:${account.id}`, id);
    set({ selected: id, connected: true, error: '' });
    await poll();
  } finally { if (currentAccount(account)) set({ connecting: false }); }
}
export async function removePair(id: string) {
  const account = accountNow();
  await cloudApi(pathFor(id), undefined, 'DELETE');
  checkAccount(account);
  if (connection?.pair === id) disconnected('The connection was removed. The Mac will stop its remote work on the next check, or within a minute if disconnected.');
  await keyStore('delete', id, account.id);
  checkAccount(account);
  keys.delete(id); statuses.delete(id);
  if (state.selected === id) { localStorage.removeItem(`leadinglight.remote-selected:${account.id}`); set({ selected: null }); }
  await refreshPairs();
}
export async function remoteStatus(): Promise<AgentStatus> {
  const pair = selectedPair();
  return pair?.status?.claude ?? { installed: false, logged_in: false, error: pair?.error ?? 'Connect to an online Mac in Account and sync → Agents.' };
}
export async function remoteCodex(): Promise<unknown> {
  const value = selectedPair()?.status?.codex;
  if (!value) throw new Error('Codex status is not available from this Mac yet.');
  return value;
}

async function send(run: Run, kind: Packet['kind'], body: unknown, timeout = 25_000) {
  checkAccount(run.account);
  const packet = { id: crypto.randomUUID(), controller: run.controller, turn: run.id, kind };
  const envelope = await seal(run.key, route(run.pair, packet, 'browser'), body);
  checkAccount(run.account);
  let settled = false;
  const received = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(packet.id); reject(new Error(kind === 'cancel' ? 'The Mac has not confirmed stopping. The connection will pause so the Mac stops remote work within a minute.' : 'The Mac did not acknowledge this request. The turn will not restart automatically.')); }, timeout);
    pending.set(packet.id, { kind, pair: run.pair, controller: run.controller, turn: run.id, timer, resolve: () => { settled = true; resolve(); }, reject });
  });
  // A receipt can arrive before the HTTP acknowledgement; keep the same encrypted packet on retries.
  void received.catch(() => {});
  try {
    for (let attempt = 0; ; attempt++) {
      checkAccount(run.account);
      try { await cloudApi(pathFor(run.pair, '/messages'), { ...packet, envelope }); checkAccount(run.account); break; }
      catch (error) {
        if (settled) break;
        if (kind === 'start' && attempt === 0 && error instanceof CloudError && error.status >= 400 && error.status < 500) throw new StartRejected(error.message);
        if (attempt >= 1 || error instanceof CloudError && error.status < 500) throw error;
        await sleep(500);
      }
    }
    await received;
    checkAccount(run.account);
  } finally {
    const receipt = pending.get(packet.id);
    if (receipt) { clearTimeout(receipt.timer); pending.delete(packet.id); }
  }
}
function stopUncertain(run: Run, message: string) {
  void send(run, 'cancel', { type: 'cancel' }, 10_000).catch(() => {});
  if (connection?.pair === run.pair && connection.controller === run.controller && currentAccount(run.account)) disconnected(message);
  else interrupted(run, message);
}
export async function remoteAsk(request: AskRequest, onEvent: (event: AgentEvent) => void) {
  if (!remoteReady() || !connection) throw new Error('Connect to an online Mac in Account and sync → Agents. Your question has been kept.');
  if (request.tail) throw new Error('Automatic background requests are not part of this Mac connection.');
  if (runs.size) throw new Error('The Mac is already working on a page-agent task for this browser. Finish or stop it first.');
  checkAccount(connection.account);
  const run: Run = { id: request.id, account: connection.account, pair: connection.pair, controller: connection.controller, key: connection.key, onEvent };
  knownRuns.add(run.id); runs.set(run.id, run);
  try { await send(run, 'start', { type: 'ask', ask: request }); }
  catch (error) {
    if (error instanceof StartRejected) { runs.delete(run.id); throw error; }
    stopUncertain(run, `${messageOf(error)} The connection is paused so the Mac stops this turn within a minute. Reconnect before trying again.`);
    throw error;
  }
}
export async function remoteReply(id: string, message: object) {
  const run = runs.get(id);
  if (!run) return;
  try { await send(run, 'reply', { type: 'reply', message }); }
  catch (error) {
    stopUncertain(run, `The connection interrupted this turn: ${messageOf(error)} Any changes already made are kept. The connection is paused so the Mac stops this turn within a minute.`);
  }
}
export async function remoteCancel(id: string) {
  const run = runs.get(id);
  if (!run) return;
  return run.cancelling ??= send(run, 'cancel', { type: 'cancel' }).then(() => { runs.delete(id); }).catch((error) => {
    run.cancelling = undefined;
    const message = `Stopping could not be confirmed: ${messageOf(error)} Reconnect before starting another task.`;
    if (connection?.pair === run.pair && connection.controller === run.controller && currentAccount(run.account)) disconnected(message);
    else interrupted(run, message);
    throw error;
  });
}

async function acceptEvent(event: RemoteEvent, binding: NonNullable<typeof connection>) {
  let payload: AgentEvent | Receipt | Ended;
  try {
    payload = await unseal<AgentEvent | Receipt | Ended>(binding.key, { pair: binding.pair, controller: event.controller, turn: event.turn, direction: 'mac', id: event.id, kind: event.kind }, event.envelope);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    const valid = payload.type === 'receipt' ? typeof payload.messageId === 'string' && typeof payload.ok === 'boolean' && (payload.error === undefined || typeof payload.error === 'string')
      : payload.type === 'ended' ? ['stopped', 'interrupted'].includes(payload.how) && (payload.message === undefined || typeof payload.message === 'string')
      : payload.type === 'error' ? typeof payload.message === 'string'
      : payload.type === 'line' && payload.line && typeof payload.line === 'object' && !Array.isArray(payload.line);
    if (!valid) throw new Error();
  } catch { throw new Error('The Mac’s encrypted agent message could not be verified. Reconnect before trying again.'); }
  checkAccount(binding.account);
  if (connection !== binding) return;
  if (payload.type === 'receipt') {
    const receipt = pending.get(payload.messageId);
    if (!receipt || receipt.pair !== binding.pair || receipt.controller !== event.controller || receipt.turn !== event.turn) return;
    clearTimeout(receipt.timer); pending.delete(payload.messageId);
    if (payload.ok) receipt.resolve(); else receipt.reject(new Error(payload.error || 'The Mac refused this request.'));
    return;
  }
  const run = runs.get(event.turn);
  if (!run || run.pair !== binding.pair || run.controller !== event.controller) return;
  if (payload.type === 'ended') {
    if (run.cancelling && payload.how === 'stopped') {
      for (const [id, receipt] of pending) if (receipt.kind === 'cancel' && receipt.pair === binding.pair && receipt.controller === event.controller && receipt.turn === event.turn) {
        clearTimeout(receipt.timer); pending.delete(id); receipt.resolve();
      }
    } else if (!run.cancelling) interrupted(run, payload.message || 'The remote turn was interrupted. Its partial reply has been kept.');
    return;
  }
  if (payload.type !== 'line' && payload.type !== 'error') throw new Error('The Mac sent an unsupported agent event.');
  run.onEvent(payload);
  if (payload.type === 'error' || !run.cancelling && (payload.line?.type === 'result' || payload.line?.method === 'turn/completed')) runs.delete(run.id);
}
let polling = false, lastPollSuccess = 0;
async function poll() {
  const binding = connection;
  if (!binding || polling || !cloudState().user || cloudState().user?.id !== owner) return;
  polling = true;
  try {
    const result = await cloudApi<{ pair: PairRecord; events: RemoteEvent[] }>(`${pathFor(binding.pair, '/events')}?controller=${binding.controller}&after=${binding.after}`);
    if (connection !== binding || !currentAccount(binding.account)) return;
    lastPollSuccess = Date.now();
    const pair = await pairView(result.pair, binding.account);
    if (connection !== binding || !currentAccount(binding.account)) return;
    set({ pairs: state.pairs.map((p) => p.id === pair.id ? pair : p), error: '' });
    if (pair.state !== 'active' || !pair.lastSeen || serverAge(pair, pair.lastSeen) > 60_000) {
      disconnected('Your Mac disconnected. This turn is interrupted; any partial reply has been kept. Reconnect before starting another task.');
      return;
    }
    for (const event of result.events) {
      if (!/^\d+$/.test(String(event.seq)) || event.controller !== binding.controller || BigInt(event.seq) <= BigInt(binding.after)) continue;
      await acceptEvent(event, binding);
      binding.after = String(event.seq);
    }
  } catch (error) {
    if (connection !== binding || !currentAccount(binding.account)) return;
    const fatal = error instanceof CloudError && error.status < 500 || !(error instanceof CloudError) && /encrypted|decrypt|operation-specific|unsupported/i.test(messageOf(error));
    if (fatal || Date.now() - lastPollSuccess > 20_000) disconnected(`${messageOf(error)} Remote work is interrupted; your Mac stops it on its next check or within a minute. Partial replies are kept.`);
    else set({ error: 'Reconnecting to your Mac…' });
  } finally { polling = false; }
}
let started = false;
async function startRemote() {
  if (await isNative || started) return;
  started = true;
  onCloud(() => { if (cloudState().initialized && (!state.initialized || owner !== (cloudState().user?.id ?? null))) void refreshPairs(); });
  let refreshed = 0;
  const tick = async () => {
    try {
      if (Date.now() - refreshed > 10_000 || owner !== (cloudState().user?.id ?? null)) { await refreshPairs(); refreshed = Date.now(); }
      await poll();
    } finally { setTimeout(() => void tick(), runs.size ? 800 : connection ? 4000 : 5000); }
  };
  void tick();
  window.addEventListener('online', () => { void refreshPairs(); void poll(); });
}
