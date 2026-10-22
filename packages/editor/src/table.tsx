import type { ChainedCommands, Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { BubbleMenu } from "@tiptap/react/menus";
import { BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart } from "lucide-react";
import { Toolbar, ToolbarSeparator } from "@leadinglight/ui/components/toolbar";
import { TooltipProvider } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { flipWithin, surface, ToolButton } from "./ui";

export const Tables = TableKit.configure({
  table: { resizable: true, HTMLAttributes: { class: "ll-table" } },
});

// Shows above the table while the cursor is in it.
export function TableToolbar({ editor }: { editor: Editor }) {
  const run = (cmd: (c: ChainedCommands) => ChainedCommands) => () => cmd(editor.chain().focus()).run();
  return (
    <BubbleMenu
      className="z-20"
      editor={editor}
      getReferencedVirtualElement={() => {
        const { node } = editor.view.domAtPos(editor.state.selection.from);
        const table = (node instanceof Element ? node : node.parentElement)?.closest("table");
        return table ? { getBoundingClientRect: () => table.getBoundingClientRect() } : null;
      }}
      options={{ placement: "top-start", offset: 8, flip: flipWithin(editor.view.dom) }}
      pluginKey="tableToolbar"
      shouldShow={({ editor, element }) =>
        (editor.isFocused || element.contains(document.activeElement)) && editor.isActive("table")
      }
      updateDelay={0}
    >
      <TooltipProvider delay={500}>
        <Toolbar aria-label="Table" className={cn(surface, "items-center gap-0.5 p-1")}>
          <ToolButton label="Add row above" onClick={run((c) => c.addRowBefore())}>
            <BetweenHorizontalStart />
          </ToolButton>
          <ToolButton label="Add row below" onClick={run((c) => c.addRowAfter())}>
            <BetweenHorizontalEnd />
          </ToolButton>
          <ToolButton label="Add column left" onClick={run((c) => c.addColumnBefore())}>
            <BetweenVerticalStart />
          </ToolButton>
          <ToolButton label="Add column right" onClick={run((c) => c.addColumnAfter())}>
            <BetweenVerticalEnd />
          </ToolButton>
          <ToolbarSeparator className="mx-0.5 h-4" orientation="vertical" />
          <span className="px-1.5 text-muted-foreground text-xs">Delete</span>
          <ToolButton label="Delete row" onClick={run((c) => c.deleteRow())}>
            Row
          </ToolButton>
          <ToolButton label="Delete column" onClick={run((c) => c.deleteColumn())}>
            Column
          </ToolButton>
          <ToolButton label="Delete table" onClick={run((c) => c.deleteTable())}>
            Table
          </ToolButton>
        </Toolbar>
      </TooltipProvider>
    </BubbleMenu>
  );
}
