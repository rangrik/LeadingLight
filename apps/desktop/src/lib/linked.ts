import type { LLObject, ObjectSummary } from "./objects";
import { createPage } from "./space";

// A page's Thoughts page and essay hang off it; the links live in `properties` (DECISIONS.md, 11).
// Their keys have no property definitions, so they're kept but never shown as properties.
export type Role = "thoughts" | "essay";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
export const parentOf = (p: ObjectSummary) => str(p.properties.parent);
export const roleOf = (p: ObjectSummary) => str(p.properties.role) as Role | undefined;
export const childOf = (p: ObjectSummary, role: Role) => str(p.properties[role]);

// Makes the child page; the caller links the parent to it.
export const createChild = (parent: string, role: Role): Promise<LLObject> =>
  createPage({ title: role === "thoughts" ? "Thoughts" : "", properties: { parent, role } });

// In-app links: `ll:<page id>#<anchor id>`.
export function parseHref(href: string) {
  const m = /^ll:([^#]+)(?:#(.+))?$/.exec(href);
  return m ? { page: m[1], anchor: m[2] } : null;
}
