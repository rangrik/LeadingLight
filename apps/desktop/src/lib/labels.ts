import type { PageStyle } from "@leadinglight/editor/editor";

// What a page is called in lists and dialogs. A title of only spaces counts as none.
export const pageLabel = (title: string) => title.trim() || "Untitled";

// The plural a new type is offered: English's common rules, so "Category" reads "Categories".
export const pluralOf = (name: string) =>
  /[^aeiou]y$/i.test(name) ? `${name.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`;

// A page with no style saved, or one this version doesn't know, is Plain.
export const pageStyle = (properties: Record<string, unknown>): PageStyle => (properties.style === "playful" ? "playful" : "plain");
