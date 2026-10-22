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
  createdAt: number;
};

export type Catalog = { types: TypeDef[]; props: PropDef[] };

// Keys a page's properties map uses for itself, never property ids.
export const OWN_KEYS = new Set(["icon", "cover", "description", "templateOf"]);

export const newId = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;

// Values as stored. Dates are ISO days, so they sort as text.
export type DateValue = { start: string; time?: string; end?: string };
export type FileValue = { url: string; name: string; size: number; mime: string };
