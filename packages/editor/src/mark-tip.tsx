import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { Tooltip, TooltipPopup } from "@leadinglight/ui/components/tooltip";

// As the app's other tooltips wait (App's TooltipProvider); just after one closes, the next opens
// at once, as macOS's do when gliding from one word to the next.
const DELAY_MS = 300;
const GRACE_MS = 500;

type At = { el: HTMLElement; anchor: { getBoundingClientRect: () => DOMRect } };

// Why a word is underlined or struck through (writing.ts puts it in data-tip), in COSS's tooltip
// on pointing at the word. One per editor, moved to whichever word is under the pointer.
export function MarkTip({ editor }: { editor: Editor }) {
  const [at, setAt] = useState<At | null>(null);
  useEffect(() => {
    const dom = editor.view.dom;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown: HTMLElement | null = null;
    let pending: HTMLElement | null = null;
    let closed = 0;
    const show = (el: HTMLElement | null, y = 0) => {
      if (shown && !el) closed = performance.now();
      shown = el;
      if (!el) return setAt(null);
      // A mark that wraps is one box over two lines: point at the line under the pointer.
      const line = [...el.getClientRects()].findIndex((r) => y >= r.top && y <= r.bottom);
      setAt({ el, anchor: { getBoundingClientRect: () => el.getClientRects()[line] ?? el.getBoundingClientRect() } });
    };
    const point = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (el === shown || (el && el === pending)) return;
      clearTimeout(timer);
      pending = null;
      if (!el || shown || performance.now() - closed < GRACE_MS) return show(el, e.clientY);
      pending = el;
      timer = setTimeout(() => {
        pending = null;
        show(el, e.clientY);
      }, DELAY_MS);
    };
    const hide = () => {
      clearTimeout(timer);
      pending = null;
      show(null);
    };
    // A redrawn word leaves the tooltip pointing at nothing.
    const redrawn = () => shown && !shown.isConnected && show(null);
    dom.addEventListener("pointermove", point);
    dom.addEventListener("pointerleave", hide);
    dom.addEventListener("keydown", hide);
    editor.on("transaction", redrawn);
    return () => {
      clearTimeout(timer);
      dom.removeEventListener("pointermove", point);
      dom.removeEventListener("pointerleave", hide);
      dom.removeEventListener("keydown", hide);
      editor.off("transaction", redrawn);
    };
  }, [editor]);
  return (
    <Tooltip onOpenChange={(open) => !open && setAt(null)} open={Boolean(at)}>
      <TooltipPopup anchor={at?.anchor}>{at?.el.dataset.tip}</TooltipPopup>
    </Tooltip>
  );
}
