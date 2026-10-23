// Dragging a page from the sidebar, or a pane by its header, beside another pane.
// From Shipyard (MIT, Copyright (c) 2026 Sean Brydon), app/src/components/workspace/tab-drag.tsx.
// Changes: pages only; no tab strip, tab groups, worktrees or swap; plain labels; a small store.
//
// Pointer events, not HTML5 drag and drop: WebKit's drag images are poor. A press becomes a
// drag only after a few pixels, so clicks still click. Escape, or the window losing focus, cancels.
import { FileText } from "lucide-react";
import { createPortal } from "react-dom";
import { createStore } from "~/lib/state";
import { bounds, layout, leaf, leaves, movePane, panes, place, placePage, type Rect, type Side, sideAt } from "~/lib/panes";

type Source = { page: string; label: string };
type Target = { pane: string; side: Side; rect: Rect; label: string };

const drag = createStore<{ source?: Source; target?: Target; x: number; y: number }>({ x: 0, y: 0 });

const THRESHOLD = 5;
// While dragging, nothing under the pointer shows its own cursor or takes the pointer.
const BODY = ["select-none", "[&_*]:cursor-grabbing!", "[&_iframe]:pointer-events-none"];

// Starts watching a press on a sidebar row or a pane header. Buttons inside it never start a drag.
export function armDrag(e: React.PointerEvent<HTMLElement>, source: Source) {
  const inner = (e.target as HTMLElement).closest("button, input, a");
  if (e.button !== 0 || e.ctrlKey || (inner && inner !== e.currentTarget)) return;
  const el = e.currentTarget;
  const id = e.pointerId;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let live = false;

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (!live) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      live = true;
      try {
        el.setPointerCapture(id);
      } catch {
        // Not capturable; the window listeners still see it.
      }
      document.body.classList.add(...BODY);
      window.getSelection()?.removeAllRanges();
    }
    drag.set({ source, x: ev.clientX, y: ev.clientY, target: hit(source, ev.clientX, ev.clientY) });
  };
  const end = (commit: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    if (!live) return;
    const { target } = drag.get();
    drag.set({ x: 0, y: 0 });
    document.body.classList.remove(...BODY);
    try {
      el.releasePointerCapture(id);
    } catch {
      // Already released.
    }
    // The click that follows letting go is the drag's, not the row's.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    if (commit && target) placePage(source.page, target.pane, target.side);
  };
  const up = (ev: PointerEvent) => ev.pointerId === id && end(true);
  const cancel = () => end(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !live) return;
    ev.preventDefault();
    ev.stopPropagation();
    end(false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
}

const WHERE: Record<Side, string> = { left: "on the left", right: "on the right", top: "above", bottom: "below" };

// The side of the pane under the pointer, and the box the page would fill there.
function hit(source: Source, x: number, y: number): Target | undefined {
  const { root } = panes.get();
  const area = document.querySelector("[data-pane-area]")?.getBoundingClientRect();
  if (!root || !area || x < area.left || x > area.right || y < area.top || y > area.bottom) return undefined;
  const fx = (x - area.left) / area.width;
  const fy = (y - area.top) / area.height;
  const over = layout(root).leaves.find(({ rect: r }) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h);
  if (!over || over.leaf.page === source.page) return undefined;
  const r = over.rect;
  const side = sideAt((fx - r.x) / r.w, (fy - r.y) / r.h);
  const open = leaves(root).find((l) => l.page === source.page);
  const moving = open ?? leaf(source.page);
  const after = open ? movePane(root, open.id, over.leaf.id, side) : place(root, over.leaf.id, side, moving);
  const rect = bounds(after, [moving.id]);
  return rect && { pane: over.leaf.id, side, rect, label: `${open ? "Move" : "Open"} ${WHERE[side]}` };
}

// Drawn over the pane area while dragging: a dashed card where the page will land.
export function DropOverlay({ at }: { at: (r: Rect) => React.CSSProperties }) {
  const { source, target } = drag.use();
  if (!source || !target) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className="absolute flex items-center justify-center rounded-xl border-2 border-info/60 border-dashed bg-info/10 transition-[left,top,width,height] duration-150 ease-out"
        style={at(target.rect)}
      >
        <span className="flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-sm">
          <span className="shrink-0 font-medium">{target.label}</span>
          <span className="truncate text-muted-foreground">· {source.label}</span>
        </span>
      </div>
    </div>
  );
}

// Follows the pointer with the page being dragged; over a pane the overlay says it instead.
export function DragGhost() {
  const { source, target, x, y } = drag.use();
  if (!source || target) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[1000] flex h-7 max-w-60 items-center gap-1.5 rounded-md border bg-popover px-2.5 text-popover-foreground text-xs opacity-75 shadow-lg/10"
      style={x > window.innerWidth - 260 ? { right: window.innerWidth - x + 12, top: y + 14 } : { left: x + 12, top: y + 14 }}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{source.label}</span>
    </div>,
    document.body,
  );
}
