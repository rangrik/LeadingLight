import type { Color, PageIcon } from "./page-meta";

// What a property holds. Each kind's editor and display live in components/property-value.tsx.
export const KINDS = {
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  date: "Date",
  select: "Select",
  relation: "Pages",
  link: "Link",
  file: "File",
  created: "Created",
  updated: "Updated",
};
export type Kind = keyof typeof KINDS;

export type Choice = { id: string; name: string; color: Color };
export type PropOptions = {
  many?: boolean; // select and relation
  choices?: Choice[]; // select
  type?: string; // relation: only pages of this type
  reverse?: string; // relation: name shown on the linked pages, listing who links to them
  time?: boolean; // date
  range?: boolean; // date
};
export type PropDef = { id: string; name: string; kind: Kind; options: PropOptions; createdAt: number };

export type LinkView = "line" | "card" | "wide" | "page";
// How a list of pages shows: kept per type.
export type ViewSettings = { kind: "list" | "table" | "gallery" | "board"; sort: { by: string; desc?: boolean }; group?: string };
export type TypeDef = {
  id: string;
  name: string;
  plural: string;
  icon?: PageIcon;
  color?: Color;
  props: string[]; // shown on every page of the type, in this order
  card: string[]; // shown on its cards
  linkView: LinkView;
  template?: string; // the default template's page id
  system?: boolean; // can't be deleted: the app relies on it
  made?: "app"; // made by the app for its agents (an Agent, a Report), so New doesn't offer it
  view?: ViewSettings; // its list of pages
  createdAt: number;
};

export type Catalog = { types: TypeDef[]; props: PropDef[] };

// Keys a page's properties map uses for itself, never property ids.
export const OWN_KEYS = new Set(["icon", "cover", "description", "templateOf"]);

export const newId = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;

// What a property's value must fit: its name, kind and the options that shape the value.
const shape = (p: PropDef) => JSON.stringify([p.name, p.kind, !!p.options.many, p.options.type ?? null, p.options.choices?.map((c) => c.id) ?? null]);
const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

// A page changing type: a value the new type has no row for moves to its property of the same
// shape, if that one is empty. An idea's Project becomes the task's instead of a stray row.
export function carry(values: Record<string, unknown>, to: TypeDef, props: PropDef[]): Record<string, unknown> {
  const def = (id: string) => props.find((p) => p.id === id);
  let next = values;
  for (const key of Object.keys(values)) {
    const from = def(key);
    if (!from || to.props.includes(key)) continue;
    const twin = to.props.map(def).find((p) => p && shape(p) === shape(from));
    if (!twin || !empty(next[twin.id])) continue;
    const { [key]: value, ...rest } = next;
    next = { ...rest, [twin.id]: value };
  }
  return next;
}

// Values as stored. Dates are ISO days, so they sort as text.
export type DateValue = { start: string; time?: string; end?: string };
export type FileValue = { url: string; name: string; size: number; mime: string };
