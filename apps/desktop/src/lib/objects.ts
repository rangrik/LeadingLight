import { blankPaper } from "./paper";
import { checkNotebookType, NOTEBOOK_TYPE } from "./page-format";
import type { EditorDoc } from "@leadinglight/editor/editor";
import { resolveAssetUrls } from "./assets";
import { isNative } from "./platform";
import type { ObjectStore, ObjectSummary } from "./store";
import { localStore } from "./store-local";
import { sqliteStore } from "./store-sqlite";
import { withHistory } from "./history-store";
import type { HistoryEntry } from "./history-types";

export type { LLObject, ObjectPatch, ObjectSummary, ProjectFolder } from "./store";

const listeners = new Set<(entry: HistoryEntry) => void>();
export const onHistory = (fn: (entry: HistoryEntry) => void) => (listeners.add(fn), () => { listeners.delete(fn); });
const store = isNative.then((native) => withHistory(native ? sqliteStore : localStore, (entry) => listeners.forEach((fn) => fn(entry))));

export const objects: ObjectStore = {
  list: async () => resolveAssetUrls(await (await store).list()),
  get: async (id) => resolveAssetUrls(await (await store).get(id)),
  create: async (init, context) => resolveAssetUrls(await (await store).create(init?.typeId === NOTEBOOK_TYPE ? { ...init, properties: { paper: blankPaper(), ...init.properties } } : init, context)),
  update: async (id, patch, context) => {
    const db = await store;
    if (patch.typeId !== undefined) {
      const before = await db.get(id);
      if (before) checkNotebookType(before.typeId, patch.typeId);
    }
    return db.update(id, patch, context);
  },
  remove: async (id, context) => (await store).remove(id, context),
  history: async () => resolveAssetUrls(await (await store).history()),
  touched: async (from, to) => (await store).touched(from, to),
  commit: async (entry) => (await store).commit(entry),
  containing: async (text) => resolveAssetUrls(await (await store).containing(text)),
  catalog: async () => resolveAssetUrls(await (await store).catalog()),
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

// Search reads plain text once, then only rereads pages whose summaries changed.
// Keep assets out of this path: images need not load to find their page's words.
const textIndex = new Map<string, { stamp: number; text: string }>();
let indexing: Promise<void> | undefined;
let indexed = false;
const changedDuringIndex = new Set<string>();
onHistory((entry) => {
  for (const change of entry.changes) {
    const id = (change.after ?? change.before)!.id;
    textIndex.delete(id);
    if (indexing && !indexed) changedDuringIndex.add(id);
  }
});
export const pageTexts = {
  async read(pages: ObjectSummary[]): Promise<Map<string, string>> {
    const db = await store;
    if (!indexing) {
      const stamps = new Map(pages.map((p) => [p.id, p.updatedAt]));
      indexing = db.containing("").then((all) => {
        for (const p of all) if (!changedDuringIndex.has(p.id)) textIndex.set(p.id, { stamp: stamps.get(p.id) ?? p.updatedAt, text: docText(p.content) });
        indexed = true;
        changedDuringIndex.clear();
      }).catch((error) => { indexing = undefined; throw error; });
    }
    await indexing;
    const current = new Set(pages.map((p) => p.id));
    for (const id of textIndex.keys()) if (!current.has(id)) textIndex.delete(id);
    await Promise.all(pages.filter((p) => textIndex.get(p.id)?.stamp !== p.updatedAt).map(async (p) => {
      const page = await db.get(p.id);
      if (page) textIndex.set(p.id, { stamp: p.updatedAt, text: docText(page.content) });
    }));
    return new Map(pages.map((p) => [p.id, textIndex.get(p.id)?.text ?? ""]));
  },
};
