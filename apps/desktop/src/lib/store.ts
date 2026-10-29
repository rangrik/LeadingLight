import type { EditorDoc } from "@leadinglight/editor/editor";
import { fromBlockNote } from "./blocknote";
import type { ChangeContext, JournalStore } from "./history-types";
import type { Catalog, PropDef, TypeDef } from "./catalog";

export const PAGE_TYPE = "page";

// Everything but the body: small enough to keep every page's in memory for lists and links.
export type ObjectSummary = {
  id: string;
  typeId: string;
  title: string;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  revision?: string;
};

export type LLObject = ObjectSummary & { content: EditorDoc | null };

// properties replaces the whole map: only one editor holds a page, so it has every value.
// updatedAt is set only by a fix-up that isn't an edit, to keep the page's date.
export type ObjectPatch = Partial<Pick<LLObject, "title" | "content" | "properties" | "typeId" | "updatedAt">>;

// A page linked to a folder on this Mac (features/external-projects.feature). The runtime knows
// the folder as location; folderId is the folder's own identity, so another path to it matches.
export type ProjectFolder = { pageId: string; path: string; folderId: string; location: string; createdAt: number; updatedAt: number };

export interface ObjectStore extends JournalStore {
  list(): Promise<ObjectSummary[]>;
  get(id: string): Promise<LLObject | null>;
  create(init?: Partial<LLObject>, context?: ChangeContext): Promise<LLObject>;
  update(id: string, patch: ObjectPatch, context?: ChangeContext): Promise<void>;
  remove(id: string, context?: ChangeContext): Promise<void>;
  // Pages whose body or properties mention the text: ids for backlinks, titles for mentions.
  containing(text: string): Promise<LLObject[]>;
  catalog(): Promise<Catalog>;
  putType(type: TypeDef): Promise<void>;
  // Its pages become plain pages and keep their values.
  deleteType(id: string): Promise<void>;
  putProp(prop: PropDef): Promise<void>;
  deleteProp(id: string): Promise<void>;
  folders(): Promise<ProjectFolder[]>;
  putFolder(folder: ProjectFolder): Promise<void>;
  deleteFolder(pageId: string): Promise<void>;
}

export function newObject(init: Partial<LLObject> = {}): LLObject {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    typeId: PAGE_TYPE,
    title: "",
    content: null,
    properties: {},
    createdAt: now,
    updatedAt: now,
    ...init,
  };
}

export const summarize = ({ content: _, ...summary }: LLObject): ObjectSummary => summary;

// Pages from the first editor are a BlockNote block array; convert them rather than drop them.
export function asDoc(value: unknown): EditorDoc | null {
  if (Array.isArray(value)) return value.length ? fromBlockNote(value) : null;
  const doc = value as EditorDoc | null;
  return doc && typeof doc === "object" && doc.type === "doc" ? doc : null;
}

// Search content and links, without treating author names as words on the page.
export const searchable = (page: LLObject) => JSON.stringify([page.content, page.properties], (key, value) => key === "marks" && Array.isArray(value) ? value.filter((m) => m.type !== "origin") : value).toLowerCase();
