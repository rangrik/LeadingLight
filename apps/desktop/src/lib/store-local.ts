import { reportSaveError } from "./saving";
import type { ObjectPatch } from "./store";
import { action, type ChangeContext } from "./history-types";
import type { PropDef, TypeDef } from "./catalog";
import { asDoc, type LLObject, newObject, type ObjectStore, PAGE_TYPE, type ProjectFolder, searchable, summarize } from "./store";
import { conflict, type HistoryEntry, sameRevision } from "./history-types";

// Browser-only store for dev, QA and previews. IndexedDB with one record per page, so a big
// image in one page can't stop the others saving (localStorage caps out near 5 MB in total).
const DB = "leadinglight";
const OBJECTS = "objects";
const TYPES = "types";
const PROPS = "props";
const FOLDERS = "folders";
const HISTORY = "history";
const PENDING = "pending-history";
const OLD_KEY = "leadinglight.objects";

// The last stored copy of each page this session has opened.
const known = new Map<string, LLObject>();

let dbPromise: Promise<IDBDatabase> | undefined;
let opened: IDBDatabase | undefined;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 5);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      if (e.oldVersion < 1) {
        const store = d.createObjectStore(OBJECTS, { keyPath: "id" });
        // Pages from the earlier localStorage build move over once.
        for (const obj of JSON.parse(localStorage.getItem(OLD_KEY) ?? "[]") as LLObject[]) store.put(obj);
      }
      if (e.oldVersion < 2) {
        d.createObjectStore(TYPES, { keyPath: "id" });
        d.createObjectStore(PROPS, { keyPath: "id" });
      }
      if (e.oldVersion < 3) d.createObjectStore(FOLDERS, { keyPath: "pageId" });
      if (e.oldVersion < 4) d.createObjectStore(HISTORY, { keyPath: "id" });
      if (e.oldVersion < 5) d.createObjectStore(PENDING, { keyPath: "id" });
    };
    req.onsuccess = () => {
      localStorage.removeItem(OLD_KEY);
      void recover(req.result).then(() => recoverEmergency(req.result)).catch(reportSaveError).then(() => { opened = req.result; resolve(req.result); });
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function applyEntry(d: IDBDatabase, entry: HistoryEntry): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction([OBJECTS, HISTORY, PENDING], "readwrite");
    const pages = t.objectStore(OBJECTS);
    let mismatch = false;
    t.oncomplete = () => resolve();
    t.onabort = t.onerror = () => reject(mismatch ? conflict() : t.error ?? new Error("Couldn't save history"));
    const exists = t.objectStore(HISTORY).get(entry.id);
    exists.onsuccess = () => {
      t.objectStore(PENDING).delete(entry.id);
      if (exists.result) return;
      for (const change of entry.changes) {
        const id = (change.after ?? change.before)!.id;
        const read = pages.get(id);
        read.onsuccess = () => {
          if (!sameRevision(read.result ?? null, change.before)) {
            mismatch = true; t.abort(); return;
          }
          if (change.after) pages.put(change.after); else pages.delete(id);
        };
      }
      t.objectStore(HISTORY).add(entry);
    };
  });
}

async function recover(d: IDBDatabase) {
  const entries = await new Promise<HistoryEntry[]>((resolve, reject) => {
    const req = d.transaction(PENDING).objectStore(PENDING).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const entry of entries.sort((a, b) => a.at - b.at)) {
    try { await applyEntry(d, entry); }
    catch (error) {
      if (!String(error).includes("newer changes")) throw error;
      // A conflicting edit interrupted by closing the tab survives as its own page.
      const id = `recovered:${entry.id}`;
      const recovery: HistoryEntry = { ...entry, id, action: id, label: "Recovered interrupted edits", changes: entry.changes.filter((c) => c.after).map((c, i) => ({ before: null, after: { ...c.after!, id: `${id}:${i}`, revision: id, title: `${c.after!.title || "Untitled"} (recovered edits)` } })) };
      await applyEntry(d, recovery);
      await new Promise<void>((resolve, reject) => {
        const t = d.transaction(PENDING, "readwrite");
        t.objectStore(PENDING).delete(entry.id);
        t.oncomplete = () => resolve(); t.onabort = () => reject(t.error);
      });
    }
  }
}

const EMERGENCY = "leadinglight.emergency:";
const stable = (page: LLObject | null) => JSON.stringify(page && { id: page.id, typeId: page.typeId, title: page.title, content: page.content, properties: page.properties, createdAt: page.createdAt });
const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return `${text.length}:${h >>> 0}`; };
type Emergency = { id: string; base: string; target: string; start: number; end: number; insert: string; context: ChangeContext };

// A tiny synchronous text delta survives WebKit terminating asynchronous unload work.
export function saveEmergency(page: LLObject, patch: ObjectPatch, context?: ChangeContext): string | undefined {
  if (!opened) return;
  const before = known.get(page.id) ?? null;
  const left = stable(before), right = stable({ ...(before ?? page), ...patch });
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  const target = hash(right);
  const entry: Emergency = { id: page.id, base: hash(left), target, start, end, insert: right.slice(start, right.length - end), context: context ?? action("Recovered interrupted edits") };
  try { localStorage.setItem(EMERGENCY + page.id, JSON.stringify(entry)); } catch { return; }
  return target;
}
export function clearEmergency(id: string, target?: string) {
  if (target && JSON.parse(localStorage.getItem(EMERGENCY + id) || "null")?.target === target) localStorage.removeItem(EMERGENCY + id);
}
async function recoverEmergency(d: IDBDatabase) {
  const read = <T,>(name: string, id?: string): Promise<T> => new Promise((resolve, reject) => {
    const req = id ? d.transaction(name).objectStore(name).get(id) : d.transaction(name).objectStore(name).getAll();
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  for (const key of Object.keys(localStorage).filter((k) => k.startsWith(EMERGENCY))) {
    const e = JSON.parse(localStorage.getItem(key)!) as Emergency;
    const current = await read<LLObject | undefined>(OBJECTS, e.id) ?? null;
    if (hash(stable(current)) === e.target) { localStorage.removeItem(key); continue; }
    let source = stable(current);
    if (hash(source) !== e.base) {
      source = 'null';
      if (hash(source) !== e.base) {
        const all = await read<HistoryEntry[]>(HISTORY);
        const candidates = all.flatMap((h) => h.changes.flatMap((c) => [c.before, c.after])).filter((p) => p?.id === e.id);
        const base = candidates.find((p) => hash(stable(p)) === e.base);
        if (!base) throw new Error("Interrupted edits need recovery. Keep this browser’s data and export your notes before clearing storage.");
        source = stable(base);
      }
    }
    const text = source.slice(0, e.start) + e.insert + (e.end ? source.slice(-e.end) : '');
    if (hash(text) !== e.target) throw new Error("The interrupted edit could not be verified. Its recovery copy is still on this device.");
    const restored = JSON.parse(text) as LLObject;
    const id = crypto.randomUUID();
    const conflict = hash(stable(current)) !== e.base;
    const after = { ...restored, ...(conflict ? { id: `recovered:${id}`, title: `${restored.title || 'Untitled'} (recovered edits)` } : {}), updatedAt: Date.now(), revision: id };
    await applyEntry(d, { ...e.context, id, at: Date.now(), changes: [{ before: conflict ? null : current, after }] });
    localStorage.removeItem(key);
  }
}

// Runs one request and resolves once it has committed. Committing right away matters while
// the page unloads: no later task runs then, so nothing else would commit it.
async function tx<T>(name: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const t = (await db()).transaction(name, mode);
  const req = fn(t.objectStore(name));
  t.commit();
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(req.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

// Records from before properties were kept beside each summary lack some fields.
const complete = (obj: LLObject): LLObject => ({ ...newObject(), ...obj, properties: obj.properties ?? {}, content: asDoc(obj.content) });

export const localStore: ObjectStore = {
  history: () => tx<HistoryEntry[]>(HISTORY, "readonly", (s) => s.getAll()),

  async commit(entry) {
    const d = opened ?? await db();
    // This write needs no read callback, so a pagehide can leave a durable recovery record.
    await new Promise<void>((resolve, reject) => {
      const t = d.transaction(PENDING, "readwrite");
      t.objectStore(PENDING).put(entry);
      t.commit();
      t.oncomplete = () => resolve();
      t.onabort = t.onerror = () => reject(t.error);
    });
    try { await applyEntry(d, entry); }
    catch (error) {
      if (String(error).includes("newer changes")) await tx(PENDING, "readwrite", (s) => s.delete(entry.id));
      throw error;
    }
    for (const c of entry.changes) {
      if (c.after) known.set(c.after.id, c.after);
      else if (c.before) known.delete(c.before.id);
    }
  },
  async list() {
    const all = await tx<LLObject[]>(OBJECTS, "readonly", (s) => s.getAll());
    return all.map((o) => summarize(complete(o))).sort((a, b) => b.createdAt - a.createdAt);
  },

  async get(id) {
    const obj = await tx<LLObject | undefined>(OBJECTS, "readonly", (s) => s.get(id));
    if (!obj) return null;
    known.set(id, complete(obj));
    return known.get(id) ?? null;
  },

  async create(init) {
    const obj = newObject(init);
    await tx(OBJECTS, "readwrite", (s) => s.add(obj));
    known.set(obj.id, obj);
    return obj;
  },

  // One write, no read first: a read's answer never comes back once the page is unloading.
  async update(id, patch) {
    const obj = known.get(id) ?? (await localStore.get(id));
    if (!obj) return;
    const next = { ...obj, ...patch, updatedAt: patch.updatedAt ?? Date.now() };
    known.set(id, next);
    await tx(OBJECTS, "readwrite", (s) => s.put(next));
  },

  // Forgetting it first means a late save of this page finds nothing and can't bring it back.
  async remove(id) {
    known.delete(id);
    await tx(OBJECTS, "readwrite", (s) => s.delete(id));
  },

  async containing(text) {
    const needle = text.toLowerCase();
    const all = await tx<LLObject[]>(OBJECTS, "readonly", (s) => s.getAll());
    return all
      .filter((o) => searchable(o).includes(needle))
      .map(complete);
  },

  async catalog() {
    const [types, props] = await Promise.all([
      tx<TypeDef[]>(TYPES, "readonly", (s) => s.getAll()),
      tx<PropDef[]>(PROPS, "readonly", (s) => s.getAll()),
    ]);
    const byAge = <T extends { createdAt: number }>(a: T, b: T) => a.createdAt - b.createdAt;
    return { types: types.sort(byAge), props: props.sort(byAge) };
  },

  async putType(type) {
    await tx(TYPES, "readwrite", (s) => s.put(type));
  },

  async deleteType(id) {
    const all = await tx<LLObject[]>(OBJECTS, "readonly", (s) => s.getAll());
    for (const obj of all.filter((o) => o.typeId === id)) await localStore.update(obj.id, { typeId: PAGE_TYPE });
    await tx(TYPES, "readwrite", (s) => s.delete(id));
  },

  async putProp(prop) {
    await tx(PROPS, "readwrite", (s) => s.put(prop));
  },

  async deleteProp(id) {
    await tx(PROPS, "readwrite", (s) => s.delete(id));
  },

  folders: () => tx<ProjectFolder[]>(FOLDERS, "readonly", (s) => s.getAll()),

  async putFolder(folder) {
    await tx(FOLDERS, "readwrite", (s) => s.put(folder));
  },

  async deleteFolder(pageId) {
    await tx(FOLDERS, "readwrite", (s) => s.delete(pageId));
  },
};
