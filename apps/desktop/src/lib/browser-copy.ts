export const OLD_ORIGIN = 'https://leadinglight-web.vercel.app';
export const APP_ORIGIN = 'https://leadinglight.app';
export const COPY_READY = 'leadinglight.address-ready';
const stores = ['objects', 'types', 'props', 'folders', 'history', 'pending-history'] as const;
type Store = typeof stores[number];
type Row = Record<string, unknown>;
type Snapshot = { version: 1; records: Record<Store, Row[]>; preferences: Record<string, string> };
const preferences = new Set(['ll.panes', 'll.sidebar.open', 'll.sidebar.width', 'leadinglight.authorship', 'll.browser.annotations.v1', 'leadinglight.sync-owner']);
const kept = (key: string) => preferences.has(key) || key.startsWith('ll.threads.') || key.startsWith('leadinglight.emergency:');
const failure = (error: unknown) => error instanceof Error ? error.message : 'The copy could not be saved. Your original notes are safe.';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('leadinglight', 5);
    request.onupgradeneeded = () => {
      for (const name of stores) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: name === 'folders' ? 'pageId' : 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other LeadingLight tabs at this address and try again.'));
  });
}

export async function hasBrowserNotes() {
  if (localStorage.getItem('leadinglight.objects')) return true;
  const db = await open();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction([...stores]); let count = 0;
      for (const name of stores) { const request = tx.objectStore(name).count(); request.onsuccess = () => { count += request.result; }; }
      tx.oncomplete = () => resolve(count > 0 || Boolean(localStorage.getItem('leadinglight.objects')));
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function snapshot(): Promise<Snapshot> {
  const db = await open();
  try {
    const records = await new Promise<Record<Store, Row[]>>((resolve, reject) => {
      const tx = db.transaction([...stores]), result = {} as Record<Store, Row[]>;
      for (const name of stores) { const request = tx.objectStore(name).getAll(); request.onsuccess = () => { result[name] = request.result; }; }
      tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(tx.error);
    });
    const values: Record<string, string> = {};
    for (const key of Object.keys(localStorage).filter(kept)) {
      const value = localStorage.getItem(key)!;
      // Transcripts travel; active runs, approvals and device sessions do not.
      values[key] = key.startsWith('ll.threads.') ? JSON.stringify(JSON.parse(value).map((thread: Row) => ({ ...thread, remoteRun: undefined, sessionId: undefined, codexId: undefined, busy: undefined, stopping: undefined, approval: undefined, allowed: [], seen: {}, codexSeen: {} }))) : value;
    }
    return { version: 1, records, preferences: values };
  } finally { db.close(); }
}

async function save(data: Snapshot) {
  if (localStorage.getItem('leadinglight.objects')) throw new Error('This address already has a workspace. Nothing was overwritten. Open its existing notes before copying another workspace.');
  if (data?.version !== 1 || !data.records || !data.preferences || typeof data.preferences !== 'object' || Array.isArray(data.preferences)) throw new Error('The workspace copy is invalid. Your original notes are safe.');
  for (const name of stores) if (!Array.isArray(data.records[name]) || data.records[name].some((row) => !row || typeof row !== 'object' || typeof row[name === 'folders' ? 'pageId' : 'id'] !== 'string')) throw new Error('The workspace copy is incomplete.');
  for (const [key, value] of Object.entries(data.preferences)) if (!kept(key) || typeof value !== 'string') throw new Error('The workspace preferences are invalid.');
  const db = await open(), previous = new Map<string, string | null>();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...stores], 'readwrite'); let remaining = stores.length, count = 0, error: unknown;
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(error ?? tx.error ?? new Error('The copy could not be saved.'));
      for (const name of stores) {
        const request = tx.objectStore(name).count();
        request.onsuccess = () => {
          count += request.result;
          if (--remaining) return;
          try {
            if (count || localStorage.getItem(COPY_READY) || localStorage.getItem('leadinglight.objects') || Object.keys(localStorage).some(kept)) throw new Error('This address already has a workspace. Nothing was overwritten. Keep using the original address or use encrypted sync to bring your devices together.');
            for (const store of stores) for (const row of data.records[store]) tx.objectStore(store).add(row);
            for (const [key, value] of Object.entries({ ...data.preferences, [COPY_READY]: 'true' })) { previous.set(key, localStorage.getItem(key)); localStorage.setItem(key, value); }
          } catch (e) { error = e; tx.abort(); }
        };
      }
    });
  } catch (error) {
    for (const [key, value] of previous) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
    throw error;
  } finally { db.close(); }
  return data.records.objects.length;
}

export function copyBrowserNotes(flush: () => Promise<unknown>): Promise<number> {
  if (location.origin !== OLD_ORIGIN) return Promise.reject(new Error('Open your original workspace to copy its notes.'));
  const code = crypto.randomUUID();
  const target = window.open(`${APP_ORIGIN}/?copy=${code}`, '_blank');
  if (!target) return Promise.reject(new Error('Allow this site to open a new tab, then try copying again. Your notes are still here.'));
  return new Promise((resolve, reject) => {
    let sent = false, ended = false;
    const finish = (error?: string, count = 0) => { if (ended) return; ended = true; clearTimeout(timer); window.removeEventListener('message', receive); error ? reject(new Error(error)) : resolve(count); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== APP_ORIGIN || event.source !== target || event.data?.code !== code) return;
      if (event.data.type === 'copy-ready' && !sent) {
        sent = true;
        void flush().then(snapshot).then((data) => { if (!ended) target.postMessage({ type: 'copy-data', code, data }, APP_ORIGIN); }).catch((error) => { if (!ended) target.postMessage({ type: 'copy-error', code, error: failure(error) }, APP_ORIGIN); finish(failure(error)); });
      }
      if (event.data.type === 'copy-done' && sent) finish(undefined, event.data.count);
      if (event.data.type === 'copy-error') finish(event.data.error);
    };
    const timer = window.setTimeout(() => finish('The copy did not finish. Keep the original tab and try again; no original notes were removed.'), 120_000);
    window.addEventListener('message', receive);
  });
}

export function receiveBrowserNotes(done: (message: string, ok: boolean) => void) {
  const code = new URLSearchParams(location.search).get('copy'), source = window.opener;
  if (location.origin !== APP_ORIGIN || !source || !/^[0-9a-f-]{36}$/.test(code ?? '')) { done('Open your original workspace and choose Copy notes to leadinglight.app.', false); return; }
  let received = false;
  const receive = (event: MessageEvent) => {
    if (received || event.origin !== OLD_ORIGIN || event.source !== source || event.data?.code !== code) return;
    if (event.data.type === 'copy-error') { received = true; clearTimeout(timer); done(event.data.error, false); }
    if (event.data.type !== 'copy-data') return;
    received = true; clearTimeout(timer);
    void save(event.data.data).then((count) => { source.postMessage({ type: 'copy-done', code, count }, OLD_ORIGIN); done(`${count} notes copied. Sign in with the same provider to reconnect your calendars. Set up encrypted sync and paired Macs again when you need them.`, true); }).catch((error) => { source.postMessage({ type: 'copy-error', code, error: failure(error) }, OLD_ORIGIN); done(failure(error), false); });
  };
  const timer = window.setTimeout(() => { received = true; window.removeEventListener('message', receive); done('The original tab did not send a copy. Keep it open and start the copy again there.', false); }, 120_000);
  window.addEventListener('message', receive);
  source.postMessage({ type: 'copy-ready', code }, OLD_ORIGIN);
  return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
}
