import { Extension } from "@tiptap/core";
import { Fragment, type Node as PMNode, type NodeType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { BlockSelection, itemPos, selectedBlocks } from "./block-selection";

// Where a file block goes: in place of an empty paragraph, else before or after the block it
// landed on (by which half was hit), never inside its text.
export function placeFor(view: EditorView, pos: number, type: NodeType, clientY?: number): { from: number; to: number } {
  const $pos = view.state.doc.resolve(pos);
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    const start = $pos.before(d);
    const container = $pos.node(d - 1);
    const index = $pos.index(d - 1);
    if (node.type.name === "paragraph" && node.content.size === 0 && container.canReplaceWith(index, index + 1, type)) {
      return { from: start, to: start + node.nodeSize };
    }
    const rect = (view.nodeDOM(start) as HTMLElement | null)?.getBoundingClientRect();
    const after = clientY === undefined || !rect || clientY > rect.top + rect.height / 2;
    for (const below of after ? [true, false] : [false, true]) {
      const i = below ? index + 1 : index;
      if (container.canReplaceWith(i, i, type)) {
        const at = below ? start + node.nodeSize : start;
        return { from: at, to: at };
      }
    }
  }
  return { from: pos, to: pos };
}

// The top-level boundary nearest the pointer's height: before the first block whose middle is
// below it, else the end of the page.
function blockBoundary(view: EditorView, clientY: number): { pos: number; el: HTMLElement; edge: "top" | "bottom" } | null {
  const blocks = Array.from(view.dom.children) as HTMLElement[];
  for (const el of blocks) {
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      const p = view.posAtDOM(el, 0);
      const $p = view.state.doc.resolve(p);
      return { pos: $p.depth === 0 ? p : $p.before(1), el, edge: "top" };
    }
  }
  const last = blocks[blocks.length - 1];
  return last ? { pos: view.state.doc.content.size, el: last, edge: "bottom" } : null;
}

type Boundary = { pos: number; el: HTMLElement; edge: "top" | "bottom" };

// Whether dropping the range at pos moves it: not into or beside itself, and for list items not at
// their own list's outer edge, which would only split the list.
function moves(doc: PMNode, range: { from: number; to: number }, pos: number): boolean {
  if (pos >= range.from && pos <= range.to) return false;
  const $from = doc.resolve(range.from);
  const $to = doc.resolve(range.to);
  if ($from.depth && $from.index() === 0 && pos === $from.before()) return false;
  return !($to.depth && $to.index() === $to.parent.childCount && pos === $to.after());
}

// The boundary next to the innermost item at the pointer's height in a list of the given kind
// (bullet and numbered items share a node type, so the list decides).
function itemBoundary(view: EditorView, list: NodeType, clientY: number): Boundary | null {
  let hit: { li: HTMLElement; pos: number } | null = null;
  for (const li of view.dom.querySelectorAll<HTMLElement>("li")) {
    const r = li.getBoundingClientRect();
    if (clientY < r.top || clientY > r.bottom) continue;
    const pos = itemPos(view, li);
    if (pos !== null && view.state.doc.resolve(pos).parent.type === list) hit = { li, pos };
  }
  if (!hit) return null;
  const r = hit.li.getBoundingClientRect();
  const before = clientY < r.top + r.height / 2;
  const size = view.state.doc.nodeAt(hit.pos)?.nodeSize ?? 0;
  return { pos: before ? hit.pos : hit.pos + size, el: hit.li, edge: before ? "top" : "bottom" };
}

// Where dragged blocks land: list items between items of their kind, else (and for top-level
// blocks always) between top-level blocks.
function dropTarget(view: EditorView, range: { from: number; to: number }, clientY: number): Boundary | null {
  const $from = view.state.doc.resolve(range.from);
  return ($from.depth > 0 && itemBoundary(view, $from.parent.type, clientY)) || blockBoundary(view, clientY);
}

// Where a boundary between blocks is, for the drop line.
function edgeOf(view: EditorView, from: number, to: number): { el: HTMLElement; edge: "top" | "bottom" | "middle" } | null {
  const at = view.nodeDOM(from);
  if (from !== to && at instanceof HTMLElement) return { el: at, edge: "middle" };
  if (at instanceof HTMLElement) return { el: at, edge: "top" };
  const $pos = view.state.doc.resolve(from);
  const before = $pos.nodeBefore ? view.nodeDOM(from - $pos.nodeBefore.nodeSize) : null;
  return before instanceof HTMLElement ? { el: before, edge: "bottom" } : null;
}

const isBlockDrag = (view: EditorView) => Boolean(view.dragging) && selectedBlocks(view.state.selection) !== null;
const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

// Block drags (from the handle, or an image's own drag) drop by height alone, shown by one line;
// file drags show the same line where placeFor will put them. Text drags keep ProseMirror's caret.
// Runs before ProseMirror's drop cursor, which listens on the same element and is stopped here.
export const BlockDrop = Extension.create({
  name: "blockDrop",
  priority: 1000,

  addProseMirrorPlugins() {
    let line: HTMLElement | null = null;

    const show = (view: EditorView, target: { el: HTMLElement; edge: "top" | "bottom" | "middle" } | null) => {
      const root = view.dom.closest<HTMLElement>(".ll-editor-root");
      if (!root || !target) return hide();
      line ??= Object.assign(document.createElement("div"), { className: "ll-drop-line" });
      if (line.parentElement !== root) root.append(line);
      const r = target.el.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      const y = target.edge === "top" ? r.top : target.edge === "bottom" ? r.bottom : r.top + r.height / 2;
      Object.assign(line.style, { top: `${y - box.top - 1}px`, left: `${r.left - box.left}px`, width: `${r.width}px` });
    };
    const hide = () => {
      line?.remove();
    };

    const overBlocks = (view: EditorView, event: DragEvent) => {
      const range = selectedBlocks(view.state.selection);
      if (!view.editable || !isBlockDrag(view) || !range) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      const b = dropTarget(view, range, event.clientY);
      const lands = b && moves(view.state.doc, range, b.pos);
      show(view, lands ? { el: b.el, edge: b.edge } : null);
      return true;
    };

    const dropBlocks = (view: EditorView, event: DragEvent) => {
      hide();
      const range = selectedBlocks(view.state.selection);
      if (!view.editable || !isBlockDrag(view) || !range) return false;
      event.preventDefault();
      const target = dropTarget(view, range, event.clientY);
      view.dragging = null;
      if (!target || !moves(view.state.doc, range, target.pos)) return true;
      const { state } = view;
      const $from = state.doc.resolve(range.from);
      const slice = state.doc.slice(range.from, range.to);
      // deleteRange also removes a list whose items all moved away.
      const tr = state.tr.deleteRange(range.from, range.to);
      const at = tr.mapping.map(target.pos);
      // Items dropped between top-level blocks become a list of their own, of the kind they left.
      const wrap = $from.depth > 0 && tr.doc.resolve(at).depth === 0;
      const content = wrap ? Fragment.from($from.parent.type.create($from.parent.attrs, slice.content)) : slice.content;
      tr.insert(at, content);
      tr.setSelection(new BlockSelection(tr.doc.resolve(at), tr.doc.resolve(at + content.size)));
      view.dispatch(tr.scrollIntoView().setMeta("preserveOrigin", true));
      view.focus();
      return true;
    };

    return [
      new Plugin({
        key: new PluginKey("blockDrop"),
        // The handle that starts a block drag is outside the editor, so its dragend never reaches it.
        // The editor's root around the blocks (the gutter, the space below the last block) takes
        // block drags too, so a block can go to the end of the page.
        view: (view) => {
          const aside = (e: DragEvent) => {
            const root = view.dom.closest(".ll-editor-root");
            return e.target instanceof Node && Boolean(root?.contains(e.target)) && !view.dom.contains(e.target);
          };
          const over = (e: DragEvent) => aside(e) && overBlocks(view, e);
          const drop = (e: DragEvent) => aside(e) && dropBlocks(view, e);
          document.addEventListener("dragend", hide);
          document.addEventListener("dragover", over);
          document.addEventListener("drop", drop);
          return {
            destroy: () => {
              hide();
              document.removeEventListener("dragend", hide);
              document.removeEventListener("dragover", over);
              document.removeEventListener("drop", drop);
            },
          };
        },
        props: {
          handleDOMEvents: {
            dragover: (view, event) => {
              if (!view.editable) return false;
              if (overBlocks(view, event)) return true;
              if (isFileDrag(event)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
                const image = view.state.schema.nodes.image;
                if (pos === undefined || !image) return true;
                const place = placeFor(view, pos, image, event.clientY);
                show(view, edgeOf(view, place.from, place.to));
                return true;
              }
              return false;
            },
            dragleave: (view, event) => {
              if (!view.dom.contains(event.relatedTarget as Node | null)) hide();
              return false;
            },
            drop: (view, event) => dropBlocks(view, event),
          },
        },
      }),
    ];
  },
});
