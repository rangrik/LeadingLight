import { isNative } from "./platform";
import type { ObjectStore } from "./store";
import { localStore } from "./store-local";
import { sqliteStore } from "./store-sqlite";

export type { LLObject, ObjectPatch, ObjectSummary } from "./store";

const store = isNative.then((native) => (native ? sqliteStore : localStore));

export const objects: ObjectStore = {
  list: async () => (await store).list(),
  get: async (id) => (await store).get(id),
  create: async (init) => (await store).create(init),
  update: async (id, patch) => (await store).update(id, patch),
  remove: async (id) => (await store).remove(id),
  containing: async (text) => (await store).containing(text),
  catalog: async () => (await store).catalog(),
  putType: async (type) => (await store).putType(type),
  deleteType: async (id) => (await store).deleteType(id),
  putProp: async (prop) => (await store).putProp(prop),
  deleteProp: async (id) => (await store).deleteProp(id),
};
