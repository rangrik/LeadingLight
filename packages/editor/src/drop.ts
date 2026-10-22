import { Extension } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { BlockSelection, selectedBlocks } from "./block-selection";

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

    return [
      new Plugin({
        key: new PluginKey("blockDrop"),
        // The handle that starts a block drag is outside the editor, so its dragend never reaches it.
        view: () => {
          document.addEventListener("dragend", hide);
          return {
            destroy: () => {
              hide();
              document.removeEventListener("dragend", hide);
            },
          };
        },
        props: {
          handleDOMEvents: {
            dragover: (view, event) => {
              if (!view.editable) return false;
              if (isBlockDrag(view)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const b = blockBoundary(view, event.clientY);
                show(view, b && { el: b.el, edge: b.edge });
                return true;
              }
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
            drop: (view, event) => {
              hide();
              if (!view.editable || !isBlockDrag(view)) return false;
              event.preventDefault();
              const range = selectedBlocks(view.state.selection);
              const target = blockBoundary(view, event.clientY);
              view.dragging = null;
              if (!range || !target || (target.pos >= range.from && target.pos <= range.to)) return true;
              const { state } = view;
              const slice = state.doc.slice(range.from, range.to);
              const tr = state.tr.delete(range.from, range.to);
              const at = tr.mapping.map(target.pos);
              tr.insert(at, slice.content);
              tr.setSelection(new BlockSelection(tr.doc.resolve(at), tr.doc.resolve(at + slice.content.size)));
              view.dispatch(tr.scrollIntoView());
              view.focus();
              return true;
            },
          },
        },
      }),
    ];
  },
});
