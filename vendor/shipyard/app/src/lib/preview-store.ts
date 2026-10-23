import { create } from "zustand";

import { normalizeSettings, type PreviewSettings } from "@/lib/preview-frames";
import { load, save } from "@/lib/storage";

// A Preview tab's sizes, layout, sync and themes, remembered per worktree
// (its workspace key) on this computer: a worktree's Preview tabs open as
// you left the last one.

const KEY = "berth.preview";

interface State {
  byWorktree: Record<string, unknown>;
}

export const usePreviewStore = create<State>(() => ({ byWorktree: load<Record<string, unknown>>(KEY, {}) }));

usePreviewStore.subscribe((s) => save(KEY, s.byWorktree));

export function usePreviewSettings(wt: string): PreviewSettings {
  const raw = usePreviewStore((s) => s.byWorktree[wt]);
  // normalizeSettings builds a new object; keyed on raw, which only changes
  // when the settings do.
  return memo(raw);
}

const cache = new WeakMap<object, PreviewSettings>();
const fallback = normalizeSettings(undefined);
function memo(raw: unknown): PreviewSettings {
  if (!raw || typeof raw !== "object") return fallback;
  let s = cache.get(raw);
  if (!s) {
    s = normalizeSettings(raw);
    cache.set(raw, s);
  }
  return s;
}

export function previewSettings(wt: string): PreviewSettings {
  return memo(usePreviewStore.getState().byWorktree[wt]);
}

export function setPreviewSettings(wt: string, change: Partial<PreviewSettings> | ((s: PreviewSettings) => Partial<PreviewSettings>)) {
  const cur = previewSettings(wt);
  const next = normalizeSettings({ ...cur, ...(typeof change === "function" ? change(cur) : change) });
  usePreviewStore.setState((s) => ({ byWorktree: { ...s.byWorktree, [wt]: next } }));
}
