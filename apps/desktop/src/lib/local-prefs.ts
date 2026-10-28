import { useSyncExternalStore } from "react";

// Settings kept on this Mac (localStorage), with a hook that follows every change.
export function localPrefs<T extends object>(key: string, defaults: T) {
  let prefs: T;
  try {
    prefs = { ...defaults, ...(JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<T>) };
  } catch {
    prefs = defaults;
  }
  const listeners = new Set<() => void>();
  const get = () => prefs;
  const set = (patch: Partial<T>) => {
    prefs = { ...prefs, ...patch };
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {
      // Remembering is a convenience; losing it is fine.
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
  const use = () => useSyncExternalStore(subscribe, get);
  return { get, set, use, subscribe };
}
