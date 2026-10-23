import { usePrefs } from "@/lib/prefs";

// Density (Settings → Appearance) sizes rows everywhere through the CSS
// variables in index.css (h-row, py-row-pad, gap-row-gap, h-side-row). The
// commit graph draws an SVG per row in pixels, so its row height is here:
// one line like `git log --graph --oneline` when compact, a little air when
// comfortable.
const GRAPH_ROW = { compact: 28, comfortable: 36 } as const;

export function useDensity() {
  return usePrefs((p) => p.density);
}

export function useGraphRowHeight(): number {
  return GRAPH_ROW[useDensity()];
}
