import { useEffect, useRef, useState } from "react";

import { Tip } from "@/components/tip";
import { usePrefs } from "@/lib/prefs";
import { clampWidth, dragged, RAIL_WIDTH, SIDEBAR_DEFAULT, SIDEBAR_MIN, sidebarMax, stepped } from "@/lib/sidebar-width";
import { cn } from "@/lib/utils";

// The sidebar's right edge is a handle: drag it to size the sidebar,
// double-click it for the default width, or focus it and use ← and →. Past
// the narrowest a drag folds the sidebar to the rail, and dragging the
// rail's edge out opens it again. While a drag runs the width goes straight
// to the sidebar's own --sidebar-live (no re-render of the sidebar per
// frame); prefs keep it, as --sidebar-w on the root, once the drag ends.
// --sidebar-live isn't inherited (index.css), so a frame of the drag
// restyles the sidebar alone: a variable on the root restyled every
// element under it, 60 ms a frame with 300 worktrees.

const root = () => document.documentElement;
const sidebars = () => document.querySelectorAll<HTMLElement>("[data-testid=sidebar]");

// live sets the width the sidebar shows, during a drag; undefined puts
// back the one prefs keep.
function live(width?: number) {
  for (const el of sidebars()) {
    if (width === undefined) el.style.removeProperty("--sidebar-live");
    else el.style.setProperty("--sidebar-live", `${width}px`);
  }
}

// Panes that size themselves to their box (terminals, a Browser tab's
// native webview) follow on their own (ResizeObserver); one more nudge at
// the end makes sure the last size lands.
function settled() {
  window.dispatchEvent(new Event("resize"));
}

// The one drag at a time. It lives outside React: folding swaps the
// sidebar for the rail mid-drag, and the drag carries on through it.
let drag: { startX: number; startWidth: number; folded: boolean; wasFolded: boolean; width: number; frame: number; x: number; moved: boolean } | undefined;

function beginDrag(e: React.PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  const p = usePrefs.getState();
  const folded = p.sidebarCollapsed;
  drag = { startX: e.clientX, startWidth: folded ? RAIL_WIDTH : p.sidebarWidth, folded, wasFolded: folded, width: p.sidebarWidth, frame: 0, x: e.clientX, moved: false };
  // No text selected and the resize cursor everywhere, frames included
  // (index.css .berth-resizing).
  root().classList.add("berth-resizing");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onUp);
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  drag.x = e.clientX;
  if (drag.frame) return;
  drag.frame = requestAnimationFrame(apply);
}

function apply() {
  if (!drag) return;
  drag.frame = 0;
  const dx = drag.x - drag.startX;
  if (!drag.moved && Math.abs(dx) < 2) return;
  drag.moved = true;
  const next = dragged(drag.startWidth + dx, drag.folded, window.innerWidth);
  if (next.folded !== drag.folded) {
    drag.folded = next.folded;
    usePrefs.setState({ sidebarCollapsed: next.folded });
  }
  if (!next.folded) {
    drag.width = next.width;
    live(next.width);
    document.querySelectorAll<HTMLElement>("[data-sidebar-handle]").forEach((h) => h.setAttribute("aria-valuenow", String(next.width)));
  }
}

function end(cancel: boolean) {
  if (!drag) return;
  // A move the next frame would have drawn counts.
  if (drag.frame && !cancel) {
    cancelAnimationFrame(drag.frame);
    apply();
  }
  const d = drag;
  drag = undefined;
  if (d.frame) cancelAnimationFrame(d.frame);
  root().classList.remove("berth-resizing");
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("blur", onUp);
  if (cancel) {
    // Esc puts it back as it was.
    usePrefs.setState({ sidebarCollapsed: d.wasFolded });
  } else if (!d.folded && d.moved) {
    // Kept (prefs set --sidebar-w); folded by the drag, it opens again at
    // the width it had.
    usePrefs.setState({ sidebarWidth: d.width });
  }
  live(undefined);
  requestAnimationFrame(settled);
}

const onUp = () => end(false);
function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  end(true);
}

// reset puts the default width back, and opens the sidebar if it was folded.
function reset() {
  usePrefs.setState({ sidebarWidth: SIDEBAR_DEFAULT, sidebarCollapsed: false });
  requestAnimationFrame(settled);
}

export function SidebarResizeHandle({ folded = false }: { folded?: boolean }) {
  const width = usePrefs((p) => p.sidebarWidth);
  const [active, setActive] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  // Mid-drag the sidebar folds or opens, and this handle is the other one
  // now: show it held while the drag lasts.
  useEffect(() => {
    if (!drag) return;
    setActive(true);
    const t = window.setInterval(() => !drag && (setActive(false), window.clearInterval(t)), 100);
    return () => window.clearInterval(t);
  }, []);
  const max = sidebarMax(typeof window === "undefined" ? Infinity : window.innerWidth);
  const now = folded ? RAIL_WIDTH : Math.min(width, max);
  return (
    <Tip side="right" delay={600} label={folded ? "Drag to open the sidebar" : "Drag to resize · double-click for the default width"}>
      <div
        ref={self}
        role="separator"
        aria-orientation="vertical"
        aria-label={folded ? "Open the sidebar" : "Resize the sidebar"}
        aria-valuemin={folded ? RAIL_WIDTH : SIDEBAR_MIN}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-valuetext={folded ? "folded" : `${now} pixels`}
        tabIndex={0}
        data-sidebar-handle=""
        data-testid="sidebar-handle"
        data-dragging={active || undefined}
        onPointerDown={(e) => {
          beginDrag(e);
          if (drag) {
            setActive(true);
            const stop = () => {
              setActive(false);
              window.removeEventListener("pointerup", stop);
              window.removeEventListener("pointercancel", stop);
            };
            window.addEventListener("pointerup", stop);
            window.addEventListener("pointercancel", stop);
          }
        }}
        onDoubleClick={reset}
        onKeyDown={(e) => {
          if (folded) {
            // → opens it; the rest of the keys are the open sidebar's.
            if (e.key === "ArrowRight" || e.key === "Enter") {
              e.preventDefault();
              usePrefs.setState({ sidebarCollapsed: false });
              requestAnimationFrame(settled);
            }
            return;
          }
          const next = stepped(width, e.key, e.shiftKey, window.innerWidth);
          if (next !== undefined) {
            e.preventDefault();
            usePrefs.setState({ sidebarWidth: clampWidth(next, window.innerWidth) });
            requestAnimationFrame(settled);
          } else if (e.key === "Enter") {
            e.preventDefault();
            reset();
          }
        }}
        className={cn(
          "group/handle absolute inset-y-0 -right-[4px] z-30 w-[8px] cursor-col-resize touch-none outline-none",
          // A line at the edge on hover, focus and while dragging.
          "after:absolute after:inset-y-0 after:left-[3px] after:w-[2px] after:rounded-full after:bg-transparent after:transition-colors after:delay-75 hover:after:bg-ring focus-visible:after:bg-ring data-dragging:after:bg-ring data-dragging:after:delay-0",
        )}
      />
    </Tip>
  );
}
