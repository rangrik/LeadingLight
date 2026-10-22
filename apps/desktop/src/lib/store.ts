import type { EditorDoc } from "@leadinglight/editor/editor";
import { fromBlockNote } from "./blocknote";

export const PAGE_TYPE = "page";

export type ObjectSummary = {
  id: string;
  typeId: string;
  title: string;
  properties: Record<string, unknown>;
  createdAt: number;
};

export type LLObject = ObjectSummary & {
  content: EditorDoc | null;
  updatedAt: number;
};

export type ObjectPatch = Partial<Pick<LLObject, "title" | "content" | "properties">>;

export interface ObjectStore {
  list(): Promise<ObjectSummary[]>;
  get(id: string): Promise<LLObject | null>;
  create(typeId?: string): Promise<LLObject>;
  update(id: string, patch: ObjectPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

export function newObject(typeId = PAGE_TYPE): LLObject {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    typeId,
    title: "",
    content: null,
    properties: {},
    createdAt: now,
    updatedAt: now,
  };
}

// Pages from the first editor are a BlockNote block array; convert them rather than drop them.
export function asDoc(value: unknown): EditorDoc | null {
  if (Array.isArray(value)) return value.length ? fromBlockNote(value) : null;
  const doc = value as EditorDoc | null;
  return doc && typeof doc === "object" && doc.type === "doc" ? doc : null;
}
