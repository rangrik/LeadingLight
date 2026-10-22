import { useSyncExternalStore } from "react";

// Settings › AI and the agent panel's corner, kept on this Mac.
export type Corner = "br" | "bl" | "tr" | "tl";
export type AiPrefs = { model: "opus" | "sonnet" | "haiku"; effort: "low" | "medium" | "high"; corner: Corner; panelW: number; panelH: number };

const KEY = "ll.ai";
const DEFAULTS: AiPrefs = { model: "opus", effort: "medium", corner: "br", panelW: 380, panelH: 460 };

function load(): AiPrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AiPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

let prefs = load();
const listeners = new Set<() => void>();

export const aiPrefs = () => prefs;

export function setAiPrefs(patch: Partial<AiPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Remembering is a convenience; losing it is fine.
  }
  listeners.forEach((l) => l());
}

export const useAiPrefs = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => prefs,
  );
