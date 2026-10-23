import { create } from "zustand";

import { setPrefs, setTerminalPrefs, usePrefs } from "@/lib/prefs";
import { DEFAULT_TERMINAL_PREFS } from "@/lib/terminal";

// Zoom (View → Zoom in ⌘+, Zoom out ⌘−, Actual size ⌘0) makes the
// interface's text bigger or smaller: the uiFontSize pref, which everything
// sized in rem follows (lib/prefs.ts). With a terminal focused it changes
// the terminals' font size instead, as a terminal app does. Either way the
// HUD (components/zoom-hud.tsx) shows the size for a moment.

export const UI_SIZES = { min: 11, max: 20, default: 13 };
// The terminal's range is Settings → Terminal's.
export const TERMINAL_SIZES = { min: 9, max: 24, default: DEFAULT_TERMINAL_PREFS.fontSize };

export type ZoomTarget = "ui" | "terminal";
export type ZoomStep = 1 | -1 | 0;

// What the HUD shows: the size just set, and when, so a second press
// restarts its timer.
export const useZoomHud = create<{ target?: ZoomTarget; size?: number; at: number }>()(() => ({ at: 0 }));

// nextSize is the size one step from size, inside the range; 0 resets.
export function nextSize(size: number, step: ZoomStep, r: { min: number; max: number; default: number }): number {
  if (step === 0) return r.default;
  return Math.min(r.max, Math.max(r.min, Math.round(size) + step));
}

// terminalFocused says whether the keyboard is in a terminal pane. A
// terminal is made again at its new size, so for a moment after a step the
// keyboard is nowhere: the next press is still the terminal's.
export function terminalFocused(): boolean {
  const a = document.activeElement;
  if (a?.closest("[data-terminal]")) return true;
  const hud = useZoomHud.getState();
  return (!a || a === document.body) && hud.target === "terminal" && performance.now() - hud.at < 2000;
}

// zoom takes one step and shows where it landed.
export function zoom(step: ZoomStep, target: ZoomTarget = terminalFocused() ? "terminal" : "ui") {
  const p = usePrefs.getState();
  let size: number;
  if (target === "terminal") {
    size = nextSize(p.terminal.fontSize, step, TERMINAL_SIZES);
    if (size !== p.terminal.fontSize) setTerminalPrefs({ fontSize: size });
  } else {
    size = nextSize(p.uiFontSize, step, UI_SIZES);
    if (size !== p.uiFontSize) setPrefs({ uiFontSize: size });
  }
  useZoomHud.setState({ target, size, at: performance.now() });
}
