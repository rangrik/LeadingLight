import { type LLObject, type ObjectSummary, objects } from "./objects";

// A page's Thoughts page and essay hang off it; the links live in `properties` (DECISIONS.md, 6).
export type Role = "thoughts" | "essay";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
export const parentOf = (p: ObjectSummary) => str(p.properties.parent);
export const roleOf = (p: ObjectSummary) => str(p.properties.role) as Role | undefined;
export const childOf = (p: ObjectSummary, role: Role) => str(p.properties[role]);

// Makes the child page; the caller links the parent to it.
export async function createChild(parent: ObjectSummary, role: Role): Promise<LLObject> {
  const obj = await objects.create();
  const patch = { title: role === "thoughts" ? "Thoughts" : "", properties: { parent: parent.id, role } };
  await objects.update(obj.id, patch);
  return { ...obj, ...patch };
}

// In-app links: `ll:<page id>#<anchor id>`.
export function parseHref(href: string) {
  const m = /^ll:([^#]+)(?:#(.+))?$/.exec(href);
  return m ? { page: m[1], anchor: m[2] } : null;
}
