import { Mark, type JSONContent } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { selectedBlocks } from "./block-selection";

export type Author = { kind: "human" | "agent" | "unknown"; name: string; model?: string; run?: string };
export type EditContext = { action: string; label: string; author: Author; preserveOrigin?: boolean };
let context: EditContext | undefined;
export const currentEdit = () => context;

// Context lives only for a synchronous editor transaction, never across an await.
export function authored<T>(next: EditContext, fn: () => T): T {
  const previous = context;
  context = next;
  try { return fn(); } finally { context = previous; }
}

export function stampDoc(doc: JSONContent | null, author: Author): JSONContent | null {
  if (!doc) return null;
  const marks = doc.type === "text" && !doc.marks?.some((m) => m.type === "origin")
    ? [...(doc.marks ?? []), { type: "origin", attrs: author }]
    : doc.marks;
  return { ...doc, ...(marks && { marks }), ...(doc.content && { content: doc.content.map((n) => stampDoc(n, author)!) }) };
}

export function origins(doc: JSONContent | null): { author: Author; text: string }[] {
  const result: { author: Author; text: string }[] = [];
  const walk = (node: JSONContent) => {
    if (node.text) {
      const attrs = node.marks?.find((m) => m.type === "origin")?.attrs;
      const author: Author = attrs?.kind ? { kind: attrs.kind, name: attrs.name, model: attrs.model || undefined, run: attrs.run || undefined } : { kind: "unknown", name: "Origin unknown" };
      const last = result.at(-1);
      if (last && JSON.stringify(last.author) === JSON.stringify(author)) last.text += node.text;
      else result.push({ author, text: node.text });
    }
    node.content?.forEach(walk);
    if (node.type !== "text" && result.length) result[result.length - 1].text += "\n";
  };
  if (doc) walk(doc);
  return result;
}

const key = new PluginKey("authorship");
export const Origin = Mark.create({
  name: "origin",
  priority: 1000,
  inclusive: false,
  keepOnSplit: false,
  addAttributes: () => ({ kind: { default: "unknown" }, name: { default: "Origin unknown" }, model: { default: null }, run: { default: null } }),
  parseHTML: () => [],
  renderHTML: ({ mark }) => ["span", { "data-origin": mark.attrs.kind, "data-origin-name": mark.attrs.name }, 0],
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      props: {
        handleTextInput(view, from, to, text) {
          if (selectedBlocks(view.state.selection)) return false;
          const mark = view.state.schema.marks.origin.create(context?.author ?? { kind: "human", name: "You" });
          if (from !== to) {
            view.dispatch(view.state.tr.insertText(text, from, to).removeMark(from, from + text.length, view.state.schema.marks.origin).addMark(from, from + text.length, mark));
            return true;
          }
          const marks = (view.state.storedMarks ?? view.state.selection.$from.marks()).filter((m) => m.type.name !== "origin");
          view.dispatch(view.state.tr.setStoredMarks([...marks, mark]));
          return false;
        },
      },
      appendTransaction(transactions, _old, state) {
        if (!transactions.some((t) => t.docChanged) || transactions.some((t) => t.getMeta(key) || isHistoryTransaction(t) || t.getMeta("preserveOrigin") || t.getMeta("uiEvent") === "drop")) return null;
        const tr = state.tr;
        const author = context?.author ?? { kind: "human", name: "You" };
        if (context?.preserveOrigin) return null;
        for (let ti = 0; ti < transactions.length; ti++) {
          const source = transactions[ti];
          for (let si = 0; si < source.mapping.maps.length; si++) {
            source.mapping.maps[si].forEach((_a, _b, start, end) => {
              const map = (pos: number, assoc: number) => {
                let at = source.mapping.slice(si + 1).map(pos, assoc);
                for (let j = ti + 1; j < transactions.length; j++) at = transactions[j].mapping.map(at, assoc);
                return Math.max(0, Math.min(state.doc.content.size, at));
              };
              const from = map(start, 1), to = map(end, -1);
              if (from >= to) return;
              state.doc.nodesBetween(from, to, (node, pos) => {
                if (!node.isText) return;
                const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
                if (!source.getMeta("composition") && node.marks.some((m) => m.type.name === "origin")) return;
                tr.removeMark(a, b, state.schema.marks.origin);
                tr.addMark(a, b, state.schema.marks.origin.create(author));
              });
            });
          }
        }
        return tr.steps.length ? tr.setMeta(key, true) : null;
      },
    })];
  },
});
