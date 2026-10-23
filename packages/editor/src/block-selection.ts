import { Extension } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type SelectionBookmark,
  TextSelection,
} from "@tiptap/pm/state";
import type { Mappable } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { linkMenuOpen } from "./page-links";
import { slashMenuOpen } from "./slash-menu";

// The nodes that count as blocks: top-level nodes, and list items (each to-do or bullet).
export const ITEMS = new Set(["listItem", "taskItem"]);
const holdsBlocks = (node: PMNode) => node.type.name === "doc" || /List$/.test(node.type.name);

// Whole sibling blocks (top-level blocks, or items of one list), from the anchor block to the
// head block. Invisible to the browser; a decoration draws it.
export class BlockSelection extends Selection {
  static create(doc: PMNode, anchorBlock: number, headBlock: number): BlockSelection {
    const sizeAt = (pos: number) => doc.nodeAt(pos)?.nodeSize ?? 0;
    if (anchorBlock <= headBlock) {
      return new BlockSelection(doc.resolve(anchorBlock), doc.resolve(headBlock + sizeAt(headBlock)));
    }
    return new BlockSelection(doc.resolve(anchorBlock + sizeAt(anchorBlock)), doc.resolve(headBlock));
  }

  static between($anchor: ResolvedPos, $head: ResolvedPos): Selection {
    if ($anchor.pos !== $head.pos && $anchor.sameParent($head) && holdsBlocks($anchor.parent)) {
      return new BlockSelection($anchor, $head);
    }
    return TextSelection.near($anchor);
  }

  // Positions before the anchor and head blocks, whichever way the selection runs.
  get anchorBlock(): number {
    return this.anchor <= this.head ? this.anchor : this.anchor - (this.$anchor.nodeBefore?.nodeSize ?? 0);
  }
  get headBlock(): number {
    return this.anchor <= this.head ? this.head - (this.$head.nodeBefore?.nodeSize ?? 0) : this.head;
  }

  // Content inserted right at either edge (the empty line kept at the page end) stays outside.
  map(doc: PMNode, mapping: Mappable): Selection {
    const out = this.anchor <= this.head ? 1 : -1;
    return BlockSelection.between(doc.resolve(mapping.map(this.anchor, out)), doc.resolve(mapping.map(this.head, -out)));
  }

  eq(other: Selection): boolean {
    return other instanceof BlockSelection && other.anchor === this.anchor && other.head === this.head;
  }

  toJSON(): { type: string; anchor: number; head: number } {
    return { type: "block", anchor: this.anchor, head: this.head };
  }

  static fromJSON(doc: PMNode, json: { anchor: number; head: number }): Selection {
    return BlockSelection.between(doc.resolve(json.anchor), doc.resolve(json.head));
  }

  getBookmark(): SelectionBookmark {
    return new BlockBookmark(this.anchor, this.head);
  }
}
BlockSelection.prototype.visible = false;
Selection.jsonID("block", BlockSelection);

class BlockBookmark implements SelectionBookmark {
  constructor(
    readonly anchor: number,
    readonly head: number,
  ) {}
  map(mapping: Mappable): SelectionBookmark {
    return new BlockBookmark(mapping.map(this.anchor), mapping.map(this.head));
  }
  resolve(doc: PMNode): Selection {
    const clamp = (p: number) => Math.min(p, doc.content.size);
    return BlockSelection.between(doc.resolve(clamp(this.anchor)), doc.resolve(clamp(this.head)));
  }
}

// The position before the block that holds pos: its innermost list item, else its top-level block.
export function blockPosAt(doc: PMNode, pos: number): number {
  const $p = doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) if (ITEMS.has($p.node(d).type.name)) return $p.before(d);
  if ($p.depth > 0) return $p.before(1);
  return $p.nodeAfter ? pos : pos - ($p.nodeBefore?.nodeSize ?? 0);
}

// Whole-block range of the current selection, or null for an ordinary text selection.
export function selectedBlocks(selection: Selection): { from: number; to: number } | null {
  if (selection instanceof BlockSelection) return { from: selection.from, to: selection.to };
  if (selection instanceof NodeSelection && selection.$from.depth === 0) {
    return { from: selection.from, to: selection.to };
  }
  return null;
}

// The position of a list item's node, from its <li>.
export function itemPos(view: EditorView, li: HTMLElement): number | null {
  const p = view.posAtDOM(li, 0);
  for (const q of [p, p - 1]) if (q >= 0 && view.nodeDOM(q) === li) return q;
  return null;
}

// The top-level block around a block position (the position itself when it is top-level).
export const topLevelOf = (doc: PMNode, pos: number) => {
  const $p = doc.resolve(pos);
  return $p.depth ? $p.before(1) : pos;
};

export function deleteBlocks(view: EditorView): boolean {
  const { selection, tr, schema } = view.state;
  if (!selectedBlocks(selection)) return false;
  // deleteRange also removes a list whose items are all gone.
  tr.deleteRange(selection.from, selection.to);
  if (tr.doc.childCount === 0) tr.insert(0, schema.nodes.paragraph.create());
  tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(selection.from)), 1));
  view.dispatch(tr);
  return true;
}

// Copies the selected blocks, or the block holding the cursor, in right after them.
export function duplicateBlocks(view: EditorView): boolean {
  const { doc, selection, tr } = view.state;
  const pos = blockPosAt(doc, selection.from);
  const range = selectedBlocks(selection) ?? { from: pos, to: pos + (doc.nodeAt(pos)?.nodeSize ?? 0) };
  const copy = doc.slice(range.from, range.to).content;
  tr.insert(range.to, copy);
  // Selected blocks hand the selection to the copy, so ⌘D again copies the copy.
  if (selectedBlocks(selection)) tr.setSelection(BlockSelection.between(tr.doc.resolve(range.to), tr.doc.resolve(range.to + copy.size)));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function anchorAndHead(selection: Selection, doc: PMNode): { anchor: number; head: number } {
  if (selection instanceof BlockSelection) return { anchor: selection.anchorBlock, head: selection.headBlock };
  const pos = blockPosAt(doc, selection.from);
  return { anchor: pos, head: pos };
}

const key = new PluginKey("blockSelection");

// Meta+A selects every block, shown with the block tint. In code it first selects just the code.
// Above TipTap's own Meta+A, which selects all text.
export const SelectAll = Extension.create({
  name: "selectAll",
  priority: 200,
  addKeyboardShortcuts() {
    return {
      "Mod-a": () => {
        const { state, view } = this.editor;
        const { doc, selection } = state;
        const { $from, $to } = selection;
        const inCode = $from.parent.type.name === "codeBlock" && $from.sameParent($to);
        if (inCode && (selection.from !== $from.start() || selection.to !== $from.end())) {
          view.dispatch(state.tr.setSelection(TextSelection.create(doc, $from.start(), $from.end())));
          return true;
        }
        const last = doc.content.size - (doc.lastChild?.nodeSize ?? 0);
        view.dispatch(state.tr.setSelection(BlockSelection.create(doc, 0, last)));
        return true;
      },
    };
  },
});

export const BlockSelectionExtension = Extension.create({
  name: "blockSelection",

  addKeyboardShortcuts() {
    const select = (anchor: number, head: number) => {
      const { tr, doc } = this.editor.state;
      this.editor.view.dispatch(tr.setSelection(BlockSelection.create(doc, anchor, head)));
      return true;
    };
    // Put a text cursor just before (-1) or after (1) the selected blocks.
    const leave = (dir: -1 | 1) => {
      const { selection, doc, tr } = this.editor.state;
      const range = selectedBlocks(selection);
      if (!range) return false;
      const $pos = doc.resolve(dir < 0 ? range.from : range.to);
      this.editor.view.dispatch(tr.setSelection(Selection.near($pos, dir)));
      return true;
    };
    // Back to text at the end of the head block's own first line, not inside its children.
    const enter = () => {
      const { selection, doc, tr } = this.editor.state;
      const range = selectedBlocks(selection);
      if (!range) return false;
      const head = selection instanceof BlockSelection ? selection.headBlock : range.from;
      let end = -1;
      doc.nodeAt(head)?.descendants((node, pos) => {
        if (end < 0 && node.isTextblock) end = head + 1 + pos + 1 + node.content.size;
        return end < 0;
      });
      const textEnd = end > 0 ? TextSelection.create(doc, end) : Selection.near(doc.resolve(range.to), -1);
      this.editor.view.dispatch(tr.setSelection(textEnd));
      return true;
    };
    const remove = () => deleteBlocks(this.editor.view);
    return {
      Escape: () => {
        const { selection, doc } = this.editor.state;
        // Escape with the slash menu open only closes the menu.
        if (slashMenuOpen(this.editor.state) || linkMenuOpen(this.editor.state)) return false;
        if (selectedBlocks(selection)) return enter();
        const pos = blockPosAt(doc, selection.from);
        return select(pos, pos);
      },
      Enter: enter,
      // Past the first or last item of a list, the selection first widens to the whole list.
      "Shift-ArrowDown": () => {
        const { selection, doc } = this.editor.state;
        if (!selectedBlocks(selection)) return false;
        const { anchor, head } = anchorAndHead(selection, doc);
        const $head = doc.resolve(head);
        const next = head + (doc.nodeAt(head)?.nodeSize ?? 0);
        if ($head.depth && next >= $head.end()) return select(topLevelOf(doc, anchor), topLevelOf(doc, head));
        return next < $head.end() ? select(anchor, next) : true;
      },
      "Shift-ArrowUp": () => {
        const { selection, doc } = this.editor.state;
        if (!selectedBlocks(selection)) return false;
        const { anchor, head } = anchorAndHead(selection, doc);
        const $head = doc.resolve(head);
        if ($head.depth && !$head.nodeBefore) return select(topLevelOf(doc, anchor), topLevelOf(doc, head));
        const before = $head.nodeBefore;
        return before ? select(anchor, head - before.nodeSize) : true;
      },
      ArrowDown: () => leave(1),
      ArrowUp: () => leave(-1),
      Backspace: remove,
      Delete: remove,
      "Mod-d": () => duplicateBlocks(this.editor.view),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          // Typing over selected blocks does nothing, rather than replacing them.
          handleTextInput: (view) => selectedBlocks(view.state.selection) !== null,
          // The same for text from the emoji picker or dictation, which skips the key handlers.
          handleDOMEvents: {
            beforeinput: (view, event) => {
              if (!selectedBlocks(view.state.selection) || !/^insert(Text|ReplacementText)$/.test(event.inputType)) return false;
              event.preventDefault();
              return true;
            },
          },
          decorations: (state) => {
            const range = selectedBlocks(state.selection);
            if (!range) return null;
            const $from = state.doc.resolve(range.from);
            const start = $from.start();
            const decos: Decoration[] = [];
            $from.parent.forEach((node, offset) => {
              const pos = start + offset;
              if (pos >= range.from && pos + node.nodeSize <= range.to) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "ll-selected" }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
