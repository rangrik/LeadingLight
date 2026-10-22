import type { Theme } from "@/lib/api";
import { TONE_LCH, TONES, type Tone } from "../lib/groups.ts";
import { contrast, distance, fromOklch, over } from "./color.ts";

// A worktree's tone (lib/groups.ts) on a theme: its hue and chroma, at the
// lightness nearest its own where it is text on the theme's page and
// sidebar, on its own wash (a group's label, a pane's chip), and where the
// page's colour is text on it (the label in front). Light themes darken it,
// dark ones lighten it. No imports but types: pnpm test runs this.

export const TONE_TEXT = 4.5;
// The washes tones sit on: a label's 15%, a chip's 14%.
const WASH = 0.15;

// toneChecks is each surface a tone's text must read on, and how well it does.
export function toneChecks(tone: string, t: Theme): { what: string; value: number }[] {
  const c = t.colors;
  return [
    { what: "on the background", value: contrast(tone, c.background) },
    { what: "on the sidebar", value: contrast(tone, c.sidebar) },
    { what: "on its wash over the sidebar", value: contrast(tone, over(tone, c.sidebar, WASH)) },
    { what: "on its wash over the background", value: contrast(tone, over(tone, c.background, WASH)) },
  ];
}

const reads = (tone: string, t: Theme) => toneChecks(tone, t).every((x) => x.value >= TONE_TEXT);

// How far, in OKLab, a tone keeps from the theme's state colours, so a
// worktree's colour is never read as running, waiting, done or failed.
export const TONE_APART = 0.07;

export const stateColours = (t: Theme): string[] => [t.colors.success, t.colors.warning, t.colors.destructive, t.colors.info].filter((x): x is string => !!x);

const apart = (tone: string, t: Theme) => stateColours(t).every((s) => distance(tone, s) >= TONE_APART);

export function toneFor(tone: Tone, t: Theme): string {
  const dark = t.appearance === "dark";
  const [L, C, H] = TONE_LCH[tone][dark ? "dark" : "light"];
  // The nearest lightness that reads and keeps clear of the states; then,
  // turning the hue a little either way; else the nearest that reads.
  let first: string | undefined;
  for (const turn of [0, 12, -12, 24, -24]) {
    for (let step = 0; step <= 60; step++) {
      const l = dark ? Math.min(0.97, L + step * 0.005) : Math.max(0.2, L - step * 0.005);
      const x = fromOklch(l, C, (H + turn + 360) % 360);
      if (!reads(x, t)) continue;
      first ??= x;
      if (apart(x, t)) return x;
    }
  }
  return first ?? fromOklch(L, C, H);
}

// toneColors is every tone on a theme, as --wt-<tone> wants it.
export function toneColors(t: Theme): Record<Tone, string> {
  return Object.fromEntries(TONES.map((x) => [x, toneFor(x, t)])) as Record<Tone, string>;
}
