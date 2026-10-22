import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Toggle } from "@leadinglight/ui/components/toggle";
import { ToolbarButton } from "@leadinglight/ui/components/toolbar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import type { MouseEvent, ReactNode } from "react";

// COSS's popup surface (MenuPopup, PopoverPopup), for surfaces the editor positions itself.
export const surface =
  "relative rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";

// COSS's outline-button edge, for cards that aren't buttons (the player), so every card matches.
export const cardEdge =
  "relative border-input bg-popover not-dark:bg-clip-padding shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";

// Floating toolbars flip to stay inside the editor (off the title) and inside the part of the
// page that scrolls (out from under the header).
export const flipWithin = (dom: HTMLElement) => () => {
  let scroller = dom.parentElement;
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  return { boundary: scroller ? [dom, scroller] : dom };
};

// Clicking a control must not take the caret out of the editor.
export const keepFocus = (e: MouseEvent) => e.preventDefault();

// A toolbar button with a tooltip. `pressed` makes it a toggle; string children make it a text button.
export function ToolButton({
  label,
  shortcut,
  pressed,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const control =
    pressed === undefined ? (
      <Button
        aria-label={label}
        onClick={onClick}
        onMouseDown={keepFocus}
        size={typeof children === "string" ? "sm" : "icon-sm"}
        variant="ghost"
      />
    ) : (
      <Toggle aria-label={label} onClick={onClick} onMouseDown={keepFocus} pressed={pressed} size="sm" />
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<ToolbarButton render={control} />}>{children}</TooltipTrigger>
      <TooltipPopup>
        <span className="flex items-center gap-2">
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}
