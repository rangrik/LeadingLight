import type { EditorDoc } from "@leadinglight/editor/editor";
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
