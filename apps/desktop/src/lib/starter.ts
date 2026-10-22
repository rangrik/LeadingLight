import type { Catalog, Choice, PropDef, TypeDef } from "./catalog";
import type { Color } from "./page-meta";

// The types and properties a new space starts with. Plain data: users change or delete them
// like their own. Page, Tag and Daily note are system types the app's features rely on.

const choices = (...list: [string, Color][]): Choice[] => list.map(([name, color]) => ({ id: name.toLowerCase().replaceAll(" ", "-"), name, color }));

type Seed<T> = Omit<T, "createdAt">;

const PROPS: Seed<PropDef>[] = [
  { id: "tags", name: "Tags", kind: "relation", options: { many: true, type: "tag" } },
  { id: "aliases", name: "Aliases", kind: "text", options: {} },
  { id: "created", name: "Created", kind: "created", options: {} },
  { id: "updated", name: "Updated", kind: "updated", options: {} },
  { id: "email", name: "Email", kind: "link", options: {} },
  { id: "phone", name: "Phone", kind: "text", options: {} },
  { id: "company", name: "Company", kind: "text", options: {} },
  { id: "birthday", name: "Birthday", kind: "date", options: {} },
  { id: "author", name: "Author", kind: "relation", options: { many: true, type: "person", reverse: "Books" } },
  { id: "rating", name: "Rating", kind: "number", options: {} },
  { id: "book-status", name: "Status", kind: "select", options: { choices: choices(["To read", "gray"], ["Reading", "blue"], ["Read", "green"]) } },
  { id: "finished", name: "Finished on", kind: "date", options: {} },
  { id: "when", name: "Date", kind: "date", options: { time: true } },
  { id: "attendees", name: "Attendees", kind: "relation", options: { many: true, type: "person", reverse: "Meetings" } },
  { id: "project", name: "Project", kind: "relation", options: { type: "project", reverse: "Meetings" } },
  { id: "project-status", name: "Status", kind: "select", options: { choices: choices(["Planned", "gray"], ["Active", "blue"], ["Done", "green"]) } },
  { id: "due", name: "Due", kind: "date", options: {} },
  { id: "items", name: "Items", kind: "relation", options: { many: true } },
];

const type = (id: string, name: string, plural: string, icon: string | undefined, color: Color, props: string[], card: string[] = []): Seed<TypeDef> => ({
  id,
  name,
  plural,
  icon: icon ? { kind: "icon", name: icon, color } : undefined,
  color,
  props,
  card,
  linkView: "line",
});

const TYPES: Seed<TypeDef>[] = [
  { ...type("page", "Page", "Pages", undefined, "gray", []), system: true },
  { ...type("tag", "Tag", "Tags", "hash", "gray", []), system: true },
  { ...type("daily", "Daily note", "Daily notes", "calendar-days", "blue", []), system: true },
  type("person", "Person", "People", "user", "blue", ["email", "phone", "company", "birthday", "tags"], ["company"]),
  type("book", "Book", "Books", "book-open", "orange", ["author", "rating", "book-status", "finished", "tags"], ["author", "book-status"]),
  type("meeting", "Meeting", "Meetings", "users", "green", ["when", "attendees", "project", "tags"], ["when"]),
  type("project", "Project", "Projects", "folder-kanban", "purple", ["project-status", "due", "tags"], ["project-status", "due"]),
  type("idea", "Idea", "Ideas", "lightbulb", "yellow", ["tags"]),
  type("collection", "Collection", "Collections", "library", "teal", ["items", "tags"]),
];

// Everything to add to a space that hasn't been given the starter set yet.
export function starter(catalog: Catalog): Catalog {
  if (catalog.types.some((t) => t.id === "tag")) return { types: [], props: [] };
  const now = Date.now();
  return {
    props: PROPS.map((p, i) => ({ ...p, createdAt: now + i })),
    // The page type may exist already (SQLite seeds it); it keeps its place first.
    types: TYPES.map((t, i) => ({ ...t, createdAt: catalog.types.find((c) => c.id === t.id)?.createdAt ?? now + i })),
  };
}
