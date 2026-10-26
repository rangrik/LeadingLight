import type { Editor } from "@tiptap/core";
import { Table, TableKit } from "@tiptap/extension-table";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { addColumn, addRow, removeColumn, removeRow, selectedRect, TableMap } from "@tiptap/pm/tables";
import { GripHorizontal, GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@leadinglight/ui/components/tooltip";

const RowKeys = Table.extend({
  addKeyboardShortcuts() {
    const insert = () => {
      if (!this.editor.isActive("table")) return false;
      const rect = selectedRect(this.editor.state);
      return this.editor.chain().addRowAfter().command(({ tr }) => {
        const table = tr.doc.nodeAt(rect.tableStart - 1);
        if (!table) return false;
        const map = TableMap.get(table);
        const cell = rect.tableStart + map.map[rect.bottom * map.width + rect.left];
        tr.setSelection(TextSelection.near(tr.doc.resolve(cell + 1)));
        return true;
      }).run();
    };
    return {
      ...this.parent?.(),
      Enter: () => {
        const { $from } = this.editor.state.selection;
        const role = $from.depth > 1 && $from.node(-1).type.spec.tableRole;
        return (role === "cell" || role === "header_cell") && ["paragraph", "heading"].includes($from.parent.type.name) ? insert() : false;
      },
      "Mod-Enter": insert,
    };
  },
});

export const Tables = TableKit.extend({
  addExtensions() {
    return [...(this.parent?.() ?? []), RowKeys.configure({ resizable: true, HTMLAttributes: { class: "ll-table" } })];
  },
}).configure({ table: false });

type Handle = { axis: "row" | "column"; index: number; cell: number; left: number; top: number };

// COSS's basic menu composition; positions follow the editor's table rather than its text cursor.
export function TableToolbar({ editor }: { editor: Editor }) {
  const [handles, setHandles] = useState<Handle[]>([]);
  const active = useRef<HTMLTableElement | null>(null);
  const open = useRef(false);
  useEffect(() => {
    const root = editor.view.dom.closest<HTMLElement>(".ll-editor-root")!;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const table = active.current;
      if (!table?.isConnected || !editor.isEditable) return setHandles((current) => current.length ? [] : current);
      const first = table.rows[0]?.cells[0];
      if (!first) return setHandles([]);
      const $cell = editor.state.doc.resolve(editor.view.posAtDOM(first, 0));
      let depth = $cell.depth;
      while (depth > 0 && $cell.node(depth).type.name !== "table") depth--;
      if (!depth) return setHandles([]);
      const start = $cell.start(depth);
      const map = TableMap.get($cell.node(depth));
      const box = root.getBoundingClientRect();
      const tableBox = table.getBoundingClientRect();
      const wrapper = table.closest(".tableWrapper")!.getBoundingClientRect();
      const next: Handle[] = [];
      Array.from(table.rows).forEach((row, index) => {
        const rect = row.getBoundingClientRect();
        next.push({ axis: "row", index, cell: start + map.map[index * map.width], left: wrapper.left - box.left - 25, top: rect.top - box.top + rect.height / 2 - 10 });
      });
      for (let index = 0; index < map.width; index++) {
        const offset = map.map[index];
        const cell = editor.view.nodeDOM(start + offset) as HTMLElement | null;
        if (!cell) continue;
        const rect = cell.getBoundingClientRect();
        const span = map.findCell(offset);
        const left = rect.left + rect.width * (index - span.left + 0.5) / (span.right - span.left);
        if (left < wrapper.left || left > wrapper.right) continue;
        next.push({ axis: "column", index, cell: start + offset, left: left - box.left - 10, top: tableBox.top - box.top - 22 });
      }
      setHandles(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const select = () => {
      if (open.current) return schedule();
      const { node } = editor.view.domAtPos(editor.state.selection.from);
      const table = (node instanceof Element ? node : node.parentElement)?.closest("table") ?? null;
      if (!table && !active.current) return;
      active.current = table;
      schedule();
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged || transaction.selectionSet) select();
    };
    const hover = (event: PointerEvent) => {
      if (open.current) return;
      const table = (event.target as Element).closest<HTMLTableElement>("table");
      if (table && editor.view.dom.contains(table)) { active.current = table; schedule(); }
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root.addEventListener("pointerover", hover);
    root.addEventListener("scroll", schedule, true);
    editor.on("transaction", onTransaction);
    select();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener("pointerover", hover);
      root.removeEventListener("scroll", schedule, true);
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  const target = (handle: Handle) => editor.commands.command(({ tr }) => {
    tr.setSelection(TextSelection.near(tr.doc.resolve(handle.cell + 1)));
    return true;
  });
  const run = (handle: Handle, action: "before" | "after" | "delete" | "table") => {
    target(handle);
    const rect = selectedRect(editor.state);
    const row = handle.axis === "row";
    if (action === "table" || (action === "delete" && (row ? rect.map.height : rect.map.width) === 1)) {
      editor.chain().focus().deleteTable().run();
      return;
    }
    editor.chain().focus().command(({ tr }) => {
      if (action === "delete") (row ? removeRow : removeColumn)(tr, rect, handle.index);
      else (row ? addRow : addColumn)(tr, rect, handle.index + (action === "after" ? 1 : 0));
      return true;
    }).run();
  };
  return <TooltipProvider delay={500}>
    {handles.map((handle) => {
      const row = handle.axis === "row";
      const label = `${row ? "Row" : "Column"} ${handle.index + 1}`;
      return <Menu key={`${handle.axis}-${handle.index}`} onOpenChange={(value) => { open.current = value; if (value) target(handle); }}>
        <Tooltip>
          <TooltipTrigger render={<MenuTrigger render={<Button variant="ghost" size="icon-sm" />} />} aria-label={label}
            className="ll-table-handle" style={{ left: handle.left, top: handle.top }}>
            {row ? <GripVertical /> : <GripHorizontal />}
          </TooltipTrigger>
          <TooltipPopup>{label}</TooltipPopup>
        </Tooltip>
        <MenuPopup aria-label={label} side={row ? "left" : "top"} finalFocus={() => { editor.view.focus(); return false; }}>
          <MenuItem onClick={() => run(handle, "before")}>{row ? "Add row above" : "Add column left"}</MenuItem>
          <MenuItem onClick={() => run(handle, "after")}>{row ? "Add row below" : "Add column right"}</MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => run(handle, "delete")}>{row ? "Delete row" : "Delete column"}</MenuItem>
          <MenuItem onClick={() => run(handle, "table")}>Delete table</MenuItem>
        </MenuPopup>
      </Menu>;
    })}
  </TooltipProvider>;
}
