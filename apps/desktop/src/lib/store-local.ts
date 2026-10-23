import type { PropDef, TypeDef } from "./catalog";
import { asDoc, type LLObject, newObject, type ObjectStore, PAGE_TYPE, summarize } from "./store";

// Browser-only store for dev, QA and previews. IndexedDB with one record per page, so a big
// image in one page can't stop the others saving (localStorage caps out near 5 MB in total).
const DB = "leadinglight";
const OBJECTS = "objects";
const TYPES = "types";
const PROPS = "props";
const OLD_KEY = "leadinglight.objects";

// The last stored copy of each page this session has opened.
const known = new Map<string, LLObject>();

let dbPromise: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
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
    const next = { ...obj, ...patch, updatedAt: Date.now() };
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
      .filter((o) => JSON.stringify([o.content, o.properties]).toLowerCase().includes(needle))
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
};
