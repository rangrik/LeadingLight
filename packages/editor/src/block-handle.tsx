import type { Editor } from "@tiptap/core";
import { GripVertical, Plus } from "lucide-react";
import { type DragEvent, type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { BlockMenu, type MenuAt } from "./block-menu";
import { BlockSelection, blockPosAt, ITEMS, itemPos, selectedBlocks, topLevelOf } from "./block-selection";
import { keepFocus } from "./ui";

type Target = { pos: number; top: number; left: number };

const SIZE = 24;
const HIDE_DELAY = 150;

// The first line of text inside any block: a list's first item, a quote's paragraph,
// a toggle's title, a code block's pre, a table's first cell.
const TEXT = "p, h1, h2, h3, h4, summary, pre";

// Vertical centre of a block's first line. A divider uses its rule, a one-row card (file, audio,
// an empty media block) its row, and pictures their top edge.
function firstLineCenter(el: HTMLElement): number {
  const line = el.matches(TEXT) ? el : el.querySelector<HTMLElement>(TEXT);
  const row = el.matches("hr") ? el : !line && el.querySelector<HTMLElement>(".ll-row");
  if (row) {
    const r = row.getBoundingClientRect();
    return r.top + r.height / 2;
  }
  const target = line ?? el;
  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  const top = rect.top + (parseFloat(style.paddingTop) || 0);
  return line ? top + (parseFloat(style.lineHeight) || rect.height) / 2 : top + SIZE / 2;
}

// The innermost list item at the pointer's height in a top-level block (for a top-level list, the
// nearest one in its own padding), so each item gets its own handle. Not inside columns, where
// height alone can't tell the columns apart (docs/DEFERRED.md).
function itemAt(el: HTMLElement, clientY: number): HTMLElement | null {
  const list = el.matches("ul, ol") && el.firstElementChild && el.lastElementChild;
  const top = list ? (el.firstElementChild as Element).getBoundingClientRect().top : -Infinity;
  const bottom = list ? (el.lastElementChild as Element).getBoundingClientRect().bottom - 1 : Infinity;
  const y = Math.min(Math.max(clientY, top), bottom);
  let hit: HTMLElement | null = null;
  for (const li of el.querySelectorAll<HTMLElement>("li")) {
    if (li.closest(".ll-column")) continue;
    const r = li.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) hit = li; // Later matches sit deeper.
  }
  return hit;
}

function findBlock(editor: Editor, root: HTMLElement, clientY: number): Target | null {
  const { view } = editor;
  const box = root.getBoundingClientRect();
  const gutter = parseFloat(getComputedStyle(root).paddingLeft) || 0;
  for (const el of Array.from(view.dom.children) as HTMLElement[]) {
    const rect = el.getBoundingClientRect();
    // A block owns its bottom margin too, so a 1px divider is easy to hover.
    if (clientY > rect.bottom + (parseFloat(getComputedStyle(el).marginBottom) || 0)) continue;
    if (clientY < rect.top - 16) return null;
    const li = itemAt(el, clientY);
    const pos = li ? itemPos(view, li) : topLevelOf(view.state.doc, view.posAtDOM(el, 0));
    if (pos === null || !view.state.doc.nodeAt(pos)) return null;
    // The handle sits in the page's gutter; only a nested item's handle steps in, beside its list.
    const column = (li?.parentElement?.closest("li") ? li.parentElement : el).getBoundingClientRect().left;
    return { pos, top: firstLineCenter(li ?? el) - box.top - SIZE / 2, left: column - box.left - gutter };
  }
  return null;
}

function selectBlock(editor: Editor, pos: number, extend: boolean) {
  const { state, view } = editor;
  const { doc, selection } = state;
  let anchor = !extend ? pos : selection instanceof BlockSelection ? selection.anchorBlock : blockPosAt(doc, selection.from);
  let head = pos;
  // Blocks in different lists, or an item and a top-level block, widen to whole top-level blocks.
  if (!doc.resolve(anchor).sameParent(doc.resolve(head))) {
    anchor = topLevelOf(doc, anchor);
    head = topLevelOf(doc, head);
  }
  view.dispatch(state.tr.setSelection(BlockSelection.create(doc, anchor, head)));
  view.focus();
}

// Dragging or opening the menu of a selected block acts on the whole selection.
function inSelection(editor: Editor, pos: number): boolean {
  const range = selectedBlocks(editor.state.selection);
  return Boolean(range && pos >= range.from && pos < range.to);
}

function startDrag(editor: Editor, pos: number, e: DragEvent) {
  const { view } = editor;
  if (!inSelection(editor, pos)) selectBlock(editor, pos, false);
  const selection = view.state.selection;
  const dom = view.nodeDOM(pos);
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", selection.content().content.textBetween(0, selection.content().content.size, "\n"));
  if (dom instanceof HTMLElement) e.dataTransfer.setDragImage(dom, 0, 0);
  // ProseMirror's own drop handler moves the content when it finds this.
  view.dragging = { slice: selection.content(), move: true };
}

function endDrag(editor: Editor) {
  window.setTimeout(() => {
    editor.view.dragging = null;
  }, 50);
}

function addBlockAfter(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const after = pos + node.nodeSize;
  // After a list item the natural next block is another item of its kind.
  if (ITEMS.has(node.type.name)) {
    editor.chain().focus().insertContentAt(after, { type: node.type.name, content: [{ type: "paragraph" }] }).setTextSelection(after + 2).run();
    return;
  }
  editor
    .chain()
    .focus()
    .insertContentAt(after, { type: "paragraph" })
    .setTextSelection(after + 1)
    .insertContent("/")
    .run();
}

export function BlockHandle({ editor }: { editor: Editor }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const fromHandle = menu?.side === "left";

  // While the menu is open the handle stays beside its block.
  useEffect(() => {
    const root = editor.view.dom.closest<HTMLElement>(".ll-editor-root");
    if (!root || menu) return;
    let raf = 0;
    let hide = 0;
    const onMove = (e: MouseEvent) => {
      // A margin note or the contents list isn't a block's place.
      if ((e.target as HTMLElement).closest(".ll-note, .ll-toc")) return onLeave();
      window.clearTimeout(hide);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTarget(findBlock(editor, root, e.clientY)));
    };
    // A short grace so the pointer can travel from the text to the handle.
    const onLeave = () => {
      hide = window.setTimeout(() => setTarget(null), HIDE_DELAY);
    };
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hide);
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, menu]);

  useEffect(() => {
    const root = editor.view.dom.closest<HTMLElement>(".ll-editor-root");
    if (!root) return;
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) setTarget(null);
    };
    // Right-clicking selected blocks opens their menu at the pointer, instead of the browser's.
    const onContextMenu = (e: MouseEvent) => {
      if (!editor.isEditable || !(e.target as Element).closest(".ll-selected")) return;
      e.preventDefault();
      setMenu({ rect: new DOMRect(e.clientX, e.clientY), side: "bottom" });
    };
    // Meta+/ opens it beside the selected blocks, or the block holding the cursor.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || !(e.metaKey || e.ctrlKey) || !editor.isEditable) return;
      e.preventDefault();
      const { doc, selection } = editor.state;
      if (!selectedBlocks(selection)) selectBlock(editor, blockPosAt(doc, selection.from), false);
      const first = editor.view.nodeDOM(selectedBlocks(editor.state.selection)?.from ?? 0);
      const t = first instanceof HTMLElement && findBlock(editor, root, firstLineCenter(first));
      if (!t) return;
      const box = root.getBoundingClientRect();
      setTarget(t);
      setMenu({ rect: new DOMRect(box.left + t.left + SIZE, box.top + t.top, SIZE, SIZE), side: "left" });
    };
    editor.on("transaction", onTransaction);
    root.addEventListener("contextmenu", onContextMenu);
    editor.view.dom.addEventListener("keydown", onKeyDown);
    return () => {
      editor.off("transaction", onTransaction);
      root.removeEventListener("contextmenu", onContextMenu);
      editor.view.dom.removeEventListener("keydown", onKeyDown);
    };
  }, [editor]);

  const openMenu = (pos: number, e: ReactMouseEvent<HTMLElement>) => {
    if (!inSelection(editor, pos)) selectBlock(editor, pos, false);
    setMenu({ rect: e.currentTarget.getBoundingClientRect(), side: "left" });
  };

  // COSS ghost buttons; icons stay 16px (icon-xs would shrink them to 14px).
  return (
    <>
      {target && editor.isEditable && (
        <div className="ll-handle absolute flex items-center" contentEditable={false} style={{ top: target.top, left: target.left }}>
          <Button
            aria-label="Add block"
            className="text-muted-foreground"
            onClick={() => addBlockAfter(editor, target.pos)}
            onMouseDown={keepFocus}
            size="icon-xs"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
          <Button
            aria-expanded={fromHandle}
            aria-haspopup="menu"
            aria-label="Drag to move"
            className="cursor-grab text-muted-foreground active:cursor-grabbing"
            data-pressed={fromHandle || undefined}
            draggable
            // Shift-click only extends the selection; a plain click opens the menu too.
            onClick={(e: ReactMouseEvent<HTMLElement>) => (e.shiftKey ? selectBlock(editor, target.pos, true) : openMenu(target.pos, e))}
            onContextMenu={(e: ReactMouseEvent<HTMLElement>) => {
              e.preventDefault();
              openMenu(target.pos, e);
            }}
            onDragEnd={() => endDrag(editor)}
            onDragStart={(e: DragEvent) => startDrag(editor, target.pos, e)}
            // No keepFocus here: a cancelled mousedown stops the browser from starting a drag.
            size="icon-xs"
            variant="ghost"
          >
            <GripVertical className="size-4" />
          </Button>
        </div>
      )}
      <BlockMenu at={menu} editor={editor} onClose={() => setMenu(null)} />
    </>
  );
}
