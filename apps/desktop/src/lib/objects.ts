import type { EditorDoc } from "@leadinglight/editor/editor";
import { isNative } from "./platform";
import type { ObjectStore } from "./store";
import { localStore } from "./store-local";
import { sqliteStore } from "./store-sqlite";
import { withHistory } from "./history-store";
import type { HistoryEntry } from "./history-types";

export type { LLObject, ObjectPatch, ObjectSummary, ProjectFolder } from "./store";

const listeners = new Set<(entry: HistoryEntry) => void>();
export const onHistory = (fn: (entry: HistoryEntry) => void) => (listeners.add(fn), () => { listeners.delete(fn); });
const store = isNative.then((native) => withHistory(native ? sqliteStore : localStore, (entry) => listeners.forEach((fn) => fn(entry))));

export const objects: ObjectStore = {
  list: async () => (await store).list(),
  get: async (id) => (await store).get(id),
  create: async (init, context) => (await store).create(init, context),
  update: async (id, patch, context) => (await store).update(id, patch, context),
  remove: async (id, context) => (await store).remove(id, context),
  history: async () => (await store).history(),
  commit: async (entry) => (await store).commit(entry),
  containing: async (text) => (await store).containing(text),
  catalog: async () => (await store).catalog(),
  putType: async (type) => (await store).putType(type),
  deleteType: async (id) => (await store).deleteType(id),
  putProp: async (prop) => (await store).putProp(prop),
  deleteProp: async (id) => (await store).deleteProp(id),
  folders: async () => (await store).folders(),
  putFolder: async (folder) => (await store).putFolder(folder),
  deleteFolder: async (pageId) => (await store).deleteFolder(pageId),
};

// A saved page's words as plain text, one line per block: what a mentioned page adds
// to the agent's context without an editor open on it.
export function docText(doc: EditorDoc | null): string {
  const lines: string[] = [];
  const walk = (node: EditorDoc): string => {
    if (node.type === "text") return node.text ?? "";
    const kids = node.content ?? [];
    if (kids.some((k) => k.type === "text")) {
      lines.push(kids.map(walk).join(""));
      return "";
    }
    kids.forEach(walk);
    return "";
  };
  if (doc) walk(doc);
  return lines.filter((l) => l.trim()).join("\n");
}
