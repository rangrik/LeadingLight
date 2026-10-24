// The open pages, side by side. From Shipyard (MIT, Copyright (c) 2026 Sean Brydon),
// app/src/components/workspace/pane-layer.tsx and pane.tsx. Changes: pages only, each a card
// with its own header (crumbs and a close button), no Compare tabs, no tabs kept mounted while hidden.
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@leadinglight/ui/components/button";
import { useSidebar } from "@leadinglight/ui/components/sidebar";
import { cn } from "@leadinglight/ui/lib/utils";
import { AskButton } from "~/components/ask-button";
import { PageIconView } from "~/components/page-icon";
import { PageStats } from "~/components/page-stats";
import { armDrag, DragGhost, DropOverlay } from "~/components/pane-drag";
import { PageView } from "~/components/page-view";
import { PanelHeader } from "~/components/panel-header";
import { visit } from "~/components/property-value";
import { TypeView } from "~/components/type-view";
import { WritingMenu } from "~/components/writing-menu";
import { PLAIN_NEED, paneNeed } from "~/lib/essay";
import { type LLObject, objects } from "~/lib/objects";
import { closePane, type Divider, focusPane, layout, type PaneNode, panes, type Rect, resizePanes } from "~/lib/panes";
import { describe, draftOf, pageOf, space, TYPE_VIEW } from "~/lib/space";
import { PAGE_TYPE } from "~/lib/store";
import { toolsOn, useWritingPrefs } from "~/lib/writing";

type Size = { w: number; h: number };

// A page's card: the sidebar-08 inset panel's look, one per open page.
export const CARD = "bg-background md:rounded-xl md:shadow-sm/5";
const GAP = 8; // between cards, as between a card and the window's edge
// A control on a card that isn't in front: there on hover, or while it has focus or is open.
const BACK_CARD = "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100";
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

// Panes are one flat list keyed by pane id and kept in id order, so a pane that moves or
// splits is never remounted: its editor, unsaved edits and scroll stay.
export function PaneArea({ windowToggle }: { windowToggle: boolean }) {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const { root, focus } = panes.use();
  const { open: sidebarOpen } = useSidebar();
  space.use(); // titles and icons follow edits
  const writing = useWritingPrefs();
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
  // With a page with notes open, any pane left narrower than it needs (by a new pane beside it)
  // while there is room for every pane: share the room out by need. Plain pages keep their splits.
  useEffect(() => {
    if (!root || !hasNotes(root) || !size.w || size.w < widthNeeded(root)) return;
    const cramped = layout(root).leaves.some(({ leaf, rect }) => place(rect, size).width < paneNeed(leaf.page) - 1);
    if (cramped) balance(root);
  }, [root, size]);
  if (!root) return null;
  const { leaves, dividers } = layout(root);
  const split = leaves.length > 1;
  const folding = split && hasNotes(root) && size.w > 0 && size.w < widthNeeded(root);
  const order = [...leaves].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y).map((l) => l.leaf.id);
  const at = Math.max(0, order.indexOf(focus));
  const wide = size.w - (order.length - 1) * (STRIP + GAP);
  // Folded: strips in reading order, the pane in use taking the rest.
  const box = (id: string, rect: Rect) => {
    if (!folding) return place(rect, size);
    const i = order.indexOf(id);
    const left = i * (STRIP + GAP) + (i > at ? wide - STRIP : 0);
    return { left, top: 0, width: i === at ? wide : STRIP, height: size.h };
  };
  return (
    // The stage's colour, so the gaps show where narrow windows drop the cards' corners.
    <div className="relative min-h-0 flex-1 bg-sidebar" data-pane-area ref={area}>
      {[...leaves]
        .sort((a, b) => (a.leaf.id < b.leaf.id ? -1 : 1))
        .map(({ leaf, rect }) => {
          const shown = describe(leaf.page);
          const folded = folding && order.indexOf(leaf.id) !== at;
          return (
            <section
              aria-label={shown.title}
              className={cn("group/card absolute flex flex-col overflow-hidden", CARD)}
              data-folded={folded || undefined}
              data-pane-page={leaf.page}
              key={leaf.id}
              onFocusCapture={() => focusPane(leaf.id)}
              onPointerDownCapture={() => focusPane(leaf.id)}
              style={box(leaf.id, rect)}
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
              {!folded && (
              <PanelHeader
                after={<PageStats id={leaf.page} />}
                current={shown.title}
                icon={shown.icon && <PageIconView icon={shown.icon} />}
                lead={rect.x < EPS && rect.y < EPS}
                toggle={!windowToggle}
                muted={split && leaf.id !== focus}
                onGrab={split ? (e) => armDrag(e, { page: leaf.page, label: shown.title }) : undefined}
                onRoot={(e) => shown.parent && visit(shown.parent.view, e)}
                root={shown.parent?.title}
                sidebarOpen={sidebarOpen}
              >
                {/* Every page's card has Ask, and the Writing menu if its type uses the tools, shown
                    like Close page: on the card in front, the others on hover. Ask gives way in
                    narrow cards, so the title stays whole; ⌘J still asks. */}
                {!leaf.page.startsWith(TYPE_VIEW) && <AskButton className={cn("hidden @[24rem]/header:inline-flex", split && leaf.id !== focus && BACK_CARD)} page={leaf.page} />}
                {!leaf.page.startsWith(TYPE_VIEW) && toolsOn(writing, pageOf(leaf.page)?.typeId ?? PAGE_TYPE) && (
                  <WritingMenu className={cn(split && leaf.id !== focus && BACK_CARD)} />
                )}
                {split && (
                  <Button
                    aria-label="Close page"
                    className={cn(leaf.id !== focus && BACK_CARD)}
                    onClick={() => closePane(leaf.id)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </PanelHeader>
              )}
              {/* Its own scroller, so each page opens at its top and narrow panes can be measured. */}
              <div className={cn("@container min-h-0 flex-1 overflow-y-auto", folded && "hidden")} data-page-scroller key={leaf.page}>
                {leaf.page.startsWith(TYPE_VIEW) ? <TypeView typeId={leaf.page.slice(TYPE_VIEW.length)} /> : <PagePane id={leaf.page} />}
              </div>
            </section>
          );
        })}
      {!folding && dividers.map((d) => <DividerHandle area={area} d={d} key={d.id} limits={ratioLimits(root, d, size)} size={size} />)}
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
      .then((obj) => !stale && setPage(obj ?? draftOf(id) ?? null))
      .catch(console.error);
    return () => {
      stale = true;
    };
  }, [id]);
  return page?.id === id ? <PageView page={page} /> : null;
}

// The invisible grab area filling the gap between two cards.
function DividerHandle({ d, area, size, limits }: { d: Divider; area: React.RefObject<HTMLDivElement | null>; size: Size; limits: [number, number] }) {
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
      className={cn("group/gap absolute z-10 flex items-center justify-center", row ? "cursor-col-resize" : "cursor-row-resize")}
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
    >
      {/* A grip on hover, so the gap reads as something to drag. */}
      <span className={cn("rounded-full bg-muted-foreground/40 opacity-0 transition-opacity duration-150 group-hover/gap:opacity-100", row ? "h-8 w-1" : "h-1 w-8")} />
    </div>
  );
}
