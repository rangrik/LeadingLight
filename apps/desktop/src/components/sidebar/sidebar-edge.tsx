// The sidebar's resize grip: the 8 px gap between the sidebar and the first card.
import { useSidebar } from "@leadinglight/ui/components/sidebar";

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 400;
export const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));

type Props = { width: number; onResize: (width: number) => void; onResizing: (resizing: boolean) => void };

export function SidebarEdge({ width, onResize, onResizing }: Props) {
  const { open, isMobile } = useSidebar();
  if (!open || isMobile) return null;
  return (
    <div
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemax={SIDEBAR_MAX}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuenow={width}
      className="group/edge fixed inset-y-0 z-20 hidden w-2 cursor-col-resize items-center justify-center md:flex"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Not capturable; moves over the edge still resize.
        }
        onResizing(true);
        document.body.classList.add("select-none");
        // Kept relative to where the press landed, so pressing doesn't make the edge jump.
        const offset = width - e.clientX;
        const move = (ev: PointerEvent) => onResize(clampWidth(ev.clientX + offset));
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          document.body.classList.remove("select-none");
          onResizing(false);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      role="separator"
      style={{ left: width - 8 }}
    >
      <span className="h-8 w-1 rounded-full bg-muted-foreground/40 opacity-0 transition-opacity duration-150 group-hover/edge:opacity-100" />
    </div>
  );
}
