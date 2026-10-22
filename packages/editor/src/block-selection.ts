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
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { slashMenuOpen } from "./slash-menu";

// Whole top-level blocks, from the anchor block to the head block.
// Invisible to the browser; a decoration draws it.
export class BlockSelection extends Selection {
  static create(doc: PMNode, anchorBlock: number, headBlock: number): BlockSelection {
    const sizeAt = (pos: number) => doc.nodeAt(pos)?.nodeSize ?? 0;
    if (anchorBlock <= headBlock) {
      return new BlockSelection(doc.resolve(anchorBlock), doc.resolve(headBlock + sizeAt(headBlock)));
    }
    return new BlockSelection(doc.resolve(anchorBlock + sizeAt(anchorBlock)), doc.resolve(headBlock));
  }

  static between($anchor: ResolvedPos, $head: ResolvedPos): Selection {
    if ($anchor.depth === 0 && $head.depth === 0 && $anchor.pos !== $head.pos) {
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

  map(doc: PMNode, mapping: Mappable): Selection {
    return BlockSelection.between(doc.resolve(mapping.map(this.anchor)), doc.resolve(mapping.map(this.head)));
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

// The position before the top-level block that contains pos.
export function blockPosAt(doc: PMNode, pos: number): number {
  const $p = doc.resolve(pos);
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

function anchorAndHead(selection: Selection, doc: PMNode): { anchor: number; head: number } {
  if (selection instanceof BlockSelection) return { anchor: selection.anchorBlock, head: selection.headBlock };
  const pos = blockPosAt(doc, selection.from);
  return { anchor: pos, head: pos };
}

const key = new PluginKey("blockSelection");

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
    const enter = () => {
      const { selection, doc, tr } = this.editor.state;
      const range = selectedBlocks(selection);
      if (!range) return false;
      this.editor.view.dispatch(tr.setSelection(Selection.near(doc.resolve(range.to), -1)));
      return true;
    };
    const remove = () => {
      const { selection, tr } = this.editor.state;
      if (!selectedBlocks(selection)) return false;
      tr.deleteSelection();
      if (tr.doc.childCount === 0) tr.insert(0, this.editor.schema.nodes.paragraph.create());
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(selection.from, tr.doc.content.size)), 1));
      this.editor.view.dispatch(tr);
      return true;
    };
    return {
      Escape: () => {
        const { selection, doc } = this.editor.state;
        // Escape with the slash menu open only closes the menu.
        if (slashMenuOpen(this.editor.state)) return false;
        if (selectedBlocks(selection)) return enter();
        const pos = blockPosAt(doc, selection.from);
        return select(pos, pos);
      },
      Enter: enter,
      "Shift-ArrowDown": () => {
        const { selection, doc } = this.editor.state;
        if (!selectedBlocks(selection)) return false;
        const { anchor, head } = anchorAndHead(selection, doc);
        const next = head + (doc.nodeAt(head)?.nodeSize ?? 0);
        return next < doc.content.size ? select(anchor, next) : true;
      },
      "Shift-ArrowUp": () => {
        const { selection, doc } = this.editor.state;
        if (!selectedBlocks(selection)) return false;
        const { anchor, head } = anchorAndHead(selection, doc);
        const before = doc.resolve(head).nodeBefore;
        return before ? select(anchor, head - before.nodeSize) : true;
      },
      ArrowDown: () => leave(1),
      ArrowUp: () => leave(-1),
      Backspace: remove,
      Delete: remove,
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
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (offset >= range.from && offset + node.nodeSize <= range.to) {
                decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "ll-selected" }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
