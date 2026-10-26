import type { Node } from "@tiptap/pm/model";

type Layout = { notes: boolean; headings: number };
const layouts = new WeakMap<Node, Layout>();

// Unchanged branches keep their answer, so typing does not rescan every word for page gutters.
export function pageLayout(node: Node): Layout {
  const cached = layouts.get(node);
  if (cached) return cached;
  let notes = node.marks.some((mark) => mark.type.name === "note");
  let headings = node.type.name === "heading" && node.textContent.trim() ? 1 : 0;
  node.forEach((child) => {
    if (notes && headings >= 2) return;
    const layout = pageLayout(child);
    notes ||= layout.notes;
    headings = Math.min(2, headings + layout.headings);
  });
  const layout = { notes, headings };
  layouts.set(node, layout);
  return layout;
}
