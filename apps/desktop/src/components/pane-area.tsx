// The open pages, side by side. From Shipyard (MIT, Copyright (c) 2026 Sean Brydon),
// app/src/components/workspace/pane-layer.tsx and pane.tsx. Changes: pages only, one header
// with a title and a close button, no Compare tabs, no tabs kept mounted while hidden.
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { RowIcon } from "~/components/page-icon";
import { armDrag, DragGhost, DropOverlay } from "~/components/pane-drag";
import { PageView } from "~/components/page-view";
import { TypeView } from "~/components/type-view";
import { type LLObject, objects } from "~/lib/objects";
import { closePane, type Divider, focusPane, layout, type PaneNode, panes, type Rect, resizePanes } from "~/lib/panes";
import { PLAIN_NEED, paneNeed } from "~/lib/essay";
import { describe, space, TYPE_VIEW } from "~/lib/space";

type Size = { w: number; h: number };

// Edges rounded to whole pixels, so icons and text stay sharp at any split.
const px = (r: Rect, s: Size) => {
  const left = Math.round(r.x * s.w);
  const top = Math.round(r.y * s.h);
  return { left, top, width: Math.round((r.x + r.w) * s.w) - left, height: Math.round((r.y + r.h) * s.h) - top };
};

// Panes are one flat list keyed by pane id and kept in id order, so a pane that moves or
// splits is never remounted: its editor, unsaved edits and scroll stay.
// When a page with sidenotes is open and there's no room for every pane at the width its page
// needs (that page needs its margin), the panes not being worked in fold to strips with their
// titles, so notes are never squeezed; a click on a strip opens it. Folded pages stay mounted.
// Plain pages side by side never fold.
const STRIP = 44;
const widthNeeded = (n: PaneNode): number =>
  n.kind === "leaf" ? paneNeed(n.page) : n.dir === "row" ? widthNeeded(n.a) + widthNeeded(n.b) : Math.max(widthNeeded(n.a), widthNeeded(n.b));
const hasNotes = (n: PaneNode): boolean => (n.kind === "leaf" ? paneNeed(n.page) > PLAIN_NEED : hasNotes(n.a) || hasNotes(n.b));
const splitById = (n: PaneNode, id: string): PaneNode | undefined =>
  n.kind === "leaf" ? undefined : n.id === id ? n : (splitById(n.a, id) ?? splitById(n.b, id));

// A divider can't squeeze a side holding a page with notes below the width they need.
function ratioLimits(root: PaneNode, d: Divider, size: Size): [number, number] {
  const split = splitById(root, d.id);
  const width = d.area.w * size.w;
  if (!split || split.kind === "leaf" || d.dir !== "row" || !width) return [0, 1];
  const lo = hasNotes(split.a) ? widthNeeded(split.a) / width : 0;
  const hi = hasNotes(split.b) ? 1 - widthNeeded(split.b) / width : 1;
  return lo <= hi ? [lo, hi] : [0, 1];
}

// Every split shared in proportion to what its sides need. Only ratios that change are set, so a
// split that can't move (kept within 10–90%) doesn't set off another pass.
function balance(n: PaneNode) {
  if (n.kind === "leaf") return;
  const want = Math.min(0.9, Math.max(0.1, widthNeeded(n.a) / (widthNeeded(n.a) + widthNeeded(n.b))));
  if (n.dir === "row" && Math.abs(n.ratio - want) > 0.001) resizePanes(n.id, want);
  balance(n.a);
  balance(n.b);
}

export function PaneArea() {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const { root, focus } = panes.use();
  space.use(); // titles and icons follow edits
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A page with notes left narrower than its margin needs (by a new pane beside it) while there is
  // room for every pane: share the room out by need.
  useEffect(() => {
    if (!root || !size.w || size.w < widthNeeded(root)) return;
    const cramped = layout(root).leaves.some(({ leaf, rect }) => paneNeed(leaf.page) > PLAIN_NEED && px(rect, size).width < paneNeed(leaf.page) - 1);
    if (cramped) balance(root);
  }, [root, size]);
  if (!root) return null;
  const { leaves, dividers } = layout(root);
  const split = leaves.length > 1;
  const withNotes = leaves.some(({ leaf }) => paneNeed(leaf.page) > PLAIN_NEED);
  const folding = split && withNotes && size.w > 0 && size.w < widthNeeded(root);
  const order = [...leaves].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y).map((l) => l.leaf.id);
  const at = Math.max(0, order.indexOf(focus));
  const box = (id: string, rect: Rect) => {
    if (!folding) return px(rect, size);
    const i = order.indexOf(id);
    const wide = size.w - (order.length - 1) * STRIP;
    return { left: i * STRIP + (i > at ? wide - STRIP : 0), top: 0, width: i === at ? wide : STRIP, height: size.h };
  };
  return (
    <div className="relative min-h-0 flex-1" data-pane-area ref={area}>
      {[...leaves]
        .sort((a, b) => (a.leaf.id < b.leaf.id ? -1 : 1))
        .map(({ leaf, rect }) => {
          const shown = describe(leaf.page);
          const folded = folding && order.indexOf(leaf.id) !== at;
          const b = box(leaf.id, rect);
          return (
            <section
              aria-label={shown.title}
              className={cn("absolute flex flex-col overflow-hidden", b.left > 0 && "border-l", !folding && rect.y > 0 && "border-t")}
              data-folded={folded || undefined}
              data-pane-page={leaf.page}
              key={leaf.id}
              onFocusCapture={() => focusPane(leaf.id)}
              onPointerDownCapture={() => focusPane(leaf.id)}
              style={b}
            >
              {folded && (
                <button
                  className="flex h-full w-full cursor-pointer items-start justify-center pt-4 text-muted-foreground text-sm transition-colors duration-150 ease-out hover:bg-accent hover:text-foreground"
                  onClick={() => focusPane(leaf.id)}
                  type="button"
                >
                  <span className="max-h-full truncate [writing-mode:vertical-rl]">{shown.title}</span>
                </button>
              )}
              {split && !folded && (
                // box-content keeps the 1 px border out of the 36 px row, so its contents sit on whole
                // pixels; ps-5 lines the icon up with the sidebar toggle above.
                <div
                  className="group/header box-content flex h-9 shrink-0 items-center gap-2 border-b ps-5 pe-1.5 text-sm"
                  onPointerDown={(e) => armDrag(e, { page: leaf.page, label: shown.title })}
                >
                  <RowIcon icon={shown.icon} />
                  <span className={cn("min-w-0 flex-1 truncate", leaf.id === focus ? "text-foreground" : "text-muted-foreground")}>
                    {shown.title}
                  </span>
                  <Button
                    aria-label="Close page"
                    className={cn(leaf.id !== focus && "opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100")}
                    onClick={() => closePane(leaf.id)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )}
              {/* Its own scroller, so each page opens at its top and narrow panes can be measured. */}
              <div className={cn("@container min-h-0 flex-1 overflow-y-auto", folded && "hidden")} data-page-scroller key={leaf.page}>
                {leaf.page.startsWith(TYPE_VIEW) ? <TypeView typeId={leaf.page.slice(TYPE_VIEW.length)} /> : <PagePane id={leaf.page} />}
              </div>
            </section>
          );
        })}
      {!folding && dividers.map((d) => <DividerHandle area={area} d={d} key={d.id} limits={ratioLimits(root, d, size)} size={size} />)}
      <DropOverlay />
      <DragGhost />
    </div>
  );
}

function PagePane({ id }: { id: string }) {
  const [page, setPage] = useState<LLObject | null>(null);
  useEffect(() => {
    let stale = false;
    objects
      .get(id)
      .then((obj) => !stale && setPage(obj))
      .catch(console.error);
    return () => {
      stale = true;
    };
  }, [id]);
  return page?.id === id ? <PageView page={page} /> : null;
}

// The invisible, wider grab area over the line between two panes.
function DividerHandle({ d, area, size, limits }: { d: Divider; area: React.RefObject<HTMLDivElement | null>; size: Size; limits: [number, number] }) {
  const row = d.dir === "row";
  const line = px(row ? { ...d.area, x: d.at, w: 0 } : { ...d.area, y: d.at, h: 0 }, size);
  const style = row ? { ...line, left: line.left - 3, width: 6 } : { ...line, top: line.top - 3, height: 6 };
  return (
    <div
      aria-orientation={row ? "vertical" : "horizontal"}
      className={cn("absolute z-10", row ? "cursor-col-resize" : "cursor-row-resize")}
      onPointerDown={(e) => {
        const box = area.current?.getBoundingClientRect();
        if (!box) return;
        e.preventDefault();
        const el = e.currentTarget;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Not capturable (the pointer is gone); moves over the line still resize.
        }
        document.body.classList.add("select-none", "[&_iframe]:pointer-events-none");
        const move = (ev: PointerEvent) => {
          const ratio = row ? ((ev.clientX - box.left) / box.width - d.area.x) / d.area.w : ((ev.clientY - box.top) / box.height - d.area.y) / d.area.h;
          resizePanes(d.id, Math.min(limits[1], Math.max(limits[0], ratio)));
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          document.body.classList.remove("select-none", "[&_iframe]:pointer-events-none");
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
      role="separator"
      style={style}
    />
  );
}
