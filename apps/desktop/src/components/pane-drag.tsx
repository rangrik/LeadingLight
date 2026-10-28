// Dragging a page from the sidebar, a pane by its header, or a tab, beside another pane or into a tab row.
// From Shipyard (MIT, Copyright (c) 2026 Sean Brydon), app/src/components/workspace/tab-drag.tsx.
// Changes: pages only; no tab groups, worktrees or swap; plain labels; a small store.
//
// Pointer events, not HTML5 drag and drop: WebKit's drag images are poor. A press becomes a
// drag only after a few pixels, so clicks still click. Escape, or the window losing focus, cancels.
import { FileText } from "lucide-react";
import { createPortal } from "react-dom";
import { createStore } from "~/lib/state";
import { bounds, dropped, holder, layout, moveTab, panes, placePage, type Rect, type Side, sideAt } from "~/lib/panes";

// tab: the id of a tab being dragged, which can also join a tab row.
type Source = { page: string; label: string; tab?: string };
// Beside a pane at side (filling rect), or among its tabs before index: a line marks the place in a
// tab row, a box the header of a pane with one tab.
type Target = { pane: string; label: string; side?: Side; rect?: Rect; index?: number; line?: React.CSSProperties; box?: React.CSSProperties };

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
    if (commit && target?.index !== undefined) moveTab(source.tab!, target.pane, target.index);
    else if (commit && target?.side) placePage(source.page, target.pane, target.side, source.tab);
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
  const from = holder(source.page, source.tab);
  if (!over || (from?.leaf.id === over.leaf.id && from.leaf.tabs.length === 1)) return undefined;
  // A tab over a pane's tab row or header joins that row, before the first tab whose middle is past the pointer.
  const card = document.querySelector(`[data-pane="${over.leaf.id}"]`);
  const header = card?.querySelector("header")?.getBoundingClientRect();
  if (source.tab && header && y <= header.bottom) {
    const row = card?.querySelector("[data-tab-row]")?.getBoundingClientRect();
    if (!row) return { pane: over.leaf.id, index: 1, label: "Add as a tab", box: { left: header.left - area.left, top: header.top - area.top, width: header.width, height: header.height } };
    const tabs = [...(card?.querySelectorAll("[data-tab]") ?? [])].map((el) => el.getBoundingClientRect());
    const index = tabs.filter((t) => t.left + t.width / 2 < x).length;
    const at = tabs[index]?.left ?? tabs.at(-1)?.right ?? row.left;
    return { pane: over.leaf.id, index, label: "", line: { left: at - area.left - 1, top: row.top - area.top + 8, height: row.height - 16 } };
  }
  const r = over.rect;
  const side = sideAt((fx - r.x) / r.w, (fy - r.y) / r.h);
  const after = dropped(root, source.page, over.leaf.id, side, source.tab);
  const rect = bounds(after.root, [after.pane]);
  return rect && { pane: over.leaf.id, side, rect, label: `${from ? "Move" : "Open"} ${WHERE[side]}` };
}

// Drawn over the pane area while dragging: a dashed card where the page will land.
export function DropOverlay({ at }: { at: (r: Rect) => React.CSSProperties }) {
  const { source, target } = drag.use();
  if (!source || !target) return null;
  if (target.line)
    return (
      <div className="pointer-events-none absolute inset-0 z-30">
        <div className="absolute w-0.5 rounded-full bg-info transition-[left] duration-150 ease-out" style={target.line} />
      </div>
    );
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Over a header the tint is opaque, so none of the header shows beside the label. */}
      <div
        className={`absolute flex items-center justify-center rounded-xl border-2 border-info/60 border-dashed transition-[left,top,width,height] duration-150 ease-out ${target.box ? "bg-[color-mix(in_oklab,var(--color-info)_10%,var(--color-background))]" : "bg-info/10"}`}
        style={target.box ?? at(target.rect!)}
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
