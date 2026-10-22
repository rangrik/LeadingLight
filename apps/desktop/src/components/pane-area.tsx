// The open pages, side by side. From Shipyard (MIT, Copyright (c) 2026 Sean Brydon),
// app/src/components/workspace/pane-layer.tsx and pane.tsx. Changes: pages only, each a card
// with its own header (crumbs and a close button), no Compare tabs, no tabs kept mounted while hidden.
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@leadinglight/ui/components/button";
import { useSidebar } from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import { PageIconView } from "~/components/page-icon";
import { armDrag, DragGhost, DropOverlay } from "~/components/pane-drag";
import { PageView } from "~/components/page-view";
import { PanelHeader } from "~/components/panel-header";
import { TypeView } from "~/components/type-view";
import { type LLObject, objects } from "~/lib/objects";
import { closePane, type Divider, focusPane, layout, panes, type Rect, resizePanes } from "~/lib/panes";
import { describe, space, TYPE_VIEW } from "~/lib/space";

type Size = { w: number; h: number };

// A page's card: the sidebar-08 inset panel's look, one per open page.
export const CARD = "bg-background md:rounded-xl md:shadow-sm/5";
const GAP = 8; // between cards, as between a card and the window's edge
const EPS = 1e-6;

// Edges rounded to whole pixels, so icons and text stay sharp at any split.
const edges = (r: Rect, s: Size) => {
  const left = Math.round(r.x * s.w);
  const top = Math.round(r.y * s.h);
  return { left, top, width: Math.round((r.x + r.w) * s.w) - left, height: Math.round((r.y + r.h) * s.h) - top };
};

// A card gives up half the gap on each side it shares with another card.
const place = (r: Rect, s: Size) => {
  const { left, top, width, height } = edges(r, s);
  const start = r.x > EPS ? GAP / 2 : 0;
  const above = r.y > EPS ? GAP / 2 : 0;
  const end = r.x + r.w < 1 - EPS ? GAP / 2 : 0;
  const below = r.y + r.h < 1 - EPS ? GAP / 2 : 0;
  return { left: left + start, top: top + above, width: width - start - end, height: height - above - below };
};

// Panes are one flat list keyed by pane id and kept in id order, so a pane that moves or
// splits is never remounted: its editor, unsaved edits and scroll stay.
export function PaneArea() {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const { root, focus } = panes.use();
  const { open: sidebarOpen } = useSidebar();
  space.use(); // titles and icons follow edits
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    // Drawn before the frame paints, so cards keep up with the sidebar as it slides.
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (!root) return null;
  const { leaves, dividers } = layout(root);
  const split = leaves.length > 1;
  return (
    // The stage's colour, so the gaps show where narrow windows drop the cards' corners.
    <div className="relative min-h-0 flex-1 bg-sidebar" data-pane-area ref={area}>
      {[...leaves]
        .sort((a, b) => (a.leaf.id < b.leaf.id ? -1 : 1))
        .map(({ leaf, rect }) => {
          const shown = describe(leaf.page);
          return (
            <section
              aria-label={shown.title}
              className={cn("group/card absolute flex flex-col overflow-hidden", CARD)}
              key={leaf.id}
              onFocusCapture={() => focusPane(leaf.id)}
              onPointerDownCapture={() => focusPane(leaf.id)}
              style={place(rect, size)}
            >
              <PanelHeader
                current={shown.title}
                icon={shown.icon && <PageIconView icon={shown.icon} />}
                lead={rect.x < EPS && rect.y < EPS}
                muted={split && leaf.id !== focus}
                onGrab={split ? (e) => armDrag(e, { page: leaf.page, label: shown.title }) : undefined}
                root={shown.parent ?? "Pages"}
                sidebarOpen={sidebarOpen}
              >
                {split && (
                  <Button
                    aria-label="Close page"
                    className={cn(leaf.id !== focus && "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100")}
                    onClick={() => closePane(leaf.id)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </PanelHeader>
              {/* Its own scroller, so each page opens at its top and narrow panes can be measured. */}
              <div className="@container min-h-0 flex-1 overflow-y-auto" key={leaf.page}>
                {leaf.page.startsWith(TYPE_VIEW) ? <TypeView typeId={leaf.page.slice(TYPE_VIEW.length)} /> : <PagePane id={leaf.page} />}
              </div>
            </section>
          );
        })}
      {dividers.map((d) => (
        <DividerHandle area={area} d={d} key={d.id} size={size} />
      ))}
      <DropOverlay at={(r) => place(r, size)} />
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

// The invisible grab area filling the gap between two cards.
function DividerHandle({ d, area, size }: { d: Divider; area: React.RefObject<HTMLDivElement | null>; size: Size }) {
  const row = d.dir === "row";
  // Along the gap, it spans the split's cards only, so it never reaches into a crossing gap.
  const line = edges(row ? { ...d.area, x: d.at, w: 0 } : { ...d.area, y: d.at, h: 0 }, size);
  const span = place(d.area, size);
  const style = row
    ? { left: line.left - GAP / 2, width: GAP, top: span.top, height: span.height }
    : { top: line.top - GAP / 2, height: GAP, left: span.left, width: span.width };
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
        const move = (ev: PointerEvent) =>
          resizePanes(
            d.id,
            row ? ((ev.clientX - box.left) / box.width - d.area.x) / d.area.w : ((ev.clientY - box.top) / box.height - d.area.y) / d.area.h,
          );
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
