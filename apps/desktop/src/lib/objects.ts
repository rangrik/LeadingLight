import { isNative } from "./platform";
import type { ObjectStore } from "./store";
import { localStore } from "./store-local";
import { sqliteStore } from "./store-sqlite";

export type { LLObject, ObjectPatch, ObjectSummary } from "./store";

const store = isNative.then((native) => (native ? sqliteStore : localStore));

export const objects: ObjectStore = {
  list: async () => (await store).list(),
  get: async (id) => (await store).get(id),
  create: async (typeId) => (await store).create(typeId),
  update: async (id, patch) => (await store).update(id, patch),
  remove: async (id) => (await store).remove(id),
};
