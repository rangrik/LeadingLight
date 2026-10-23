import { Mark, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Where a sidenote or a quote is anchored, and links between pages (see DECISIONS.md, 6).
// Links are `ll:<page id>#<anchor id>`; a click on anything with data-href opens one.

export type Anchor = { id: string; from: number; to: number; attrs: Record<string, string> };

// Every range carrying a mark of this type, one per id, in reading order.
export function anchors(doc: PMNode, type: string): Anchor[] {
  const found = new Map<string, Anchor>();
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type.name !== type) continue;
      const end = pos + node.nodeSize;
      const a = found.get(mark.attrs.id);
      if (a) a.to = Math.max(a.to, end);
      else found.set(mark.attrs.id, { id: mark.attrs.id, from: pos, to: end, attrs: mark.attrs });
    }
  });
  return [...found.values()].sort((a, b) => a.from - b.from);
}

export const newId = () => crypto.randomUUID().slice(0, 8);

// A range without the spaces at its ends (a double-clicked word brings one), so the chip after
// the words can't drop to the next line at that space.
export function trimmed(doc: PMNode, from: number, to: number): [number, number] {
  const space = (a: number) => /^\s$/.test(doc.textBetween(a, a + 1));
  while (from < to && space(from)) from++;
  while (to > from && space(to - 1)) to--;
  return [from, to];
}

// A mark attribute kept in the DOM as data-<name>.
const dataAttr = (attr: string, name: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
  renderHTML: (attrs: Record<string, string | null>) => ({ [`data-${name}`]: attrs[attr] }),
});

// A chip sits outside the words' marks, so their underline stops at the words. It is inline text
// joined to the word before by U+2060: browsers may break before any inline box (an SVG, an
// inline-flex pill) even after a joiner, so the pill is a plain inline and the quote mark is text.
function chip(className: string, attrs: Record<string, string>, html: string) {
  const el = document.createElement("span");
  el.className = "ll-chip";
  el.contentEditable = "false";
  el.setAttribute("role", "button");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const pill = document.createElement("span");
  pill.className = className;
  pill.innerHTML = html;
  el.append("\u2060", pill);
  return el;
}

// Numbers after noted sentences, and for quoted ones an underline and a quote mark. A chip sticks
// to the text before it, so typing right after an anchor goes after the chip. Quoted words show
// as quoted only while the essay still holds their quote; `live` is null until that is known.
type Chips = { live: Set<string> | null; set: DecorationSet };
const chips = new PluginKey<Chips>("anchorChips");

// Tells a page which of its quotes its essay still holds.
export const setLiveQuotes = (tr: Transaction, ids: string[]) => tr.setMeta(chips, ids);

function chipPlugin() {
  const build = (doc: PMNode, live: Set<string> | null) =>
    DecorationSet.create(doc, [
      ...anchors(doc, "note").map((a, i) =>
        Decoration.widget(a.to, () => chip("ll-note-chip", { "data-note-chip": a.id, "aria-label": `Sidenote ${i + 1}` }, String(i + 1)), {
          side: -1,
          marks: [],
          key: `note-${a.id}-${i + 1}`,
        }),
      ),
      ...anchors(doc, "cited")
        .filter((a) => !live || live.has(a.id))
        .flatMap((a) => [
          Decoration.inline(a.from, a.to, { class: "ll-cited" }),
          Decoration.widget(
            a.to,
            () => chip("ll-cited-chip", { "data-href": `ll:${a.attrs.essay}#${a.id}`, "aria-label": "Show in essay" }, "\u201d"),
            { side: -1, marks: [], key: `cited-${a.id}` },
          ),
        ]),
    ]);
  return new Plugin<Chips>({
    key: chips,
    state: {
      init: (_, state) => ({ live: null, set: build(state.doc, null) }),
      apply: (tr, prev) => {
        const ids = tr.getMeta(chips) as string[] | undefined;
        const live = ids ? new Set(ids) : prev.live;
        return tr.docChanged || ids ? { live, set: build(tr.doc, live) } : prev;
      },
    },
    props: { decorations: (state) => chips.getState(state)?.set },
  });
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    note: { addSidenote: () => ReturnType };
  }
}

// The words a sidenote was written against. Notes may overlap, so a note never replaces another.
// With no selection, a new note takes the whole line holding the cursor.
// onAdd returns false when the page can't keep notes; `existing` asks for the note those exact
// words already have, rather than a second one.
export const Note = Mark.create<{ onAdd: ((id: string, quote: string, existing?: boolean) => boolean) | null }>({
  name: "note",
  inclusive: false,
  excludes: "",
  addOptions: () => ({ onAdd: null }),
  addAttributes: () => ({ id: dataAttr("id", "note") }),
  parseHTML: () => [{ tag: "span[data-note]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", { ...HTMLAttributes, class: "ll-noted" }, 0],
  addProseMirrorPlugins: () => [chipPlugin()],
  addCommands() {
    return {
      addSidenote:
        () =>
        ({ state, tr, dispatch }) => {
          const { selection } = state;
          const onAdd = this.options.onAdd;
          if (!onAdd || !(selection instanceof TextSelection) || !selection.$from.parent.type.allowsMarkType(this.type)) return false;
          const { $from } = selection;
          const [from, to] = trimmed(state.doc, ...(selection.empty ? [$from.start(), $from.end()] : [selection.from, selection.to]) as [number, number]);
          const quote = state.doc.textBetween(from, to, " ").trim();
          if (!quote) return false;
          if (dispatch) {
            const same = anchors(state.doc, "note").find((a) => a.from === from && a.to === to);
            if (same) return onAdd(same.id, quote, true);
            const id = newId();
            if (!onAdd(id, quote)) return false;
            // The selection is done with: the note takes the cursor, and no toolbar lingers.
            tr.addMark(from, to, this.type.create({ id })).setSelection(TextSelection.create(tr.doc, to));
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-m": () => this.editor.commands.addSidenote() };
  },
});

// Words quoted into an essay; `essay` is the essay's page id. The chip plugin draws them as quoted.
export const Cited = Mark.create({
  name: "cited",
  inclusive: false,
  excludes: "",
  addAttributes: () => ({ id: dataAttr("id", "cited"), essay: dataAttr("essay", "essay") }),
  parseHTML: () => [{ tag: "span[data-cited]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
});

// The ids of the quotes a document holds.
export function citesIn(doc: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] } | null | undefined): string[] {
  if (!doc) return [];
  const own = doc.type === "cite" && typeof doc.attrs?.id === "string" ? [doc.attrs.id] : [];
  return [...own, ...(doc.content ?? []).flatMap((c) => citesIn(c as typeof doc))];
}

const hidden = (name: string) => ({ default: null, rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) });

// One raw thought in a Thoughts page: the words it was written against, then the thought.
export const Thought = Node.create({
  name: "thought",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({
    id: hidden("id"),
    source: hidden("source"),
    quote: { default: "", rendered: false, parseHTML: (el) => el.querySelector(".ll-thought-quote")?.textContent ?? "" },
  }),
  parseHTML: () => [{ tag: 'section[data-type="thought"]', contentElement: ".ll-thought-body" }],
  renderHTML: ({ node }) => [
    "section",
    { "data-type": "thought", "data-id": node.attrs.id, "data-source": node.attrs.source, class: "ll-thought" },
    ["div", { class: "ll-thought-quote", contenteditable: "false", "data-href": `ll:${node.attrs.source}#${node.attrs.id}` }, node.attrs.quote],
    ["div", { class: "ll-thought-body" }, 0],
  ],
});

// The reference that ends a quote in an essay. A click opens the quoted words in their page.
export const Cite = Node.create({
  name: "cite",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ id: hidden("cite"), href: hidden("href"), label: { default: "", rendered: false, parseHTML: (el) => el.textContent ?? "" } }),
  parseHTML: () => [{ tag: "a[data-cite]" }],
  renderHTML: ({ node }) => ["a", { class: "ll-cite", "data-cite": node.attrs.id, "data-href": node.attrs.href, contenteditable: "false" }, node.attrs.label],
  renderText: ({ node }) => `— ${node.attrs.label}`,
});
