import { readIcon } from "./page-meta";
import { asDoc, type LLObject, newObject, type ObjectStore } from "./store";

// Browser-only store for dev, QA and previews. IndexedDB with one record per page, so a big
// image in one page can't stop the others saving (localStorage caps out near 5 MB in total).
const DB = "leadinglight";
const STORE = "objects";
const OLD_KEY = "leadinglight.objects";

// The last stored copy of each page this session has opened.
const known = new Map<string, LLObject>();

let dbPromise: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      // Pages from the earlier localStorage build move over once.
      for (const obj of JSON.parse(localStorage.getItem(OLD_KEY) ?? "[]") as LLObject[]) store.put(obj);
    };
    req.onsuccess = () => {
      localStorage.removeItem(OLD_KEY);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Runs one request and resolves once it has committed. Committing right away matters while
// the page unloads: no later task runs then, so nothing else would commit it.
async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const t = (await db()).transaction(STORE, mode);
  const req = fn(t.objectStore(STORE));
  t.commit();
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(req.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const localStore: ObjectStore = {
  async list() {
    const all = await tx<LLObject[]>("readonly", (s) => s.getAll());
    return all
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, typeId, title, properties, createdAt }) => ({ id, typeId, title, icon: readIcon(properties?.icon), createdAt }));
  },

  async get(id) {
    const obj = await tx<LLObject | undefined>("readonly", (s) => s.get(id));
    if (!obj) return null;
    known.set(id, { ...obj, content: asDoc(obj.content) });
    return known.get(id) ?? null;
  },

  async create(typeId) {
    const obj = newObject(typeId);
    await tx("readwrite", (s) => s.add(obj));
    known.set(obj.id, obj);
    return obj;
  },

  // One write, no read first: a read's answer never comes back once the page is unloading.
  async update(id, patch) {
    const obj = known.get(id) ?? (await localStore.get(id));
    if (!obj) return;
    const next = { ...obj, ...patch, updatedAt: Date.now() };
    known.set(id, next);
    await tx("readwrite", (s) => s.put(next));
  },

  // Forgetting it first means a late save of this page finds nothing and can't bring it back.
  async remove(id) {
    known.delete(id);
    await tx("readwrite", (s) => s.delete(id));
  },
};
