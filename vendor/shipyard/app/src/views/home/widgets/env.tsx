import { createContext, type ReactNode, useContext, useMemo } from "react";

import { SIZES, type WidgetSize } from "@/lib/home-layout";
import { WidgetEnvContext } from "@/lib/widget-data";

// Home's grid in numbers: a row is ROW px, cards are GAP apart, and a
// card's heading takes HEAD px of it.
export const ROW = 184;
export const GAP = 12;
export const HEAD = 36;

// What a widget's body knows about where it is drawn.
export interface HomeWidgetInfo {
  size: WidgetSize;
  // Its cells as drawn, never wider than the grid.
  span: { c: number; r: number };
  // The body's height in px, and how many 36px rows fit in it.
  height: number;
  lines: number;
  visible: boolean;
  refresh: number;
  // Drawn in the picker's preview, which can't be clicked.
  preview: boolean;
}

const Ctx = createContext<HomeWidgetInfo>({ size: "m", span: { c: 2, r: 1 }, height: ROW - HEAD, lines: 3, visible: true, refresh: 0, preview: false });

export const useHomeWidget = () => useContext(Ctx);

// bodyHeight is the body of a card r rows tall.
export const bodyHeight = (r: number, bare = false) => r * ROW + (r - 1) * GAP - (bare ? 0 : HEAD + 6);

// fitRows is how many rows of rowPx fit in a body of height, leaving room
// for a "+3 more" line under them.
export const fitRows = (height: number, rowPx: number) => Math.max(1, Math.floor((height - 18) / rowPx));

export function HomeWidgetProvider({ size, cols, visible, refresh, preview = false, bare, children }: { size: WidgetSize; cols: number; visible: boolean; refresh: number; preview?: boolean; bare?: boolean; children: ReactNode }) {
  const s = SIZES[size];
  const height = bodyHeight(s.r, bare);
  const info = useMemo<HomeWidgetInfo>(
    () => ({ size, span: { c: Math.min(s.c, cols), r: s.r }, height, lines: Math.max(1, Math.floor(height / 36)), visible, refresh, preview }),
    [size, s.c, s.r, cols, height, visible, refresh, preview],
  );
  const env = useMemo(() => ({ visible, refresh }), [visible, refresh]);
  return (
    <Ctx.Provider value={info}>
      <WidgetEnvContext.Provider value={env}>{children}</WidgetEnvContext.Provider>
    </Ctx.Provider>
  );
}
