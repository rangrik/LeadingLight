// The open pages, side by side. From Shipyard (MIT, Copyright (c) 2026 Sean Brydon),
// app/src/components/workspace/pane-layer.tsx and pane.tsx. Changes: pages only, one header
// with a title and a close button, no Compare tabs, no tabs kept mounted while hidden.
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { RowIcon } from "@/components/page-icon";
import { armDrag, DragGhost, DropOverlay } from "@/components/pane-drag";
import { PageView } from "@/components/page-view";
import { TypeView } from "@/components/type-view";
import { type LLObject, objects } from "@/lib/objects";
import { closePane, type Divider, focusPane, layout, panes, type Rect, resizePanes } from "@/lib/panes";
import { describe, space, TYPE_VIEW } from "@/lib/space";

type Size = { w: number; h: number };

// Edges rounded to whole pixels, so icons and text stay sharp at any split.
const px = (r: Rect, s: Size) => {
  const left = Math.round(r.x * s.w);
  const top = Math.round(r.y * s.h);
  return { left, top, width: Math.round((r.x + r.w) * s.w) - left, height: Math.round((r.y + r.h) * s.h) - top };
};

// Panes are one flat list keyed by pane id and kept in id order, so a pane that moves or
// splits is never remounted: its editor, unsaved edits and scroll stay.
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
  if (!root) return null;
  const { leaves, dividers } = layout(root);
  const split = leaves.length > 1;
  return (
    <div className="relative min-h-0 flex-1" data-pane-area ref={area}>
      {[...leaves]
        .sort((a, b) => (a.leaf.id < b.leaf.id ? -1 : 1))
        .map(({ leaf, rect }) => {
          const shown = describe(leaf.page);
          return (
            <section
              aria-label={shown.title}
              className={cn("absolute flex flex-col overflow-hidden", rect.x > 0 && "border-l", rect.y > 0 && "border-t")}
              key={leaf.id}
              onFocusCapture={() => focusPane(leaf.id)}
              onPointerDownCapture={() => focusPane(leaf.id)}
              style={px(rect, size)}
            >
              {split && (
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
              <div className="@container min-h-0 flex-1 overflow-y-auto" key={leaf.page}>
                {leaf.page.startsWith(TYPE_VIEW) ? <TypeView typeId={leaf.page.slice(TYPE_VIEW.length)} /> : <PagePane id={leaf.page} />}
              </div>
            </section>
          );
        })}
      {dividers.map((d) => (
        <DividerHandle area={area} d={d} key={d.id} size={size} />
      ))}
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
function DividerHandle({ d, area, size }: { d: Divider; area: React.RefObject<HTMLDivElement | null>; size: Size }) {
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
